const IGDB_URL = "https://api.igdb.com/v4";

// Escapes a user-supplied term for interpolation into an APIcalypse string
// literal (e.g. `search "${term}";` / `where name ~ *"${term}"*;`) — without
// this, a query containing a literal `"` breaks the query syntax.
export function escapeIgdbString(term: string): string {
  return term.replace(/[\\"]/g, '\\$&');
}

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const clientId = import.meta.env.IGDB_CLIENT_ID || process.env.IGDB_CLIENT_ID;
  const clientSecret = import.meta.env.IGDB_CLIENT_SECRET || process.env.IGDB_CLIENT_SECRET;

  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  );

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
  return cachedToken as string;
}

export async function igdbFetch(endpoint: string, query: string) {
  const clientId = import.meta.env.IGDB_CLIENT_ID || process.env.IGDB_CLIENT_ID;
  const token = await getAccessToken();

  const res = await fetch(`${IGDB_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': clientId ?? '',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: query,
  });

  if (!res.ok) return null;
  return res.json();
}

/**
 * Resolve an IGDB game by its exact slug. Backloggd (like us) is IGDB-backed and
 * its game URLs use the IGDB slug, so this is the reliable second step in the
 * Backloggd import's game-matching cascade (after a local `games.slug` lookup).
 * Returns `{ id, name, slug }` or null.
 */
export async function igdbGameBySlug(
  slug: string,
): Promise<{ id: number; name: string; slug: string } | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean) return null;
  const rows = await igdbFetch(
    "games",
    `fields id, name, slug; where slug = "${escapeIgdbString(clean)}"; limit 1;`,
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  return row && typeof row.id === "number" ? { id: row.id, name: row.name, slug: row.slug } : null;
}

/** IGDB platform ids for the small set of platforms exposed on the Discover
 *  release calendar. Full list: https://api-docs.igdb.com/#platform. */
export const IGDB_PLATFORM = {
  pc: 6,            // Microsoft Windows
  ps5: 167,
  ps4: 48,
  xbox_series: 169,
  xbox_one: 49,
  switch: 130,
} as const;

/** Platforms visible as filter chips on /discover's upcoming reels. */
export const DISCOVER_PLATFORM_FILTER: { key: keyof typeof IGDB_PLATFORM; label: string; igdbId: number }[] = [
  { key: 'pc', label: 'PC', igdbId: IGDB_PLATFORM.pc },
  { key: 'ps5', label: 'PS5', igdbId: IGDB_PLATFORM.ps5 },
  { key: 'xbox_series', label: 'Xbox', igdbId: IGDB_PLATFORM.xbox_series },
  { key: 'switch', label: 'Switch', igdbId: IGDB_PLATFORM.switch },
  { key: 'ps4', label: 'PS4', igdbId: IGDB_PLATFORM.ps4 },
];

export interface UpcomingGame {
  igdb_id: number;
  igdb_slug: string | null;
  title: string;
  cover_url: string | null;        // t_cover_big
  release_date: string;             // ISO yyyy-mm-dd
  release_unix: number;             // UTC seconds; stable for client-side grouping
  platforms: { id: number; name: string; abbrev: string | null }[];
  genres: string[];
}

/**
 * Pull upcoming full-game releases from IGDB. `category = 0` restricts to main
 * games (no DLC/bundles/mods), `first_release_date` is UTC seconds, `cover !=
 * null` drops entries with no artwork since they look broken in the reels.
 *
 * Platform filter is OR'd — passing `[167, 169]` returns games launching on
 * either PS5 OR Xbox Series. Omitted ⇒ no platform constraint.
 */
export async function fetchUpcomingReleases(opts: {
  fromUnix: number;
  toUnix: number;
  platforms?: number[];
  limit?: number;
  offset?: number;
}): Promise<UpcomingGame[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  const offset = opts.offset ?? 0;
  const platformClause = opts.platforms && opts.platforms.length > 0
    ? ` & platforms = (${opts.platforms.map((n) => Number(n)).filter(Number.isFinite).join(',')})`
    : '';

  const rows = await igdbFetch(
    'games',
    `
      fields name, slug, first_release_date, cover.image_id,
             platforms.id, platforms.name, platforms.abbreviation,
             genres.name;
      where first_release_date > ${Math.floor(opts.fromUnix)}
        & first_release_date < ${Math.floor(opts.toUnix)}
        & category = 0
        & cover != null${platformClause};
      sort first_release_date asc;
      limit ${limit};
      offset ${offset};
    `,
  );

  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: any): UpcomingGame | null => {
      if (!r?.id || !r?.name || !r?.first_release_date) return null;
      const unix = Number(r.first_release_date);
      if (!Number.isFinite(unix)) return null;
      const iso = new Date(unix * 1000).toISOString().slice(0, 10);
      const coverId = r?.cover?.image_id ?? null;
      return {
        igdb_id: Number(r.id),
        igdb_slug: typeof r.slug === 'string' ? r.slug : null,
        title: String(r.name),
        cover_url: coverId ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${coverId}.jpg` : null,
        release_date: iso,
        release_unix: unix,
        platforms: Array.isArray(r.platforms)
          ? r.platforms
              .filter((p: any) => p && typeof p.id === 'number')
              .map((p: any) => ({ id: p.id, name: p.name ?? '', abbrev: p.abbreviation ?? null }))
          : [],
        genres: Array.isArray(r.genres)
          ? r.genres.map((g: any) => g?.name).filter((n: unknown): n is string => typeof n === 'string')
          : [],
      };
    })
    .filter((g): g is UpcomingGame => !!g);
}

