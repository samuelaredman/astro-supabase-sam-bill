import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "You must be signed in to post a review." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile, error: profileError } = await (supabase as any)
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (profileError || !profile) {
    return new Response(JSON.stringify({ error: "Profile not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await context.request.json();
  const { game_id, score, title, body: reviewBody, platform_played_on, play_time_hours, contains_spoilers } = body;

  if (!game_id || !score || !title || !reviewBody) {
    return new Response(JSON.stringify({ error: "Missing required fields." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: existing } = await (supabase as any)
    .from('reviews')
    .select('id')
    .eq('profile_id', profile.id)
    .eq('game_id', game_id)
    .eq('status', 'published')
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ error: "You've already reviewed this game." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: inserted, error: insertError } = await (supabase as any)
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
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Fire notifications (non-blocking — don't fail the request if this errors) ──
  try {
    const db = getSupabaseAdmin() as any;

    // People who watchlisted this game (excluding the reviewer)
    const { data: watchers } = await db
      .from('watchlist').select('profile_id')
      .eq('game_id', game_id).neq('profile_id', profile.id);

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

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
