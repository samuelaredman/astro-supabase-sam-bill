import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { classifyText } from "../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../utils/moderation/autoReport";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { game_id, score, title, body: reviewBody, platform_played_on, play_time_hours, contains_spoilers } = body;

  if (!game_id || !score || !title || !reviewBody)
    return json({ error: "Missing required fields." }, 400);

  const { data: existing } = await db
    .from('reviews')
    .select('id')
    .eq('profile_id', profile.id)
    .eq('game_id', game_id)
    .eq('status', 'published')
    .maybeSingle();

  if (existing) return json({ error: "You've already reviewed this game." }, 409);

  const { data: inserted, error: insertError } = await db
    .from("reviews")
    .insert({
      profile_id: profile.id,
      game_id,
      score,
      title,
      body: reviewBody,
      platform_played_on: platform_played_on || null,
      play_time_hours: play_time_hours || null,
      contains_spoilers: contains_spoilers ?? false,
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insertError) {
    console.error('[reviews/create] insert error:', JSON.stringify(insertError));
    return json({ error: insertError.message }, 500);
  }

  // ── Screen the text for explicit content — never fails the request, but must be
  // awaited before returning: on serverless the function freezes once the response
  // is sent, so a detached promise would be killed before the report is filed.
  // Kicked off here and awaited right before the return so it runs concurrently
  // with the DB work below (near-zero added latency).
  const moderationDone = classifyText(`${title}\n${reviewBody}`)
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "review", targetId: inserted.id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[reviews/create] moderation error (non-fatal):", e));

  // ── Auto-track the reviewed game as completed (if not already in library) ──
  try {
    await db.from("user_game_status").upsert({
      profile_id: profile.id,
      game_id,
      status: "completed",
      updated_at: new Date().toISOString(),
    }, { onConflict: "profile_id,game_id", ignoreDuplicates: true });
  } catch (e) {
    console.error("[create] library auto-track error (non-fatal):", e);
  }

  // ── Fire notifications (non-blocking — don't fail the request if this errors) ──
  try {

    // People actively tracking this game (want_to_play or playing), excluding the reviewer
    const { data: watchers } = await db
      .from('user_game_status').select('profile_id')
      .eq('game_id', game_id).in('status', ['want_to_play', 'playing']).neq('profile_id', profile.id);

    // People who follow the reviewer with notify = true (excluding the reviewer)
    const { data: notifyFollowers } = await db
      .from('follows').select('follower_id')
      .eq('following_id', profile.id).eq('notify', true).neq('follower_id', profile.id);

    const notified = new Set<string>();
    const rows: any[] = [];

    for (const w of watchers ?? []) {
      if (!notified.has(w.profile_id)) {
        notified.add(w.profile_id);
        rows.push({ profile_id: w.profile_id, type: 'watchlist_review',
          review_id: inserted.id, game_id, actor_profile_id: profile.id });
      }
    }
    for (const f of notifyFollowers ?? []) {
      if (!notified.has(f.follower_id)) {
        notified.add(f.follower_id);
        rows.push({ profile_id: f.follower_id, type: 'follow_review',
          review_id: inserted.id, game_id, actor_profile_id: profile.id });
      }
    }

    if (rows.length > 0) await db.from('notifications').insert(rows);
  } catch (e) {
    console.error('[create] notification error (non-fatal):', e);
  }

  // ── Fetch community context for the post-review reveal card ──
  const [{ data: gameData }, { data: communityReviews }] = await Promise.all([
    db.from('games').select('slug, cover_img_url').eq('id', game_id).single(),
    db.from('reviews').select('score').eq('game_id', game_id).eq('status', 'published'),
  ]);

  const reviewCount = communityReviews?.length ?? 1;
  const communityAvg = reviewCount > 0
    ? Math.round(((communityReviews ?? []).reduce((s: number, r: any) => s + r.score, 0) / reviewCount) * 10) / 10
    : score;

  // Ensure the moderation classify+report finishes before the serverless function
  // freezes on return (it has been running concurrently with the work above).
  await moderationDone;

  return json({
    success: true,
    gameSlug: gameData?.slug ?? null,
    gameCover: gameData?.cover_img_url ?? null,
    communityAvg,
    reviewCount,
  });
};
