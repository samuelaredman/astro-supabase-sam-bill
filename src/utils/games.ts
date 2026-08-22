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

// ─── Canonical-node model (Phase 1) ──────────────────────────────────────────
// Additive to the legacy ALLOWED_GAME_CATEGORIES filter above, which stays the
// live browse/search filter until read-paths are flipped in Phase 5. These sets
// partition every IGDB game_type into how it behaves in the canonical graph.

// Collapse into a canonical node (ports/remasters/editions/packs). `version_parent`
// rows also collapse regardless of category — that's decided by resolution logic,
// not category alone. A collapse-type row with no resolvable parent stays a node.
export const COLLAPSE_CATEGORIES = [
  3,  // bundle (GOTY/Definitive/Complete editions)
  9,  // remaster (aggressive collapse — e.g. Skyrim Special Edition → Skyrim)
  11, // port
  13, // pack
];

// Separate, reviewable nodes, connected to a parent/series via game_relationships.
export const CONNECTED_CATEGORIES = [
  0,  // main_game (sequels are their own nodes, linked as series_sibling)
  1,  // dlc_addon (a node, but excluded from the main browse grid — see isBrowseGridNode)
  2,  // expansion
  4,  // standalone_expansion
  8,  // remake
  10, // expanded_game
];

// Never a node: imported for completeness but excluded from browse and reviews.
export const HIDDEN_CATEGORIES = [
  5,  // mod
  6,  // episode
  7,  // season
  12, // fork
  14, // update
];

export type GameNodeClass = 'collapse' | 'connected' | 'hidden';

// Classifies an IGDB game_type into its canonical-graph behavior. A null category
// (unbackfilled or delisted from IGDB) is treated as a reviewable node, matching
// the legacy allow-null behavior of isAllowedGameCategory.
export function classifyGameType(category: number | null | undefined): GameNodeClass {
  if (category == null) return 'connected';
  if (COLLAPSE_CATEGORIES.includes(category)) return 'collapse';
  if (HIDDEN_CATEGORIES.includes(category)) return 'hidden';
  return 'connected';
}

// True when this row is a reviewable node: it is canonical (nothing collapsed it
// into another row) and its category is not hidden. This is the Phase-5
// replacement for isAllowedGameCategory once canonical_game_id is populated.
export function isReviewableNode(
  category: number | null | undefined,
  canonicalGameId: string | null | undefined
): boolean {
  return canonicalGameId == null && classifyGameType(category) !== 'hidden';
}

// True when a reviewable node should appear in the main browse/search/rankings
// grid. DLC is a reviewable node but is surfaced only in the game's "DLC &
// expansions" panel, never the top-level grid.
export function isBrowseGridNode(
  category: number | null | undefined,
  canonicalGameId: string | null | undefined
): boolean {
  return isReviewableNode(category, canonicalGameId) && category !== 1;
}

// ─── IGDB relationship + Steam-appid ingestion (Phase 2) ─────────────────────
// These populate the typed game_relationships graph and game_steam_apps mapping.
// The pure derivation helpers below are unit-tested; the persist* wrappers do the
// DB resolution (IGDB id → internal uuid) and upserts, shared by the on-import
// path and the backfill script so the two never drift.

export type GameRelationType =
  | 'dlc' | 'expansion' | 'standalone_expansion' | 'remake'
  | 'expanded_game' | 'sequel' | 'series_sibling' | 'similar';

// The relationship an IGDB child (via its `parent_game`) has to that parent,
// keyed on the child's own game_type. Ports/remasters/bundles/packs collapse via
// canonical_game_id instead, so they produce no relationship edge here.
export function relationTypeForChildCategory(
  category: number | null | undefined
): GameRelationType | null {
  switch (category) {
    case 1:  return 'dlc';
    case 2:  return 'expansion';
    case 4:  return 'standalone_expansion';
    case 8:  return 'remake';
    case 10: return 'expanded_game';
    default: return null;
  }
}

// IGDB scalar relationship fields come back as a bare id, and array fields as
// bare ids too (when no sub-fields are requested) — but tolerate {id} objects.
export function asIgdbId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === 'object' && typeof (raw as any).id === 'number') return (raw as any).id;
  return null;
}

