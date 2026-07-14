import { igdbFetch } from './igdb';

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

function makeGameSlug(title: string, igdbSlug?: string): string {
  if (igdbSlug) return igdbSlug;
  // Decompose accented characters (e.g. "Ö" -> "O" + combining diaeresis) and
  // drop the combining marks so accented letters transliterate to their plain
  // ASCII form instead of being deleted outright by the char-class strip below.
  const transliterated = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return transliterated.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function upsertJunction(
  db: any,
  gameId: string,
  items: Array<{ id: number; name: string; slug?: string }> | null | undefined,
  refTable: string,
  junctionTable: string,
  junctionCol: string
): Promise<void> {
  for (const item of items ?? []) {
    await db.from(refTable).upsert(
      { igdb_id: item.id, name: item.name, slug: item.slug ?? null },
      { onConflict: 'igdb_id' }
    );
    const { data: row } = await db.from(refTable).select('id').eq('igdb_id', item.id).single();
    if (row) {
      await db.from(junctionTable).upsert(
        { game_id: gameId, [junctionCol]: row.id },
        { onConflict: `game_id,${junctionCol}` }
      );
    }
  }
}

export type ImportGameResult =
  | { ok: true; game: { id: string; title: string; slug: string; cover_img_url: string | null; date_released: string | null } }
  | { ok: false; error: string; status: number };

/**
 * Imports a game from IGDB by igdb_id if it isn't already in the DB
 * (refreshing missing junction data if it is). Shared by the user-facing
 * "add a game" flow (api/games/import.ts) and the admin unmatched-titles
 * importer (api/admin/unmatched-games/import.ts) — kept in one place so a
 * fix to one doesn't silently miss the other.
 */
export async function importGameByIgdbId(db: any, igdbId: number): Promise<ImportGameResult> {
  const { data: existing } = await db
    .from('games')
    .select('id, title, slug, cover_img_url, date_released')
    .eq('igdb_id', igdbId)
    .maybeSingle();

  if (existing) {
    const [
      { count: platformCount },
      { count: genreCount },
      { count: themeCount },
      { count: modeCount },
    ] = await Promise.all([
      db.from('game_platforms').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
      db.from('game_genres').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
      db.from('game_themes').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
      db.from('game_game_modes').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
    ]);

    const needsRefresh =
      (platformCount ?? 0) === 0 ||
      (genreCount ?? 0) === 0 ||
      (themeCount ?? 0) === 0 ||
      (modeCount ?? 0) === 0;

    if (needsRefresh) {
      const refresh = await igdbFetch("games", `
        fields genres.id, genres.name, genres.slug,
               platforms.id, platforms.name, platforms.slug,
               themes.id, themes.name, themes.slug,
               game_modes.id, game_modes.name, game_modes.slug,
               franchises.id, franchises.name, franchises.slug,
               collections.id, collections.name, collections.slug;
        where id = ${igdbId};
        limit 1;
      `);
      const g = refresh?.[0];
      if (g) {
        await Promise.all([
          upsertJunction(db, existing.id, g.genres,     'genres',     'game_genres',     'genre_id'),
          upsertJunction(db, existing.id, g.platforms,  'platforms',  'game_platforms',  'platform_id'),
          upsertJunction(db, existing.id, g.themes,     'themes',     'game_themes',     'theme_id'),
          upsertJunction(db, existing.id, g.game_modes, 'game_modes', 'game_game_modes', 'game_mode_id'),
          upsertJunction(db, existing.id, g.franchises, 'franchises', 'game_franchises', 'franchise_id'),
          upsertJunction(db, existing.id, g.collections,'collections','game_collections','collection_id'),
        ]);
      }
    }

    return { ok: true, game: existing };
  }

  const games = await igdbFetch("games", `
    fields name, slug, summary, storyline, game_type, status,
           first_release_date, cover.url,
           genres.id, genres.name, genres.slug,
           platforms.id, platforms.name, platforms.slug,
           themes.id, themes.name, themes.slug,
           game_modes.id, game_modes.name, game_modes.slug,
           franchises.id, franchises.name, franchises.slug,
           collections.id, collections.name, collections.slug;
    where id = ${igdbId};
    limit 1;
  `);

  if (!games || games.length === 0) return { ok: false, error: 'Game not found on IGDB', status: 404 };

  const game = games[0];
  const coverUrl = game.cover?.url
    ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}`
    : null;

  const slug = makeGameSlug(game.name, game.slug);
  const { data: slugConflict } = await db.from('games').select('id').eq('slug', slug).maybeSingle();
  const finalSlug = slugConflict ? `${slug}-${igdbId}` : slug;

  const { data: inserted, error: insertError } = await db
    .from('games')
    .insert({
      title:            game.name,
      slug:             finalSlug,
      game_description: game.summary   ?? null,
      storyline:        game.storyline ?? null,
      igdb_category:    game.game_type ?? null,
      igdb_status:      game.status    ?? null,
      cover_img_url:    coverUrl,
      date_released:    game.first_release_date
        ? new Date(game.first_release_date * 1000).toISOString().split('T')[0]
        : null,
      igdb_id: game.id,
    })
    .select('id, title, slug, cover_img_url, date_released')
    .single();

  if (insertError) {
    console.error('[importGameByIgdbId] DB insert error:', JSON.stringify(insertError));
    return { ok: false, error: `Failed to import game: ${insertError.message}`, status: 500 };
  }

  await Promise.all([
    upsertJunction(db, inserted.id, game.genres,     'genres',     'game_genres',     'genre_id'),
    upsertJunction(db, inserted.id, game.platforms,  'platforms',  'game_platforms',  'platform_id'),
    upsertJunction(db, inserted.id, game.themes,     'themes',     'game_themes',     'theme_id'),
    upsertJunction(db, inserted.id, game.game_modes, 'game_modes', 'game_game_modes', 'game_mode_id'),
    upsertJunction(db, inserted.id, game.franchises, 'franchises', 'game_franchises', 'franchise_id'),
    upsertJunction(db, inserted.id, game.collections,'collections','game_collections','collection_id'),
  ]);

  return { ok: true, game: inserted };
}
