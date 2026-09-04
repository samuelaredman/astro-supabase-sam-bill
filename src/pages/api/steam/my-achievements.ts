import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const GET: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { data, error } = await (db as any)
    .from('user_achievements')
    .select('api_name, steam_appid, display_name, description, icon_url, global_percent, games(title)')
    .eq('profile_id', profile.id)
    .eq('unlocked', true)
    .order('global_percent', { ascending: true, nullsFirst: false })
    .limit(2000);

  if (error) {
    console.error('[my-achievements] fetch error:', JSON.stringify(error));
    return json({ error: 'Failed to load achievements.' }, 500);
  }

  const achievements = (data ?? []).map((a: any) => ({
    api_name:      a.api_name,
    steam_appid:   a.steam_appid,
    display_name:  a.display_name,
    description:   a.description,
    icon_url:      a.icon_url,
    global_percent: a.global_percent,
    game_title:    a.games?.title ?? null,
  }));

  return json({ achievements });
};
