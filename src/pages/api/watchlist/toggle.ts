import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { game_id } = await context.request.json();
  if (!game_id) return json({ error: "game_id is required." }, 400);

  // Delegate to user_game_status — 'want_to_play' is the equivalent of the old watchlist.
  // The watchlist table is kept in the DB but no longer written to.
  const { data: existing } = await db
    .from('user_game_status')
    .select('status')
    .eq('profile_id', profile.id)
    .eq('game_id', game_id)
    .maybeSingle();

  let watching: boolean;
  if (existing?.status === 'want_to_play') {
    // Already on want-to-play — toggle it off
    const { error: delError } = await db.from('user_game_status').delete()
      .eq('profile_id', profile.id).eq('game_id', game_id);
    if (delError) {
      console.error('[watchlist/toggle] delete error:', JSON.stringify(delError));
      return json({ error: 'Failed to remove from watchlist.' }, 500);
    }
    watching = false;
  } else if (!existing) {
    // No status yet — set want_to_play
    const { error: insertError } = await db.from('user_game_status').insert({
      profile_id: profile.id,
      game_id,
      status: 'want_to_play',
      updated_at: new Date().toISOString(),
    });
    if (insertError) {
      console.error('[watchlist/toggle] insert error:', JSON.stringify(insertError));
      return json({ error: 'Failed to add to watchlist.' }, 500);
    }
    watching = true;
  } else {
    // User already has a different status (playing/completed/dropped) — don't overwrite it
    return json({ error: 'Game is already tracked with a different status. Use the track buttons on the game page to change it.' }, 409);
  }

  const { count } = await db
    .from('user_game_status')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', game_id)
    .eq('status', 'want_to_play');

  return json({ watching, count: count ?? 0 });
};
