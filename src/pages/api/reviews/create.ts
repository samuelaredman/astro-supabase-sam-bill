import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { classifyText } from "../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../utils/moderation/autoReport";
import { finalizePublishedReview } from "../../../utils/reviewPublish";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { game_id, score, title, body: reviewBody, platform_played_on, play_time_hours, contains_spoilers } = body;
  const isDraft = body.status === "draft";

  if (!game_id) return json({ error: "Missing game." }, 400);

  // ── Draft path: only a body is required; score/title can come later at publish. ──
  if (isDraft) {
    if (!reviewBody?.trim()) return json({ error: "Write something before saving a draft." }, 400);

    const { data: inserted, error: draftError } = await db
      .from("reviews")
      .insert({
        profile_id: profile.id,
        game_id,
        score: score ?? null,
        title: title?.trim() || null,
        body: reviewBody,
        platform_played_on: platform_played_on || null,
        play_time_hours: play_time_hours || null,
        contains_spoilers: contains_spoilers ?? false,
        status: "draft",
        published_at: null,
      })
      .select("id")
      .single();

    if (draftError) {
      console.error("[reviews/create] draft insert error:", JSON.stringify(draftError));
      return json({ error: draftError.message }, 500);
    }

    return json({ success: true, status: "draft", draft_id: inserted.id });
  }

  // ── Published path ──
  if (!score || !title || !reviewBody)
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

  // ── Library auto-track + notifications + community context for the reveal card ──
  const reveal = await finalizePublishedReview(db, {
    reviewId: inserted.id,
    gameId: game_id,
    profileId: profile.id,
    score,
  });

  // Ensure the moderation classify+report finishes before the serverless function
  // freezes on return (it has been running concurrently with the work above).
  await moderationDone;

  return json({ success: true, ...reveal });
};
