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

  const { data: existing } = await db
    .from('watchlist')
    .select('id')
    .eq('profile_id', profile.id)
    .eq('game_id', game_id)
    .maybeSingle();

  let watching: boolean;
  if (existing) {
    await db.from('watchlist').delete()
      .eq('profile_id', profile.id).eq('game_id', game_id);
    watching = false;
  } else {
    await db.from('watchlist').insert({ profile_id: profile.id, game_id });
    watching = true;
  }

  const { count } = await db
    .from('watchlist')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', game_id);

  return json({ watching, count: count ?? 0 });
};
