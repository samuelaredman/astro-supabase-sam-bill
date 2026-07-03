// All IGDB game_type values (formerly `category`, which IGDB deprecated — see
// scripts/backfill-game-metadata.ts), as returned by IGDB's `game_types` endpoint.
// Reference for adjusting ALLOWED_GAME_CATEGORIES below — same numbering as the
// old `category` enum.
export const GAME_CATEGORIES: Record<number, string> = {
  0: 'main_game',
  1: 'dlc_addon',
  2: 'expansion',
  3: 'bundle',
  4: 'standalone_expansion',
  5: 'mod',
  6: 'episode',
  7: 'season',
  8: 'remake',
  9: 'remaster',
  10: 'expanded_game',
  11: 'port',
  12: 'fork',
  13: 'pack',
  14: 'update',
};

// Categories treated as distinct, reviewable games. Categories outside this
// list are re-releases that duplicate an already-represented game (ports, DLC,
// bundles, mods, episodes, seasons, forks, packs, updates) — kept in the DB but
// excluded from browse/search/rankings/discovery so they don't clutter listings.
// `null` is treated as allowed since rows imported before this column existed,
// or delisted from IGDB, may lack a category value.
export const ALLOWED_GAME_CATEGORIES = [
  0,  // main_game
  2,  // expansion
  4,  // standalone_expansion
  8,  // remake
  9,  // remaster
  10, // expanded_game
];

const BUNDLE_CATEGORY = 3;

// Bundle-category games whose title marks them as a notable, actively-played
// edition (GOTY/Definitive/Collection/etc.) rather than a trivial repackage —
// these are surfaced even though `bundle` itself is excluded. Deliberately
// scoped to `bundle` only: `port` titles are almost always identical to the
// original release's title, so this heuristic wouldn't distinguish them anyway.
// Inexact by nature (title-based) — false negatives (a notable edition with
// unusual naming) can be added here as they're noticed.
const NOTABLE_EDITION_KEYWORDS = [
  'game of the year',
  'goty',
  'definitive edition',
  'complete edition',
  'legendary edition',
  'ultimate edition',
  'enhanced edition',
  'anniversary edition',
  'anthology',
  'trilogy',
  'collection',
];

const NOTABLE_EDITION_PATTERN = new RegExp(NOTABLE_EDITION_KEYWORDS.join('|'), 'i');

function isNotableEdition(category: number, title: string | null | undefined): boolean {
  return category === BUNDLE_CATEGORY && !!title && NOTABLE_EDITION_PATTERN.test(title);
}

export function isAllowedGameCategory(
  category: number | null | undefined,
  title?: string | null
): boolean {
  if (category == null || ALLOWED_GAME_CATEGORIES.includes(category)) return true;
  return isNotableEdition(category, title);
}

// PostgREST .or() filter string for direct (non-embedded) queries against `games`.
// Mirrors isAllowedGameCategory: allowed categories, plus bundle titles matching
// the notable-edition keyword list.
const notableEditionOrClauses = NOTABLE_EDITION_KEYWORDS
  .map(keyword => `title.ilike.*${keyword}*`)
  .join(',');

export const GAME_CATEGORY_OR_FILTER =
  `igdb_category.is.null,` +
  `igdb_category.in.(${ALLOWED_GAME_CATEGORIES.join(',')}),` +
  `and(igdb_category.eq.${BUNDLE_CATEGORY},or(${notableEditionOrClauses}))`;
