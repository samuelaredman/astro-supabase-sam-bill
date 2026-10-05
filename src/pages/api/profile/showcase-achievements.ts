import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { fetchAll } from "../../../utils/fetchAll";
import { fromPsn, fromSteam, fromXbox, mergeShowcaseAchievements } from "../../../utils/achievementShowcase";

// Everything the signed-in user has unlocked on Steam, PSN and Xbox, for the
// Achievement showcase picker on their profile. Each platform's table is paged
// in full: a user with a big backlog passes Supabase's 1000-row cap easily.

export const GET: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;
  const sb = db as any;

  const [steam, psn, xbox] = await Promise.all([
    fetchAll<any>((from, to) => sb
      .from("user_achievements")
      .select("api_name, steam_appid, game_id, display_name, description, icon_url, global_percent, steam_game_title, games(title)")
      .eq("profile_id", profile.id)
      .eq("unlocked", true)
      .order("id")
      .range(from, to)),
    fetchAll<any>((from, to) => sb
      .from("user_trophies")
      .select("np_communication_id, trophy_group_id, trophy_id, trophy_type, game_id, name, description, icon_url, earned_rate, psn_game_title, games(title)")
      .eq("profile_id", profile.id)
      .eq("earned", true)
      .order("id")
      .range(from, to)),
    fetchAll<any>((from, to) => sb
      .from("user_xbox_achievements")
      .select("xbox_title_id, achievement_id, game_id, name, description, icon_url, rarity, xbox_game_title, games(title)")
      .eq("profile_id", profile.id)
      .eq("unlocked", true)
      .order("id")
      .range(from, to)),
  ]);

  const achievements = mergeShowcaseAchievements([
    ...steam.map(fromSteam),
    ...psn.map(fromPsn),
    ...xbox.map(fromXbox),
  ]);

  return json({ achievements });
};
