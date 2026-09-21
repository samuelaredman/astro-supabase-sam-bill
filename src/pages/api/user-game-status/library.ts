import type { APIRoute } from "astro";
import { getSupabaseAdmin, createSupabaseServerClientFromContext } from "../../../utils/database";
import { json } from "../../../utils/api";
import { queryLibraryPage, LIBRARY_PAGE_SIZE, applyPlatformFilter } from "../../../utils/libraryQuery";

// Thin HTTP wrapper around queryLibraryPage. The reviewer profile's Library
// tab SSR calls the same function directly (via loadLibraryTab in
// profileTabs.ts) to inline page 1 into its HTML fragment — this endpoint
// stays for filter/sort/pagination changes after the tab is mounted, plus
// the idsOnly and letterMap paths below.
export const GET: APIRoute = async (context) => {
  const db = getSupabaseAdmin() as any;
  const p = context.url.searchParams;

  const username   = p.get('username');
  const page       = Math.max(1, parseInt(p.get('page') || '1'));
  const filter     = p.get('filter') || 'all';
  const sort       = p.get('sort')   || 'alpha';
  const search     = (p.get('search') || '').trim();
  const genre      = (p.get('genre') || '').trim();
  const platform   = (p.get('platform') || '').trim();
  const dev        = (p.get('dev') || '').trim();
  const showHidden = p.get('hidden') === 'true';

  if (!username) return json({ error: 'username required' }, 400);

  const { data: profile } = await db
    .from('profiles')
    .select('id, want_to_play_privacy, dropped_privacy')
    .eq('username', username)
    .single();
  if (!profile) return json({ error: 'Not found' }, 404);

  const { data: libSettings } = await db
    .from('profile_library_settings')
    .select('library_visibility')
    .eq('profile_id', profile.id)
    .maybeSingle();
  const libraryVisibility = libSettings?.library_visibility ?? 'public';

  let isOwn = false;
  let isMutualFollow = false;
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (user) {
    const { data: vp } = await db.from('profiles').select('id').eq('auth_user_id', user.id).single();
    if (vp) {
      isOwn = vp.id === profile.id;
      if (!isOwn) {
        const [{ data: f1 }, { data: f2 }] = await Promise.all([
          db.from('follows').select('id').eq('follower_id', profile.id).eq('following_id', vp.id).maybeSingle(),
          db.from('follows').select('id').eq('follower_id', vp.id).eq('following_id', profile.id).maybeSingle(),
        ]);
        isMutualFollow = !!(f1 && f2);
      }
    }
  }

  if (libraryVisibility === 'private' && !isOwn)
    return json({ items: [], total: 0, page: 1, pageSize: LIBRARY_PAGE_SIZE, hasMore: false });

  const canSeeWantToPlay = isOwn || !(
    profile.want_to_play_privacy === 'private' ||
    (profile.want_to_play_privacy === 'friends' && !isMutualFollow)
  );
  const canSeeDropped = isOwn || !(
    profile.dropped_privacy === 'private' ||
    (profile.dropped_privacy === 'friends' && !isMutualFollow)
  );

  // "Select all" bulk-edit path — return every matching game id across all pages,
  // paginating past the 1000-row PostgREST cap. Uses buildQuery directly rather
  // than the full item pipeline since only ids are needed.
  if (p.get('idsOnly') === 'true') {
    return await idsOnly(db, profile.id, {
      isOwn, canSeeWantToPlay, canSeeDropped,
      filter, sort, search, genre, platform, dev, showHidden,
    });
  }

  // A-Z jump bar — map each starting letter to the page + game id of its first
  // entry. Only meaningful for the alpha sort.
  if (p.get('letterMap') === 'true') {
    return await letterMap(db, profile.id, {
      isOwn, canSeeWantToPlay, canSeeDropped,
      filter, sort, search, genre, platform, dev, showHidden,
    });
  }

  try {
    const result = await queryLibraryPage(db, {
      profileId: profile.id,
      isOwn,
      canSeeWantToPlay,
      canSeeDropped,
      page, filter, sort, search, genre, platform, dev, showHidden,
    });
    return json(result);
  } catch (e) {
    return json({ error: 'Failed to load library' }, 500);
  }
};

// ── idsOnly + letterMap paths ────────────────────────────────────────────────
//
// Both walk the same filtered result set but need different projections:
// idsOnly is a bulk-edit "select every visible game" call, letterMap is the
// A-Z sidebar. They inline buildQuery instead of using queryLibraryPage
// because they don't need the item pipeline (source split, achievement
// counts, etc.) — just ids + titles, streamed past PostgREST's 1000-row cap.

type FilterParams = {
  isOwn: boolean;
  canSeeWantToPlay: boolean;
  canSeeDropped: boolean;
  filter: string;
  sort: string;
  search: string;
  genre: string;
  platform: string;
  dev: string;
  showHidden: boolean;
};

