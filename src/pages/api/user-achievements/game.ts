import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";

// Full achievement list for one (user, game) pair, including locked rows.
// Powers the modal opened from the detailed library view's completion bar.
// The feed endpoint (user-achievements/feed.ts) reads user_unlocks and only
// returns unlocked rows; this one reads the raw per-source tables so the
// modal can show earned + unearned side-by-side.
//
// Achievements are publicly readable (RLS: USING (true)), so no auth gate —
// matching the feed endpoint. Admin client is used for the join on games(title).

type Source = "steam" | "psn" | "xbox";

export const GET: APIRoute = async ({ url }) => {
  const db = getSupabaseAdmin() as any;
  const p = url.searchParams;

  const username = p.get("username");
  const source = (p.get("source") || "") as Source;
  const id = p.get("id") || "";

  if (!username) return json({ error: "username required" }, 400);
  if (source !== "steam" && source !== "psn" && source !== "xbox") {
    return json({ error: "invalid source" }, 400);
  }
  if (!id) return json({ error: "id required" }, 400);

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (!profile) return json({ error: "Not found" }, 404);

  if (source === "steam") {
    const appid = parseInt(id, 10);
    if (!Number.isFinite(appid)) return json({ error: "invalid id" }, 400);
    const { data, error } = await db
      .from("user_achievements")
      .select(
        "display_name, description, icon_url, icon_gray_url, unlocked, unlock_time, global_percent, steam_game_title, games(title)",
      )
      .eq("profile_id", profile.id)
      .eq("steam_appid", appid)
      .limit(2000);
    if (error) {
      console.error("[ach modal steam] error:", JSON.stringify(error));
      return json({ error: "Failed to load achievements" }, 500);
    }
    const rows = (data ?? []) as any[];
    const gameTitle = rows[0]?.games?.title ?? rows[0]?.steam_game_title ?? null;
    const achievements = rows
      .map((r) => ({
        name: r.display_name ?? null,
        description: r.description ?? null,
        icon_url: r.icon_url ?? null,
        icon_gray_url: r.icon_gray_url ?? null,
        unlocked: !!r.unlocked,
        unlock_time: r.unlock_time ?? null,
        global_percent: r.global_percent ?? null,
        trophy_type: null as string | null,
        gamerscore: null as number | null,
      }))
      .sort(sortAchievements);
    return json({
      source,
      platform_label: "Steam",
      game_title: gameTitle,
      total: achievements.length,
      unlocked: achievements.filter((a) => a.unlocked).length,
      achievements,
    });
  }

  if (source === "psn") {
    const { data, error } = await db
      .from("user_trophies")
      .select(
        "name, description, icon_url, earned, earned_at, earned_rate, trophy_type, psn_platform, psn_game_title, games(title)",
      )
      .eq("profile_id", profile.id)
      .eq("np_communication_id", id)
      .limit(2000);
    if (error) {
      console.error("[ach modal psn] error:", JSON.stringify(error));
      return json({ error: "Failed to load achievements" }, 500);
    }
    const rows = (data ?? []) as any[];
    const gameTitle = rows[0]?.games?.title ?? rows[0]?.psn_game_title ?? null;
    const platformLabel = rows[0]?.psn_platform ?? "PSN";
    const achievements = rows
      .map((r) => ({
        name: r.name ?? null,
        description: r.description ?? null,
        icon_url: r.icon_url ?? null,
        icon_gray_url: null as string | null,
        unlocked: !!r.earned,
        unlock_time: r.earned_at ?? null,
        global_percent: r.earned_rate ?? null,
        trophy_type: r.trophy_type ?? null,
        gamerscore: null as number | null,
      }))
      .sort(sortAchievements);
    return json({
      source,
      platform_label: platformLabel,
      game_title: gameTitle,
      total: achievements.length,
      unlocked: achievements.filter((a) => a.unlocked).length,
      achievements,
    });
  }

  // xbox
  const { data, error } = await db
    .from("user_xbox_achievements")
    .select(
      "name, description, icon_url, unlocked, unlocked_at, rarity, gamerscore, xbox_game_title, games(title)",
    )
    .eq("profile_id", profile.id)
    .eq("xbox_title_id", id)
    .limit(2000);
  if (error) {
    console.error("[ach modal xbox] error:", JSON.stringify(error));
    return json({ error: "Failed to load achievements" }, 500);
  }
  const rows = (data ?? []) as any[];
  const gameTitle = rows[0]?.games?.title ?? rows[0]?.xbox_game_title ?? null;
  const achievements = rows
    .map((r) => ({
      name: r.name ?? null,
      description: r.description ?? null,
      icon_url: r.icon_url ?? null,
      icon_gray_url: null as string | null,
      unlocked: !!r.unlocked,
      unlock_time: r.unlocked_at ?? null,
      global_percent: r.rarity ?? null,
      trophy_type: null as string | null,
      gamerscore: r.gamerscore ?? null,
    }))
    .sort(sortAchievements);
  return json({
    source,
    platform_label: "Xbox",
    game_title: gameTitle,
    total: achievements.length,
    unlocked: achievements.filter((a) => a.unlocked).length,
    achievements,
  });
};

// Unlocked first (most recent unlock on top), then locked by rarity.
function sortAchievements(a: any, b: any): number {
  if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
  if (a.unlocked) {
    const at = a.unlock_time ? new Date(a.unlock_time).getTime() : 0;
    const bt = b.unlock_time ? new Date(b.unlock_time).getTime() : 0;
    return bt - at;
  }
  const ap = a.global_percent ?? -1;
  const bp = b.global_percent ?? -1;
  return bp - ap;
}
