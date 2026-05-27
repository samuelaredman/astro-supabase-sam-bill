import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sign in to add games to your watchlist." }, 401);

  const { game_id } = await context.request.json();
  if (!game_id) return json({ error: "game_id is required." }, 400);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

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
    await db.from('user_game_status').delete()
      .eq('profile_id', profile.id).eq('game_id', game_id);
    watching = false;
  } else {
    await db.from('user_game_status').upsert({
      profile_id: profile.id,
      game_id,
      status: 'want_to_play',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,game_id' });
    watching = true;
  }

  const { count } = await db
    .from('user_game_status')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', game_id)
    .eq('status', 'want_to_play');

  return json({ watching, count: count ?? 0 });
};