export interface IgdbRelationEdge {
  igdbId: number;              // the OTHER game, in IGDB id space
  relationType: GameRelationType;
  direction: 'out' | 'in';    // out: this game → other; in: other → this game
}

// IGDB reverse-array fields that belong to *this* game (this game is the primary
// node), each mapped to the edge type it represents.
const REVERSE_RELATION_FIELDS: Array<[string, GameRelationType]> = [
  ['dlcs', 'dlc'],
  ['expansions', 'expansion'],
  ['standalone_expansions', 'standalone_expansion'],
  ['expanded_games', 'expanded_game'],
  ['remakes', 'remake'],
];

// Pure: derive the intended relationship edges (still in IGDB-id space) from an
// IGDB game payload. `sequel`/`series_sibling` are NOT derived here — those come
// from collection membership in the Phase 3 canonical/relationship backfill.
export function deriveIgdbRelationEdges(igdbGame: any): IgdbRelationEdge[] {
  const edges: IgdbRelationEdge[] = [];

  for (const [field, relationType] of REVERSE_RELATION_FIELDS) {
    for (const raw of igdbGame?.[field] ?? []) {
      const igdbId = asIgdbId(raw);
      if (igdbId != null) edges.push({ igdbId, relationType, direction: 'out' });
    }
  }

  const parentId = asIgdbId(igdbGame?.parent_game);
  const parentType = relationTypeForChildCategory(igdbGame?.game_type);
  if (parentId != null && parentType) {
    edges.push({ igdbId: parentId, relationType: parentType, direction: 'in' });
  }

  // De-duplicate on (igdbId, relationType, direction).
  const seen = new Set<string>();
  return edges.filter((e) => {
    const key = `${e.igdbId}:${e.relationType}:${e.direction}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// IGDB external_games.category === 1 is Steam. Pure: pull distinct positive
// integer Steam appids out of an external_games array.
const IGDB_EXTERNAL_STEAM = 1;
export function collectSteamAppids(externalGames: any): number[] {
  const out = new Set<number>();
  for (const eg of externalGames ?? []) {
    if (eg?.category === IGDB_EXTERNAL_STEAM && eg?.uid != null) {
      const n = parseInt(String(eg.uid), 10);
      if (Number.isFinite(n) && n > 0) out.add(n);
    }
  }
  return [...out];
}

// Resolve derived edges against games already in the DB and upsert them. Edges to
// games not yet imported are skipped — the backfill's full pass (and later imports
// of those games) will complete them.
export async function persistGameRelationshipsFromIgdb(
  db: any, internalGameId: string, igdbGame: any
): Promise<void> {
  const edges = deriveIgdbRelationEdges(igdbGame);
  if (edges.length === 0) return;

  const igdbIds = [...new Set(edges.map((e) => e.igdbId))];
  const { data: rows } = await db.from('games').select('id, igdb_id').in('igdb_id', igdbIds);
  const byIgdb = new Map<number, string>((rows ?? []).map((r: any) => [r.igdb_id, r.id]));

  const junctionRows: any[] = [];
  for (const e of edges) {
    const other = byIgdb.get(e.igdbId);
    if (!other) continue;
    const from = e.direction === 'out' ? internalGameId : other;
    const to   = e.direction === 'out' ? other : internalGameId;
    if (from === to) continue;
    junctionRows.push({ from_game_id: from, to_game_id: to, relation_type: e.relationType, source: 'igdb' });
  }
  if (junctionRows.length > 0) {
    await db.from('game_relationships').upsert(junctionRows, {
      onConflict: 'from_game_id,to_game_id,relation_type',
      ignoreDuplicates: true,
    });
  }
}

// Persist the game's Steam appid(s) from IGDB external_games. onConflict on the
// appid PK keeps a given appid pointing at its most recently imported game.
export async function persistSteamAppsFromIgdb(
  db: any, internalGameId: string, igdbGame: any
): Promise<void> {
  const appids = collectSteamAppids(igdbGame?.external_games);
  if (appids.length === 0) return;
  await db.from('game_steam_apps').upsert(
    appids.map((steam_appid) => ({ steam_appid, game_id: internalGameId })),
    { onConflict: 'steam_appid' }
  );
}

// ─── Canonical resolution (Phase 3) ──────────────────────────────────────────
// Pure decision helpers used by scripts/backfill-canonical.ts. The script owns
// DB access, id → uuid resolution, one-level flattening, and the report/apply
// gating; these functions own the *rules*, and are unit-tested.

export interface CanonicalGameRow {
  id: string;
  igdb_category: number | null;
  date_released: string | null;
}

// The IGDB ids a collapse-type row might fold into, in precedence order:
// version_parent (an explicit "edition of X") beats parent_game.
export function collapseParentCandidates(game: {
  igdb_version_parent?: number | null;
  igdb_parent_game?: number | null;
}): number[] {
  const out: number[] = [];
  const vp = asIgdbId(game.igdb_version_parent);
  const pg = asIgdbId(game.igdb_parent_game);
  if (vp != null) out.push(vp);
  if (pg != null && pg !== vp) out.push(pg);
  return out;
}

// Normalized title key for exact-duplicate clustering — identical to the audit
// script (scripts/audit-game-categories.ts) so clusters line up between them.
// Also folds diacritics so "Pokémon" and "Pokemon" cluster together.
export function normalizeClusterTitle(title: string): string {
  return foldDiacritics(title).trim().toLowerCase().replace(/\s+/g, ' ');
}

// Choose the canonical node within a cluster: the earliest-released main_game
// (category 0 / null), or if the cluster has no main game, the earliest release
// overall. Deterministic — ties break on id. Returns null for an empty cluster.
export function chooseClusterCanonical(members: CanonicalGameRow[]): string | null {
  if (members.length === 0) return null;
  const mains = members.filter((m) => m.igdb_category === 0 || m.igdb_category == null);
  const pool = mains.length > 0 ? mains : members;
  const sorted = [...pool].sort((a, b) => {
    const da = a.date_released ?? '9999-99-99';
    const db_ = b.date_released ?? '9999-99-99';
    if (da !== db_) return da < db_ ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return sorted[0].id;
}

// Decomposes accented characters (e.g. "Ö" -> "O" + combining diaeresis) and
// drops the combining marks, so callers can compare/transliterate titles
// without accented letters silently failing to match their plain ASCII form.
export function foldDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function makeGameSlug(title: string, igdbSlug?: string): string {
  if (igdbSlug) return igdbSlug;
  return foldDiacritics(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
        fields game_type,
               parent_game, version_parent, version_title,
               dlcs, expansions, standalone_expansions, expanded_games, remakes,
               external_games.category, external_games.uid,
               genres.id, genres.name, genres.slug,
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
        await db.from('games').update({
          igdb_parent_game:    asIgdbId(g.parent_game),
          igdb_version_parent: asIgdbId(g.version_parent),
          version_title:       g.version_title ?? null,
        }).eq('id', existing.id);
        await Promise.all([
          upsertJunction(db, existing.id, g.genres,     'genres',     'game_genres',     'genre_id'),
          upsertJunction(db, existing.id, g.platforms,  'platforms',  'game_platforms',  'platform_id'),
          upsertJunction(db, existing.id, g.themes,     'themes',     'game_themes',     'theme_id'),
          upsertJunction(db, existing.id, g.game_modes, 'game_modes', 'game_game_modes', 'game_mode_id'),
          upsertJunction(db, existing.id, g.franchises, 'franchises', 'game_franchises', 'franchise_id'),
          upsertJunction(db, existing.id, g.collections,'collections','game_collections','collection_id'),
          persistGameRelationshipsFromIgdb(db, existing.id, g),
          persistSteamAppsFromIgdb(db, existing.id, g),
        ]);
      }
    }

    return { ok: true, game: existing };
  }

  const games = await igdbFetch("games", `
    fields name, slug, summary, storyline, game_type, status,
           first_release_date, cover.url,
           parent_game, version_parent, version_title,
           dlcs, expansions, standalone_expansions, expanded_games, remakes,
           external_games.category, external_games.uid,
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
      igdb_parent_game:    asIgdbId(game.parent_game),
      igdb_version_parent: asIgdbId(game.version_parent),
      version_title:       game.version_title ?? null,
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
    persistGameRelationshipsFromIgdb(db, inserted.id, game),
    persistSteamAppsFromIgdb(db, inserted.id, game),
  ]);

  return { ok: true, game: inserted };
}