function buildFilteredQuery(
  db: any,
  profileId: string,
  gamesSelect: string,
  ugsSelect: string,
  base: 'games' | 'ugs',
  p: FilterParams,
) {
  const { isOwn, canSeeWantToPlay, canSeeDropped, filter, search, genre, platform, dev, showHidden } = p;
  // Platform filter is a source-column check on user_game_status
  // (applyPlatformFilter) rather than an IGDB game_platforms join — same
  // rule as queryLibraryPage's own builder.
  const dimJoins: string[] = [];
  if (genre) dimJoins.push('game_genres!inner(genres!inner(name))');
  if (dev)   dimJoins.push('game_companies!inner(role,developers!inner(name))');
  const gamesSel = dimJoins.length ? `${gamesSelect}, ${dimJoins.join(', ')}` : gamesSelect;

  let qb = base === 'ugs'
    ? db.from('user_game_status').select(`${ugsSelect}, games!inner(${gamesSel})`).eq('profile_id', profileId)
    : db.from('games').select(`${gamesSel}, user_game_status!inner(${ugsSelect})`).eq('user_game_status.profile_id', profileId);

  const c = (col: string) => (base === 'ugs' ? col : `user_game_status.${col}`);
  const g = (path: string) => (base === 'ugs' ? `games.${path}` : path);

  if (genre) qb = qb.eq(g('game_genres.genres.name'), genre);
  if (dev) {
    qb = qb.eq(g('game_companies.role'), 'developer');
    qb = qb.eq(g('game_companies.developers.name'), dev);
  }
  if (platform) qb = applyPlatformFilter(qb, platform, c);
  if (showHidden && isOwn) {
    qb = qb.eq(c('is_hidden'), true);
  } else {
    qb = qb.eq(c('is_hidden'), false);
    if (!canSeeWantToPlay) qb = qb.neq(c('status'), 'want_to_play');
    if (!canSeeDropped)    qb = qb.neq(c('status'), 'dropped');
  }
  if (filter === 'owned') {
    qb = qb.eq(c('is_owned'), true);
  } else if (filter === 'completed') {
    qb = qb.in(c('status'), ['completed', 'hundred_percent']);
  } else if (filter === 'unplayed') {
    qb = qb.not(c('status'), 'in', '(completed,hundred_percent)');
    if (base === 'ugs') {
      qb = qb.or('steam_playtime_minutes.is.null,steam_playtime_minutes.eq.0');
      qb = qb.or('psn_playtime_minutes.is.null,psn_playtime_minutes.eq.0');
      qb = qb.or('xbox_current_gamerscore.is.null,xbox_current_gamerscore.eq.0');
    } else {
      qb = qb.or('steam_playtime_minutes.is.null,steam_playtime_minutes.eq.0', { referencedTable: 'user_game_status' });
      qb = qb.or('psn_playtime_minutes.is.null,psn_playtime_minutes.eq.0',   { referencedTable: 'user_game_status' });
      qb = qb.or('xbox_current_gamerscore.is.null,xbox_current_gamerscore.eq.0', { referencedTable: 'user_game_status' });
    }
  } else if (filter !== 'all') {
    qb = qb.eq(c('status'), filter);
  }
  if (search) qb = qb.ilike(base === 'ugs' ? 'games.title' : 'title', `%${search}%`);
  return qb;
}

async function idsOnly(db: any, profileId: string, p: FilterParams) {
  const CHUNK = 1000;
  const ids: string[] = [];
  for (let start = 0; ; start += CHUNK) {
    const { data: idRows, error: idErr } = await buildFilteredQuery(db, profileId, 'id', 'profile_id', 'games', p)
      .range(start, start + CHUNK - 1);
    if (idErr) {
      console.error('[library API] idsOnly error:', JSON.stringify(idErr));
      return json({ error: 'Failed to load library' }, 500);
    }
    for (const r of idRows ?? []) ids.push((r as any).id);
    if (!idRows || idRows.length < CHUNK) break;
  }
  return json({ ids });
}

async function letterMap(db: any, profileId: string, p: FilterParams) {
  const map: Record<string, { page: number; gameId: string }> = {};
  if (p.sort !== 'alpha') return json({ letterMap: map });
  const CHUNK = 1000;
  let idx = 0;
  for (let start = 0; ; start += CHUNK) {
    const { data: rows, error: lmErr } = await buildFilteredQuery(db, profileId, 'id, title', 'profile_id', 'games', p)
      .order('title', { ascending: true })
      .range(start, start + CHUNK - 1);
    if (lmErr) {
      console.error('[library API] letterMap error:', JSON.stringify(lmErr));
      return json({ error: 'Failed to load library' }, 500);
    }
    for (const r of rows ?? []) {
      const ch = String((r as any).title ?? '').trim().charAt(0).toUpperCase();
      const key = ch >= 'A' && ch <= 'Z' ? ch : '#';
      if (map[key] === undefined) {
        map[key] = { page: Math.floor(idx / LIBRARY_PAGE_SIZE) + 1, gameId: (r as any).id };
      }
      idx++;
    }
    if (!rows || rows.length < CHUNK) break;
  }
  return json({ letterMap: map });
}
