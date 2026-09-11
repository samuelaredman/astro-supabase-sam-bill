import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";

// Client-side feed for the profile Achievements tab. Moved off the page's SSR
// path so opening the tab is a background fetch, not a full page navigation.
// Achievements are publicly readable (RLS: USING (true)) — no auth gate here,
// matching the previous in-page render.

const PER_PAGE = 50;

export const GET: APIRoute = async ({ url }) => {
  const db = getSupabaseAdmin() as any;
  const p = url.searchParams;

  const username = p.get("username");
  const page = Math.max(1, parseInt(p.get("page") || "1") || 1);
  const q = (p.get("q") || "").trim();
  const sort = p.get("sort") || "recent";
  const days = parseInt(p.get("days") || "0") || 0;

  if (!username) return json({ error: "username required" }, 400);

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (!profile) return json({ error: "Not found" }, 404);

  const filtered = !!(q || days > 0);

  // Feed page. count:exact only when filtered — otherwise the profile-wide total
  // is already known from get_achievement_stats() at no extra cost.
  let feed = db
    .from("user_achievements")
    .select(
      "display_name, description, icon_url, global_percent, unlock_time, steam_appid, api_name, steam_game_title, games(title)",
      filtered ? { count: "exact" } : undefined,
    )
    .eq("profile_id", profile.id)
    .eq("unlocked", true)
    .not("unlock_time", "is", null);

  if (q) feed = feed.ilike("display_name", `%${q}%`);
  if (days > 0)
    feed = feed.gte(
      "unlock_time",
      new Date(Date.now() - days * 86400000).toISOString(),
    );

  if (sort === "oldest") feed = feed.order("unlock_time", { ascending: true });
  else if (sort === "rarest")
    feed = feed.order("global_percent", { ascending: true, nullsFirst: false });
  else if (sort === "least-rare")
    feed = feed.order("global_percent", { ascending: false, nullsFirst: false });
  else if (sort === "az")
    feed = feed.order("display_name", { ascending: true, nullsFirst: false });
  else if (sort === "za")
    feed = feed.order("display_name", { ascending: false, nullsFirst: false });
  else feed = feed.order("unlock_time", { ascending: false });

  feed = feed.range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

  // Summary stats are profile-wide and filter-independent, so only fetch them on
  // page 1 — the client caches them across pagination.
  const statsPromise =
    page === 1
      ? db.rpc("get_achievement_stats", { p_profile_id: profile.id })
      : Promise.resolve({ data: null });

  const [{ data: rows, count, error }, { data: statsRows }] = await Promise.all([
    feed,
    statsPromise,
  ]);

  if (error) {
    console.error("[ach feed] error:", JSON.stringify(error));
    return json({ error: "Failed to load achievements" }, 500);
  }

  const items = (rows ?? []).map((a: any) => ({
    display_name: a.display_name ?? null,
    description: a.description ?? null,
    icon_url: a.icon_url ?? null,
    global_percent: a.global_percent ?? null,
    unlock_time: a.unlock_time ?? null,
    steam_appid: a.steam_appid ?? null,
    api_name: a.api_name ?? null,
    game_title: a.games?.title ?? a.steam_game_title ?? null,
  }));

  let stats: { unlocked: number; perfectGames: number; avgCompletion: number } | null = null;
  let total: number | null = null;

  if (page === 1) {
    const s = statsRows?.[0] ?? {
      unlocked_count: 0,
      perfect_games: 0,
      avg_completion: 0,
    };
    stats = {
      unlocked: Number(s.unlocked_count ?? 0),
      perfectGames: Number(s.perfect_games ?? 0),
      avgCompletion: Number(s.avg_completion ?? 0),
    };
    total = filtered ? count ?? 0 : stats.unlocked;
  } else if (filtered) {
    total = count ?? 0;
  }

  return json({ stats, items, page, perPage: PER_PAGE, total });
};
