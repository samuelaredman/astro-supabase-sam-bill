// Shared library-page query used by both the API endpoint
// (/api/user-game-status/library) and the reviewer profile's Library tab SSR
// (loadLibraryTab in profileTabs.ts). Extracted so the tab can inline page 1
// into its HTML fragment and skip the second round-trip the client used to
// make on tab open.
//
// Auth + visibility checks live in the caller — this function trusts the
// booleans it receives. That keeps it callable from both the API (which
// resolves the caller from cookies) and the tab loader (which already has
// them in ProfileTabContext).

export const LIBRARY_PAGE_SIZE = 96;

export type LibraryQueryOptions = {
  profileId: string;
  isOwn: boolean;
  canSeeWantToPlay: boolean;
  canSeeDropped: boolean;
  page?: number;
  filter?: string;
  sort?: string;
  search?: string;
  genre?: string;
  platform?: string;
  dev?: string;
  showHidden?: boolean;
};

export type LibraryPageResult = {
  items: any[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export async function queryLibraryPage(
  db: any,
  opts: LibraryQueryOptions,
): Promise<LibraryPageResult> {
  const {
    profileId,
    isOwn,
    canSeeWantToPlay,
    canSeeDropped,
  } = opts;
  const page = Math.max(1, opts.page ?? 1);
  const filter = opts.filter ?? 'all';
  const sort = opts.sort ?? 'alpha';
  const search = (opts.search ?? '').trim();
  const genre = (opts.genre ?? '').trim();
  const platform = (opts.platform ?? '').trim();
  const dev = (opts.dev ?? '').trim();
  const showHidden = !!opts.showHidden;

  // A top-level PostgREST query cannot ORDER BY an *embedded* resource's column
  // (it only sorts rows within the embed), so we pivot the query onto whichever
  // table actually owns the sort column.
  const ugsBase = sort === 'recent';

  const buildQuery = (
    gamesSelect: string,
    ugsSelect: string,
    countOpts?: any,
    base: 'games' | 'ugs' = ugsBase ? 'ugs' : 'games',
  ) => {
    const dimJoins: string[] = [];
    if (genre)    dimJoins.push('game_genres!inner(genres!inner(name))');
    if (platform) dimJoins.push('game_platforms!inner(platforms!inner(name))');
    if (dev)      dimJoins.push('game_companies!inner(role,developers!inner(name))');
    const gamesSel = dimJoins.length ? `${gamesSelect}, ${dimJoins.join(', ')}` : gamesSelect;

    let qb =
      base === 'ugs'
        ? db
            .from('user_game_status')
            .select(`${ugsSelect}, games!inner(${gamesSel})`, countOpts)
            .eq('profile_id', profileId)
        : db
            .from('games')
            .select(`${gamesSel}, user_game_status!inner(${ugsSelect})`, countOpts)
            .eq('user_game_status.profile_id', profileId);

    const c = (col: string) => (base === 'ugs' ? col : `user_game_status.${col}`);
    const g = (path: string) => (base === 'ugs' ? `games.${path}` : path);

    if (genre)    qb = qb.eq(g('game_genres.genres.name'), genre);
    if (platform) qb = qb.eq(g('game_platforms.platforms.name'), platform);
    if (dev) {
      qb = qb.eq(g('game_companies.role'), 'developer');
      qb = qb.eq(g('game_companies.developers.name'), dev);
    }

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
  };

  const SEL_GAMES = 'id, title, slug, cover_img_url';
  const SEL_UGS   = 'status, is_hidden, is_owned, updated_at, steam_playtime_minutes, steam_appid, steam_last_played_at, psn_np_communication_id, psn_platform, psn_playtime_minutes, psn_last_played_at, psn_trophies_earned, psn_trophies_total, xbox_title_id, xbox_current_gamerscore, xbox_max_gamerscore, xbox_progress, xbox_last_played_at';
  const from = (page - 1) * LIBRARY_PAGE_SIZE;

  let rows: any[] | null;
  let total: number;

  if (sort === 'completion' || sort === 'hours') {
    const pctByAppid = new Map<number, number>();
    const pctByNpComm = new Map<string, number>();
    const pctByXboxTitle = new Map<string, number>();
    if (sort === 'completion') {
      const [
        { data: achRows, error: achErr },
        { data: trRows, error: trErr },
        { data: xbRows, error: xbErr },
      ] = await Promise.all([
        db.rpc('achievement_completion_by_appid', { p_profile_id: profileId }),
        db.rpc('trophy_completion_by_npcommid', { p_profile_id: profileId }),
        db.rpc('xbox_achievement_completion_by_titleid', { p_profile_id: profileId }),
      ]);
      if (achErr) {
        console.error('[library query] achievement completion rpc error:', JSON.stringify(achErr));
        throw new Error('Failed to load library');
      }
      if (trErr) console.error('[library query] trophy completion rpc error (non-fatal):', JSON.stringify(trErr));
      if (xbErr) console.error('[library query] xbox completion rpc error (non-fatal):', JSON.stringify(xbErr));
      for (const r of (achRows ?? []) as any[]) pctByAppid.set(r.steam_appid, Number(r.pct));
      for (const r of (trRows  ?? []) as any[]) pctByNpComm.set(r.np_communication_id, Number(r.pct));
      for (const r of (xbRows  ?? []) as any[]) pctByXboxTitle.set(r.xbox_title_id, Number(r.pct));
    }

    const metricFor = (ugs: any): number => {
      if (sort === 'completion') {
        const appid: number | null = ugs?.steam_appid ?? null;
        const npComm: string | null = ugs?.psn_np_communication_id ?? null;
        const xTitle: string | null = ugs?.xbox_title_id ?? null;
        const steamPct = appid != null ? pctByAppid.get(appid) : undefined;
        const psnPct   = npComm ? pctByNpComm.get(npComm) : undefined;
        const xboxPct  = xTitle ? pctByXboxTitle.get(xTitle) : undefined;
        if (steamPct === undefined && psnPct === undefined && xboxPct === undefined) return -1;
        return Math.max(steamPct ?? -1, psnPct ?? -1, xboxPct ?? -1);
      }
      const steamMin = Number(ugs?.steam_playtime_minutes) || 0;
      const psnMin   = Number(ugs?.psn_playtime_minutes) || 0;
      const total = steamMin + psnMin;
      return total > 0 ? total : -1;
    };

    const SCAN_UGS = sort === 'completion'
      ? 'steam_appid, psn_np_communication_id, xbox_title_id'
      : 'steam_playtime_minutes, psn_playtime_minutes';

    const CHUNK = 1000;
    const ranked: Array<{ id: string; title: string; metric: number }> = [];
    for (let start = 0; ; start += CHUNK) {
      const { data: idRows, error: idErr } = await buildQuery('id, title', SCAN_UGS, undefined, 'games')
        .order('id', { ascending: true })
        .range(start, start + CHUNK - 1);
      if (idErr) {
        console.error('[library query] rank scan error:', JSON.stringify(idErr));
        throw new Error('Failed to load library');
      }
      for (const r of (idRows ?? []) as any[]) {
        const ugs = Array.isArray(r.user_game_status) ? r.user_game_status[0] : r.user_game_status;
        ranked.push({ id: r.id, title: r.title ?? '', metric: metricFor(ugs) });
      }
      if (!idRows || idRows.length < CHUNK) break;
    }
    ranked.sort((a, b) => b.metric - a.metric || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    total = ranked.length;

    const pageIds = ranked.slice(from, from + LIBRARY_PAGE_SIZE).map((x) => x.id);
    if (pageIds.length === 0) {
      rows = [];
    } else {
      const { data: pageRows, error: prErr } = await buildQuery(SEL_GAMES, SEL_UGS, undefined, 'games').in('id', pageIds);
      if (prErr) {
        console.error('[library query] rank page error:', JSON.stringify(prErr));
        throw new Error('Failed to load library');
      }
      const byId = new Map((pageRows ?? []).map((r: any) => [r.id, r]));
      rows = pageIds.map((id) => byId.get(id)).filter(Boolean);
    }
  } else {
    let q = buildQuery(SEL_GAMES, SEL_UGS, { count: 'exact' });

    if (ugsBase && sort === 'recent') {
      q = q.order('updated_at', { ascending: false });
    } else {
      q = q.order('title', { ascending: true });
    }

    const res = await q.range(from, from + LIBRARY_PAGE_SIZE - 1);
    if (res.error) {
      console.error('[library query] error:', JSON.stringify(res.error));
      throw new Error('Failed to load library');
    }
    rows = res.data;
    total = res.count ?? 0;
  }

  const gameItems = (rows ?? []).map((r: any) => {
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
      steamAppid:      ugs?.steam_appid ?? null,
      steamPlaytime:   ugs?.steam_playtime_minutes ?? null,
      steamLastPlayed: ugs?.steam_last_played_at ?? null,
      psnNpCommId:     ugs?.psn_np_communication_id ?? null,
      psnPlatform:     ugs?.psn_platform ?? null,
      psnPlaytime:     ugs?.psn_playtime_minutes ?? null,
      psnLastPlayed:   ugs?.psn_last_played_at ?? null,
      psnTrophiesEarned: ugs?.psn_trophies_earned ?? null,
      psnTrophiesTotal:  ugs?.psn_trophies_total ?? null,
      xboxTitleId:       ugs?.xbox_title_id ?? null,
      xboxLastPlayed:    ugs?.xbox_last_played_at ?? null,
      xboxCurrentScore:  ugs?.xbox_current_gamerscore ?? null,
      xboxMaxScore:      ugs?.xbox_max_gamerscore ?? null,
      xboxProgress:      ugs?.xbox_progress ?? null,
      steamAchUnlocked: null as number | null,
      steamAchTotal:    null as number | null,
      psnAchUnlocked:   null as number | null,
      psnAchTotal:      null as number | null,
      xboxAchUnlocked:  null as number | null,
      xboxAchTotal:     null as number | null,
    };
  });

  // Per-game Steam achievement progress.
  {
    const appids = [...new Set(
      gameItems.map((i: any) => i.steamAppid).filter((x: any): x is number => typeof x === 'number')
    )];
    const counts = new Map<number, { unlocked: number; total: number }>();
    if (appids.length > 0) {
      const CHUNK = 1000;
      for (let start = 0; ; start += CHUNK) {
        const { data: achRows, error: achErr } = await db
          .from('user_achievements')
          .select('steam_appid, unlocked')
          .eq('profile_id', profileId)
          .in('steam_appid', appids)
          .range(start, start + CHUNK - 1);
        if (achErr) {
          console.error('[library query] achievement counts error:', JSON.stringify(achErr));
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
    for (const it of gameItems as any[]) {
      const c = it.steamAppid != null ? counts.get(it.steamAppid) : null;
      it.steamAchUnlocked = c ? c.unlocked : null;
      it.steamAchTotal = c ? c.total : null;
    }
  }

  // Per-game PSN trophy progress.
  {
    const npCommIds = [...new Set(
      (gameItems as any[])
        .map((i) => i.psnNpCommId)
        .filter((x: any): x is string => typeof x === 'string')
    )];
    const counts = new Map<string, { earned: number; total: number }>();
    if (npCommIds.length > 0) {
      const CHUNK = 1000;
      for (let start = 0; ; start += CHUNK) {
        const { data: tRows, error: tErr } = await db
          .from('user_trophies')
          .select('np_communication_id, earned')
          .eq('profile_id', profileId)
          .in('np_communication_id', npCommIds)
          .range(start, start + CHUNK - 1);
        if (tErr) {
          console.error('[library query] trophy counts error:', JSON.stringify(tErr));
          break;
        }
        for (const row of tRows ?? []) {
          const id = (row as any).np_communication_id as string;
          const cur = counts.get(id) ?? { earned: 0, total: 0 };
          cur.total++;
          if ((row as any).earned) cur.earned++;
          counts.set(id, cur);
        }
        if (!tRows || tRows.length < CHUNK) break;
      }
    }
    for (const it of gameItems as any[]) {
      if (!it.psnNpCommId) continue;
      const c = counts.get(it.psnNpCommId);
      if (c) {
        it.psnAchUnlocked = c.earned;
        it.psnAchTotal = c.total;
      } else if (typeof it.psnTrophiesTotal === 'number' && it.psnTrophiesTotal > 0) {
        it.psnAchUnlocked = it.psnTrophiesEarned ?? 0;
        it.psnAchTotal = it.psnTrophiesTotal;
      }
    }
  }

  // Per-game Xbox achievement progress.
  {
    const titleIds = [...new Set(
      (gameItems as any[])
        .map((i) => i.xboxTitleId)
        .filter((x: any): x is string => typeof x === 'string')
    )];
    const counts = new Map<string, { unlocked: number; total: number }>();
    if (titleIds.length > 0) {
      const CHUNK = 1000;
      for (let start = 0; ; start += CHUNK) {
        const { data: xRows, error: xErr } = await db
          .from('user_xbox_achievements')
          .select('xbox_title_id, unlocked')
          .eq('profile_id', profileId)
          .in('xbox_title_id', titleIds)
          .range(start, start + CHUNK - 1);
        if (xErr) {
          console.error('[library query] xbox achievement counts error:', JSON.stringify(xErr));
          break;
        }
        for (const row of xRows ?? []) {
          const id = (row as any).xbox_title_id as string;
          const cur = counts.get(id) ?? { unlocked: 0, total: 0 };
          cur.total++;
          if ((row as any).unlocked) cur.unlocked++;
          counts.set(id, cur);
        }
        if (!xRows || xRows.length < CHUNK) break;
      }
    }
    for (const it of gameItems as any[]) {
      if (!it.xboxTitleId) continue;
      const c = counts.get(it.xboxTitleId);
      if (c) {
        it.xboxAchUnlocked = c.unlocked;
        it.xboxAchTotal = c.total;
      } else if (typeof it.xboxMaxScore === 'number' && it.xboxMaxScore > 0) {
        it.xboxAchUnlocked = it.xboxCurrentScore ?? 0;
        it.xboxAchTotal = it.xboxMaxScore;
      }
    }
  }

  const shared = (it: any) => ({
    gameId: it.gameId, title: it.title, slug: it.slug, cover: it.cover,
    status: it.status, owned: it.owned, isHidden: it.isHidden,
    updatedAt: it.updatedAt,
  });
  const emptyPlatformFields = {
    steamAppid: null,
    psnNpCommId: null,
    psnPlatform: null,
    xboxTitleId: null,
  };
  const steamRow = (it: any) => ({
    ...shared(it),
    ...emptyPlatformFields,
    rowKey: `${it.gameId}:steam`,
    sourcePlatform: 'steam' as const,
    steamAppid: it.steamAppid,
    playtime:    it.steamPlaytime,
    lastPlayed:  it.steamLastPlayed,
    achUnlocked: it.steamAchUnlocked,
    achTotal:    it.steamAchTotal,
  });
  const psnRow = (it: any) => ({
    ...shared(it),
    ...emptyPlatformFields,
    rowKey: `${it.gameId}:psn`,
    sourcePlatform: 'psn' as const,
    psnNpCommId: it.psnNpCommId,
    psnPlatform: it.psnPlatform,
    playtime:    it.psnPlaytime,
    lastPlayed:  it.psnLastPlayed,
    achUnlocked: it.psnAchUnlocked,
    achTotal:    it.psnAchTotal,
  });
  const xboxRow = (it: any) => ({
    ...shared(it),
    ...emptyPlatformFields,
    rowKey: `${it.gameId}:xbox`,
    sourcePlatform: 'xbox' as const,
    xboxTitleId: it.xboxTitleId,
    playtime:    null,
    lastPlayed:  it.xboxLastPlayed,
    achUnlocked: it.xboxAchUnlocked,
    achTotal:    it.xboxAchTotal,
  });

  const items: any[] = [];
  for (const it of gameItems as any[]) {
    const hasSteam = it.steamAppid != null;
    const hasPsn = it.psnNpCommId != null;
    const hasXbox = it.xboxTitleId != null;
    if (hasSteam) items.push(steamRow(it));
    if (hasPsn) items.push(psnRow(it));
    if (hasXbox) items.push(xboxRow(it));
    if (!hasSteam && !hasPsn && !hasXbox) {
      items.push({
        ...shared(it),
        ...emptyPlatformFields,
        rowKey: it.gameId,
        sourcePlatform: null,
        playtime: null, lastPlayed: null, achUnlocked: null, achTotal: null,
      });
    }
  }

  return {
    items,
    total: total ?? 0,
    page,
    pageSize: LIBRARY_PAGE_SIZE,
    hasMore: gameItems.length === LIBRARY_PAGE_SIZE,
  };
}
