// Game categories from IGDB's `game_type` field (formerly `category`, which IGDB
// deprecated — see scripts/backfill-game-metadata.ts). Categories outside this
// list are re-releases that duplicate an already-represented game (ports, DLC,
// bundles, mods, episodes, seasons, forks, packs, updates) — kept in the DB but
// excluded from browse/search/rankings/discovery so they don't clutter listings.
// `null` is treated as allowed since rows imported before this column existed,
// or delisted from IGDB, may lack a category value.
export const ALLOWED_GAME_CATEGORIES = [0, 2, 4, 8, 9, 10];

export function isAllowedGameCategory(category: number | null | undefined): boolean {
  return category == null || ALLOWED_GAME_CATEGORIES.includes(category);
}

// PostgREST .or() filter string for direct (non-embedded) queries against `games`.
export const GAME_CATEGORY_OR_FILTER =
  `igdb_category.is.null,igdb_category.in.(${ALLOWED_GAME_CATEGORIES.join(',')})`;
