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

  // Feed page. Reads from the user_unlocks view, which unions Steam
  // achievements and PSN trophies into one stream. Column aliases in the view
  // match the shape the client already renders — display_name, global_percent,
  // unlock_time, game_title — so only the platform tagging (source,
  // trophy_type, platform_label) is new. count:exact only when filtered —
  // otherwise the profile-wide unlock total already came from
  // get_achievement_stats() (Steam-only right now; trophies are counted
  // separately in the stream but the top-line stat still reflects Steam
  // achievements only).
  let feed = db
    .from("user_unlocks")
    .select(
      "source, display_name, description, icon_url, global_percent, unlock_time, external_id, api_name, game_title, trophy_type, platform_label",
      filtered ? { count: "exact" } : undefined,
    )
    .eq("profile_id", profile.id);

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
    // Steam-only. Kept for the "App 12345" fallback game title the client
    // renders when we couldn't resolve the game — Steam rows carry appid as
    // text via the view.
    steam_appid: a.source === 'steam' ? a.external_id ?? null : null,
    api_name: a.api_name ?? null,
    game_title: a.game_title ?? null,
    // New: platform tagging so the client can group by (day, source) and
    // render a per-day section per platform.
    source: a.source ?? null,
    trophy_type: a.trophy_type ?? null,
    platform_label: a.platform_label ?? null,
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