export async function getGameDetails(igdbId: number) {
  const [_, involvedCompanies, genres, gameModes, themes,
         franchises, engines, alternativeTitles, keywords] = await Promise.all([
    igdbFetch("games", `
      fields name, summary, first_release_date,
              involved_companies, genres, game_modes,
              themes, franchises, game_engines,
              alternative_names, keywords;
      where id = ${igdbId};
      limit 1;
    `),
    igdbFetch("involved_companies", `
      fields company.name, company.slug, developer, publisher, supporting;
      where game = ${igdbId};
      limit 20;
    `),
    igdbFetch("genres", `
      fields name, slug;
      where game = (${igdbId});
      limit 10;
    `),
    igdbFetch("game_modes", `
      fields name, slug;
      where games = (${igdbId});
      limit 10;
    `),
    igdbFetch("themes", `
      fields name, slug;
      where games = (${igdbId});
      limit 10;
    `),
    igdbFetch("franchises", `
      fields name, slug;
      where games = (${igdbId});
      limit 5;
    `),
    igdbFetch("game_engines", `
      fields name, slug;
      where games = (${igdbId});
      limit 5;
    `),
    igdbFetch("alternative_names", `
      fields name, comment;
      where game = ${igdbId};
      limit 10;
    `),
    igdbFetch("keywords", `
      fields name, slug;
      where games = (${igdbId});
      limit 20;
    `),
  ]);

  const companies: {
    main_developers: any[];
    supporting_developers: any[];
    publishers: any[];
  } = {
    main_developers: [],
    supporting_developers: [],
    publishers: [],
  };

  if (involvedCompanies) {
    for (const ic of involvedCompanies) {
      if (!ic.company) continue;
      if (ic.developer && !ic.supporting) companies.main_developers.push(ic.company);
      if (ic.supporting) companies.supporting_developers.push(ic.company);
      if (ic.publisher) companies.publishers.push(ic.company);
    }
  }

  return {
    companies,
    genres: genres ?? [],
    game_modes: gameModes ?? [],
    themes: themes ?? [],
    franchises: franchises ?? [],
    engines: engines ?? [],
    alternative_titles: alternativeTitles ?? [],
    keywords: keywords ?? [],
  };
}
