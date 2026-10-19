export const prerender = false;
import type { APIRoute } from "astro";
import { json } from "../../../utils/api";
import { igdbFetch } from "../../../utils/igdb";

// Diagnostic — asks IGDB for a candidate upcoming game's state so we can
// tell why a given title does/doesn't surface on /discover's upcoming
// reels. Reads nothing user-specific; IGDB data is public. DELETE AFTER
// the discover redesign ships.
//
// Usage: /api/debug/igdb-probe?q=Grand+Theft+Auto+VI

const DATE_FORMAT: Record<number, string> = {
  0: 'YYYY-MM-DD', 1: 'YYYY-MM', 2: 'YYYY-Q', 3: 'YYYY', 4: 'TBD',
  5: 'YYYYMMMM', 6: 'YYYY-Q', 7: 'YYYYMMMM',
};

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q');
  if (!q) return json({ error: 'Missing ?q=<title>' }, 400);

  const safe = q.replace(/"/g, '\\"');
  const games = await igdbFetch(
    'games',
    `fields id, name, slug, first_release_date, game_type, cover.image_id;
     search "${safe}";
     limit 5;`,
  );
  if (!Array.isArray(games)) return json({ q, hits: [] });

  const now = Math.floor(Date.now() / 1000);
  const out: any[] = [];
  for (const g of games.slice(0, 3)) {
    const rels = await igdbFetch(
      'release_dates',
      `fields date, date_format, human, platform.id, platform.name, region;
       where game = ${g.id};
       sort date asc;
       limit 30;`,
    );
    const relOut = Array.isArray(rels) ? rels.map((r: any) => ({
      iso: r.date ? new Date(r.date * 1000).toISOString().slice(0, 10) : null,
      future: r.date != null && r.date > now,
      date_format: r.date_format,
      format_label: DATE_FORMAT[r.date_format] ?? `fmt=${r.date_format}`,
      human: r.human ?? null,
      platform: r.platform?.name ?? null,
      platform_id: r.platform?.id ?? null,
      region: r.region ?? null,
    })) : [];
    out.push({
      igdb_id: g.id,
      name: g.name,
      slug: g.slug,
      first_release_date_iso: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
      first_release_date_future: g.first_release_date != null && g.first_release_date > now,
      game_type: g.game_type ?? null,
      cover_present: !!g.cover?.image_id,
      release_dates: relOut,
      // Why we would/wouldn't surface this on /discover upcoming reels:
      would_surface: {
        first_release_date_future: g.first_release_date != null && g.first_release_date > now,
        cover_present: !!g.cover?.image_id,
        game_type_allowed: [0, 2, 4, 8, 9, 10].includes(g.game_type),
      },
    });
  }
  return json({ q, now_unix: now, hits: out });
};
