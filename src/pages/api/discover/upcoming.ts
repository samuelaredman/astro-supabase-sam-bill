import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { cdnCacheHeaders } from "../../../utils/cache";
import { fetchUpcomingReleases, type UpcomingGame } from "../../../utils/igdb";

// IGDB is the source of truth for the release calendar — we don't maintain a
// local upcoming-games table. One upstream call per cache window per filter
// combo. See the plan in CLAUDE.md's /discover redesign notes.
//
// Cache: 30 min fresh + 1 h SWR on Netlify's durable cache. First visitor
// warms it, everyone else gets it from the edge. Logged-in/anon are the same
// cached response — the only user-dependent flag we add is `imported`, which
// is identical for all visitors because it reflects global DB state.

const DEFAULT_WINDOW_DAYS = 60;
const MAX_WINDOW_DAYS = 365;

type ApiResponse = {
  games: (UpcomingGame & { chekpoint_slug: string | null })[];
  has_more: boolean;
};

export const GET: APIRoute = async ({ url }) => {
  const now = Math.floor(Date.now() / 1000);
  const fromUnix = Number(url.searchParams.get('from')) || now;
  const windowDays = Math.min(
    Math.max(Number(url.searchParams.get('days')) || DEFAULT_WINDOW_DAYS, 7),
    MAX_WINDOW_DAYS,
  );
  const toUnix = fromUnix + windowDays * 86400;

  const platformsParam = url.searchParams.get('platforms');
  const platforms = platformsParam
    ? platformsParam
        .split(',')
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    : undefined;

  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 10), 100);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  const games = await fetchUpcomingReleases({ fromUnix, toUnix, platforms, limit: limit + 1, offset });

  const hasMore = games.length > limit;
  const trimmed = hasMore ? games.slice(0, limit) : games;

  // Mark which games we've already imported, so the client can route a card
  // click straight to /games/<slug> instead of going through the on-demand
  // import flow. Service role — the games table is public-readable anyway.
  let bySlug = new Map<number, string>();
  if (trimmed.length > 0) {
    const db = getSupabaseAdmin() as any;
    const ids = trimmed.map((g) => g.igdb_id);
    const { data: existing } = await db
      .from('games')
      .select('igdb_id, slug')
      .in('igdb_id', ids);
    for (const row of (existing as any[]) ?? []) {
      if (row.slug) bySlug.set(Number(row.igdb_id), String(row.slug));
    }
  }

  const body: ApiResponse = {
    games: trimmed.map((g) => ({ ...g, chekpoint_slug: bySlug.get(g.igdb_id) ?? null })),
    has_more: hasMore,
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...cdnCacheHeaders(1800, 3600),
    },
  });
};
