import type { APIRoute } from "astro";
import { getSupabaseAdmin, createSupabaseServerClientFromContext } from "../../../utils/database";
import { json } from "../../../utils/api";

const PAGE_SIZE = 96;

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

  // Auth
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
    return json({ items: [], total: 0, page: 1, pageSize: PAGE_SIZE, hasMore: false });

  const canSeeWantToPlay = isOwn || !(
    profile.want_to_play_privacy === 'private' ||
    (profile.want_to_play_privacy === 'friends' && !isMutualFollow)
  );
  const canSeeDropped = isOwn || !(
    profile.dropped_privacy === 'private' ||
    (profile.dropped_privacy === 'friends' && !isMutualFollow)
  );

  // A top-level PostgREST query cannot ORDER BY an *embedded* resource's column
  // (it only sorts rows within the embed), so we pivot the query onto whichever
  // table actually owns the sort column:
  //   alpha / review  → FROM games            (native ORDER BY games.title)
  //   hours / recent  → FROM user_game_status (native ORDER BY its own columns)
  // `review` ("has review first") has no column to sort on here — the caller
  // owns the review map — so it rides the games/title path and is reordered
  // client-side.
  const ugsBase = sort === 'hours' || sort === 'recent';

  // Factored out so the id-only "select all" and letter-map paths apply
  // identical filters. `base` overrides the pivot for paths where order is
  // irrelevant and the games table is simpler to read from.
  const buildQuery = (
    gamesSelect: string,
    ugsSelect: string,
    opts?: any,
    base: 'games' | 'ugs' = ugsBase ? 'ugs' : 'games',
  ) => {
    // Filter-only inner joins through the game↔dimension junctions — appended to
    // the select purely so the matching .eq() below can drop non-matching games
    // (the client never reads these back). Dimension names are all UNIQUE and
    // match the dropdown values built in the page frontmatter.
    const dimJoins: string[] = [];
    if (genre)    dimJoins.push('game_genres!inner(genres!inner(name))');
    if (platform) dimJoins.push('game_platforms!inner(platforms!inner(name))');
    if (dev)      dimJoins.push('game_companies!inner(role,developers!inner(name))');
    const gamesSel = dimJoins.length ? `${gamesSelect}, ${dimJoins.join(', ')}` : gamesSelect;

    let qb =
      base === 'ugs'
        ? db
            .from('user_game_status')
            .select(`${ugsSelect}, games!inner(${gamesSel})`, opts)
            .eq('profile_id', profile.id)
        : db
            .from('games')
            .select(`${gamesSel}, user_game_status!inner(${ugsSelect})`, opts)
            .eq('user_game_status.profile_id', profile.id);

    // Column reference: bare on the ugs base, prefixed when embedded.
    const c = (col: string) => (base === 'ugs' ? col : `user_game_status.${col}`);
    // Same, for filters that live on the games side of a ugs-base query.
    const g = (path: string) => (base === 'ugs' ? `games.${path}` : path);

    // Genre / platform / developer filters (dimension name, via the junctions).
    if (genre)    qb = qb.eq(g('game_genres.genres.name'), genre);
    if (platform) qb = qb.eq(g('game_platforms.platforms.name'), platform);
    if (dev) {
      qb = qb.eq(g('game_companies.role'), 'developer');
      qb = qb.eq(g('game_companies.developers.name'), dev);
    }

    // Visibility
    if (showHidden && isOwn) {
      qb = qb.eq(c('is_hidden'), true);
    } else {
      qb = qb.eq(c('is_hidden'), false);
      if (!canSeeWantToPlay) qb = qb.neq(c('status'), 'want_to_play');
      if (!canSeeDropped)    qb = qb.neq(c('status'), 'dropped');
    }

    // Status filter
    if (filter === 'owned') {
      qb = qb.eq(c('is_owned'), true);
    } else if (filter === 'completed') {
      qb = qb.in(c('status'), ['completed', 'hundred_percent']);
    } else if (filter === 'unplayed') {
      // "no playtime and not finished". The playtime OR must be phrased as a
      // filter *on* the embedded resource (`user_game_status.or=(…)`), not a
      // top-level `or=(user_game_status.…)` — the latter is not a valid
      // PostgREST filter and 500s the request, so the pill loaded nothing.
      qb = qb.not(c('status'), 'in', '(completed,hundred_percent)');
      qb = base === 'ugs'
        ? qb.or('steam_playtime_minutes.is.null,steam_playtime_minutes.eq.0')
        : qb.or('steam_playtime_minutes.is.null,steam_playtime_minutes.eq.0', { referencedTable: 'user_game_status' });
    } else if (filter !== 'all') {
      qb = qb.eq(c('status'), filter);
    }

    // Search on the game title
    if (search) qb = qb.ilike(base === 'ugs' ? 'games.title' : 'title', `%${search}%`);

    return qb;
  };

  // "Select all" bulk-edit path — return every matching game id across all pages,
  // paginating past the 1000-row PostgREST cap.
  if (p.get('idsOnly') === 'true') {
    const CHUNK = 1000;
    const ids: string[] = [];
    for (let start = 0; ; start += CHUNK) {
      const { data: idRows, error: idErr } = await buildQuery(
        'id', 'profile_id', undefined, 'games'
      ).range(start, start + CHUNK - 1);
      if (idErr) {
        console.error('[library API] idsOnly error:', JSON.stringify(idErr));
        return json({ error: 'Failed to load library' }, 500);
      }
      for (const r of idRows ?? []) ids.push((r as any).id);
      if (!idRows || idRows.length < CHUNK) break;
    }
    return json({ ids });
  }

  // A-Z jump bar — map each starting letter to the page + game id of its first
  // entry. Only meaningful for the alpha sort; other sorts get an empty map.
  if (p.get('letterMap') === 'true') {
    const letterMap: Record<string, { page: number; gameId: string }> = {};
    if (sort === 'alpha') {
      const CHUNK = 1000;
      let idx = 0;
      for (let start = 0; ; start += CHUNK) {
        const { data: rows, error: lmErr } = await buildQuery('id, title', 'profile_id', undefined, 'games')
          .order('title', { ascending: true })
          .range(start, start + CHUNK - 1);
        if (lmErr) {
          console.error('[library API] letterMap error:', JSON.stringify(lmErr));
          return json({ error: 'Failed to load library' }, 500);
        }
        for (const r of rows ?? []) {
          const c = String((r as any).title ?? '').trim().charAt(0).toUpperCase();
          const key = c >= 'A' && c <= 'Z' ? c : '#';
          if (letterMap[key] === undefined) {
            letterMap[key] = { page: Math.floor(idx / PAGE_SIZE) + 1, gameId: (r as any).id };
          }
          idx++;
        }
        if (!rows || rows.length < CHUNK) break;
      }
    }
    return json({ letterMap });
  }

  // Note: no genre embed here — the client card/row markup never uses it, and
  // leaving it out keeps the genre *filter*'s inner-join (added in buildQuery)
  // the only game_genres embed, so there's no duplicate-embed ambiguity.
  const SEL_GAMES = 'id, title, slug, cover_img_url';
  const SEL_UGS   = 'status, is_hidden, is_owned, updated_at, steam_playtime_minutes, steam_appid, steam_last_played_at';
  const from = (page - 1) * PAGE_SIZE;

  let rows: any[] | null;
  let total: number;

  if (sort === 'completion') {
    // Achievement completion % is an aggregate over user_achievements, not a
    // column — so rank every matching game id here (highest % first), then
    // fetch only this page's rows.
    const { data: complRows, error: complErr } = await db.rpc('achievement_completion_by_appid', {
      p_profile_id: profile.id,
    });
    if (complErr) {
      console.error('[library API] completion rpc error:', JSON.stringify(complErr));
      return json({ error: 'Failed to load library' }, 500);
    }
    const pctByAppid = new Map<number, number>(
      (complRows ?? []).map((r: any) => [r.steam_appid as number, Number(r.pct)]),
    );

    const CHUNK = 1000;
    const ranked: Array<{ id: string; title: string; pct: number }> = [];
    for (let start = 0; ; start += CHUNK) {
      const { data: idRows, error: idErr } = await buildQuery('id, title', 'steam_appid', undefined, 'games')
        .order('id', { ascending: true })
        .range(start, start + CHUNK - 1);
      if (idErr) {
        console.error('[library API] completion scan error:', JSON.stringify(idErr));
        return json({ error: 'Failed to load library' }, 500);
      }
      for (const r of (idRows ?? []) as any[]) {
        const ugs = Array.isArray(r.user_game_status) ? r.user_game_status[0] : r.user_game_status;
        const appid: number | null = ugs?.steam_appid ?? null;
        // Games with no synced achievements sink below 0%-completed ones.
        const pct = appid != null && pctByAppid.has(appid) ? pctByAppid.get(appid)! : -1;
        ranked.push({ id: r.id, title: r.title ?? '', pct });
      }
      if (!idRows || idRows.length < CHUNK) break;
    }
    ranked.sort((a, b) => b.pct - a.pct || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    total = ranked.length;

    const pageIds = ranked.slice(from, from + PAGE_SIZE).map((x) => x.id);
    if (pageIds.length === 0) {
      rows = [];
    } else {
      const { data: pageRows, error: prErr } = await buildQuery(SEL_GAMES, SEL_UGS, undefined, 'games').in('id', pageIds);
      if (prErr) {
        console.error('[library API] completion page error:', JSON.stringify(prErr));
        return json({ error: 'Failed to load library' }, 500);
      }
      const byId = new Map((pageRows ?? []).map((r: any) => [r.id, r]));
      rows = pageIds.map((id) => byId.get(id)).filter(Boolean);
    }
  } else {
    let q = buildQuery(SEL_GAMES, SEL_UGS, { count: 'exact' });

    // Sort — native ORDER BY on whichever table buildQuery pivoted onto.
    if (ugsBase && sort === 'hours') {
      q = q.order('steam_playtime_minutes', { ascending: false, nullsFirst: false });
    } else if (ugsBase && sort === 'recent') {
      q = q.order('updated_at', { ascending: false });
    } else {
      // games base: alpha (default) + review. review is reordered client-side.
      q = q.order('title', { ascending: true });
    }

    const res = await q.range(from, from + PAGE_SIZE - 1);
    if (res.error) {
      console.error('[library API] error:', JSON.stringify(res.error));
      return json({ error: 'Failed to load library' }, 500);
    }
    rows = res.data;
    total = res.count ?? 0;
  }

  const items = (rows ?? []).map((r: any) => {
    // buildQuery pivots the base table by sort, so a row is either a games row
    // with an embedded user_game_status, or a user_game_status row with an
    // embedded games. Normalise both to { g, ugs }.
    const g = r.games
      ? (Array.isArray(r.games) ? r.games[0] : r.games)
      : r;
    const ugs = r.games
      ? r
      : (Array.isArray(r.user_game_status) ? r.user_game_status[0] : r.user_game_status);
    return {
      gameId:    g?.id ?? '',
      title:     g?.title ?? '',
      slug:      g?.slug ?? '',
      cover:     g?.cover_img_url ?? null,
      status:    ugs?.status ?? '',
      owned:     ugs?.is_owned ?? false,
      isHidden:  ugs?.is_hidden ?? false,
      updatedAt: ugs?.updated_at ?? '',
      lastPlayed: ugs?.steam_last_played_at ?? null,
      playtime:  ugs?.steam_playtime_minutes ?? null,
      steamAppid: ugs?.steam_appid ?? null,
    };
  });

  // Per-game achievement progress — drives the Detailed view's progress bar and
  // the gold "100%" treatment in both views. user_achievements is keyed on
  // steam_appid, so only Steam-imported games with a synced achievement set get
  // counts. One page is <=96 games; the query is indexed on
  // (profile_id, steam_appid) but paginate past the 1000-row cap anyway.
  {
    const appids = [...new Set(
      items.map((i: any) => i.steamAppid).filter((x: any): x is number => typeof x === 'number')
    )];
    const counts = new Map<number, { unlocked: number; total: number }>();
    if (appids.length > 0) {
      const CHUNK = 1000;
      for (let start = 0; ; start += CHUNK) {
        const { data: achRows, error: achErr } = await db
          .from('user_achievements')
          .select('steam_appid, unlocked')
          .eq('profile_id', profile.id)
          .in('steam_appid', appids)
          .range(start, start + CHUNK - 1);
        if (achErr) {
          console.error('[library API] achievement counts error:', JSON.stringify(achErr));
          break;
        }
        for (const row of achRows ?? []) {
          const appid = (row as any).steam_appid as number;
          const cur = counts.get(appid) ?? { unlocked: 0, total: 0 };
          cur.total++;
          if ((row as any).unlocked) cur.unlocked++;
          counts.set(appid, cur);
        }
        if (!achRows || achRows.length < CHUNK) break;
      }
    }
    for (const it of items as any[]) {
      const c = it.steamAppid != null ? counts.get(it.steamAppid) : null;
      it.achUnlocked = c ? c.unlocked : null;
      it.achTotal = c ? c.total : null;
    }
  }

  return json({ items, total: total ?? 0, page, pageSize: PAGE_SIZE, hasMore: items.length === PAGE_SIZE });
};
