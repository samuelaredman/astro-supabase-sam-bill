// Resolve a Backloggd game reference to a Chekpoint `games.id`, importing it
// from IGDB if we don't have it yet. Shared by the review import and the library
// import so "any game brought over from Backloggd" is matched identically and
// added from IGDB when missing.
//
// Cascade (stops at first hit):
//   1. local games.slug == slug
//   2. local games.slug == slug with a trailing "--N" disambiguator stripped
//   3. IGDB game with that exact slug           -> importGameByIgdbId
//   4. IGDB game with the stripped slug         -> importGameByIgdbId
//   5. local fuzzy (search_games) gated on title + release year
//   6. IGDB search by title, gated on title + release year -> importGameByIgdbId
// Returns null only when the game can't be identified at all.

import { ALLOWED_GAME_CATEGORIES, foldDiacritics, importGameByIgdbId } from "../games";
import { escapeIgdbString, igdbFetch, igdbGameBySlug } from "../igdb";

export type GameMatch = { gameId: string; method: string; imported: boolean };

const norm = (s: string) => foldDiacritics(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function titlesMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

function yearOk(target: number | null | undefined, dateReleased: string | null | undefined): boolean {
  if (target == null || !dateReleased) return true;
  return new Date(dateReleased).getFullYear() === target;
}

const stripDisambiguator = (slug: string) => slug.replace(/--\d+$/, "");

export type MatchInput = { slug: string; title: string; year: number | null };

export async function matchOrImportGame(db: any, input: MatchInput): Promise<GameMatch | null> {
  const slug = input.slug.trim().toLowerCase();
  const base = stripDisambiguator(slug);

  // 1 + 2 — local slug (exact, then without a trailing "--N")
  const localSlugs = base !== slug ? [slug, base] : [slug];
  const { data: localRows } = await db.from("games").select("id, slug").in("slug", localSlugs);
  for (const want of localSlugs) {
    const hit = (localRows ?? []).find((r: { slug: string }) => r.slug === want);
    if (hit) return { gameId: hit.id, method: "slug", imported: false };
  }

  // 3 + 4 — IGDB by slug
  for (const candidate of localSlugs) {
    const igdb = await igdbGameBySlug(candidate);
    if (igdb) {
      const res = await importGameByIgdbId(db, igdb.id);
      if (res.ok) return { gameId: res.game.id, method: "igdb-slug", imported: true };
    }
  }

  // 5 — local fuzzy, gated on title + year
  const { data: candidates } = await db.rpc("search_games", {
    search_query: input.title,
    result_limit: 3,
  });
  const localFuzzy = Array.isArray(candidates) ? candidates[0] : null;
  if (localFuzzy && titlesMatch(localFuzzy.title ?? "", input.title) && yearOk(input.year, localFuzzy.date_released)) {
    return { gameId: localFuzzy.id, method: "fuzzy", imported: false };
  }

  // 6 — IGDB search by title, gated on title + year, then import
  const rows = await igdbFetch(
    "games",
    `fields id, name, slug, first_release_date;
     search "${escapeIgdbString(input.title)}";
     where game_type = (${ALLOWED_GAME_CATEGORIES.join(",")});
     limit 5;`,
  );
  const igdbHit = (Array.isArray(rows) ? rows : []).find((g: any) => {
    if (!titlesMatch(g.name ?? "", input.title)) return false;
    const y = g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null;
    return input.year == null || y == null || y === input.year;
  });
  if (igdbHit) {
    const res = await importGameByIgdbId(db, igdbHit.id);
    if (res.ok) return { gameId: res.game.id, method: "igdb-search", imported: true };
  }

  return null;
}
