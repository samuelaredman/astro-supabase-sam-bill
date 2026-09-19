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
  // 'recent' pivots on user_game_status for its native ORDER BY updated_at.
  // 'hours' and 'completion' both aggregate across Steam + PSN sources and
  // pre-rank in JS instead — the base doesn't matter for their scan calls
  // because they pass an explicit 'games' override to buildQuery.
  const ugsBase = sort === 'recent';

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
      // "no playtime and not finished". Steam + PSN playtime must be
      // absent/zero AND Xbox current_gamerscore must be absent/zero. Xbox
      // doesn't expose playtime — we use gamerscore > 0 as the "played"
      // proxy instead.
      //
      // The playtime OR must be phrased as a filter *on* the embedded resource
      // (`user_game_status.or=(…)`), not a top-level `or=(user_game_status.…)`
      // — the latter is not a valid PostgREST filter and 500s the request.
      // Three chained .or() calls AND together.
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
  const SEL_UGS   = 'status, is_hidden, is_owned, updated_at, steam_playtime_minutes, steam_appid, steam_last_played_at, psn_np_communication_id, psn_platform, psn_playtime_minutes, psn_last_played_at, psn_trophies_earned, psn_trophies_total, xbox_title_id, xbox_current_gamerscore, xbox_max_gamerscore, xbox_progress, xbox_last_played_at';
  const from = (page - 1) * PAGE_SIZE;

  let rows: any[] | null;
  let total: number;

  if (sort === 'completion' || sort === 'hours') {
    // Both sorts aggregate a value across two sources (Steam achievements +
    // PSN trophies, or Steam playtime + PSN playtime). Since PostgREST can't
    // ORDER BY expressions, we compute the metric per game in JS, sort, and
    // then fetch only the requested page. Bounded by the profile's tracked-
    // game count (hundreds to low thousands).

    // Fetch each source's per-game metric map up-front.
    const pctByAppid = new Map<number, number>();
    const pctByNpComm = new Map<string, number>();
    const pctByXboxTitle = new Map<string, number>();
    if (sort === 'completion') {
      const [
        { data: achRows, error: achErr },
        { data: trRows, error: trErr },
        { data: xbRows, error: xbErr },
      ] = await Promise.all([
        db.rpc('achievement_completion_by_appid', { p_profile_id: profile.id }),
        db.rpc('trophy_completion_by_npcommid', { p_profile_id: profile.id }),
        db.rpc('xbox_achievement_completion_by_titleid', { p_profile_id: profile.id }),
      ]);
      if (achErr) {
        console.error('[library API] achievement completion rpc error:', JSON.stringify(achErr));
        return json({ error: 'Failed to load library' }, 500);
      }
      // PSN + Xbox failures are non-fatal — games from those sources without a
      // synced achievement/trophy set just fall to the bottom.
      if (trErr) console.error('[library API] trophy completion rpc error (non-fatal):', JSON.stringify(trErr));
      if (xbErr) console.error('[library API] xbox completion rpc error (non-fatal):', JSON.stringify(xbErr));
      for (const r of (achRows ?? []) as any[]) pctByAppid.set(r.steam_appid, Number(r.pct));
      for (const r of (trRows  ?? []) as any[]) pctByNpComm.set(r.np_communication_id, Number(r.pct));
      for (const r of (xbRows  ?? []) as any[]) pctByXboxTitle.set(r.xbox_title_id, Number(r.pct));
    }

    // Metric extractor. For completion: max(steam pct, psn pct) — the game's
    // best completion across sources. Detailed view splits mixed games into
    // two rows so each source's actual pct is still visible; using max for
    // the aggregate places the game at its highest completion, which is what
    // "sort by completion %" means to a user. -1 sinks games with no data
    // below 0%-completed ones. For hours: sum so a game played 20h Steam +
    // 30h PS5 sorts at 50h.
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
      // hours — Xbox doesn't expose playtime, so its contribution is 0.
      // Steam + PSN sum drives the rank.
      const steamMin = Number(ugs?.steam_playtime_minutes) || 0;
      const psnMin   = Number(ugs?.psn_playtime_minutes) || 0;
      const total = steamMin + psnMin;
      return total > 0 ? total : -1;
    };

    // Ranking scan pulls only the columns metricFor needs — cheaper page than
    // pulling SEL_UGS every game only to discard most of it.
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
        console.error('[library API] rank scan error:', JSON.stringify(idErr));
        return json({ error: 'Failed to load library' }, 500);
      }
      for (const r of (idRows ?? []) as any[]) {
        const ugs = Array.isArray(r.user_game_status) ? r.user_game_status[0] : r.user_game_status;
        ranked.push({ id: r.id, title: r.title ?? '', metric: metricFor(ugs) });
      }
      if (!idRows || idRows.length < CHUNK) break;
    }
    ranked.sort((a, b) => b.metric - a.metric || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    total = ranked.length;

    const pageIds = ranked.slice(from, from + PAGE_SIZE).map((x) => x.id);
    if (pageIds.length === 0) {
      rows = [];
    } else {
      const { data: pageRows, error: prErr } = await buildQuery(SEL_GAMES, SEL_UGS, undefined, 'games').in('id', pageIds);
      if (prErr) {
        console.error('[library API] rank page error:', JSON.stringify(prErr));
        return json({ error: 'Failed to load library' }, 500);
      }
      const byId = new Map((pageRows ?? []).map((r: any) => [r.id, r]));
      rows = pageIds.map((id) => byId.get(id)).filter(Boolean);
    }
  } else {
    let q = buildQuery(SEL_GAMES, SEL_UGS, { count: 'exact' });

    // Sort — native ORDER BY on whichever table buildQuery pivoted onto.
    if (ugsBase && sort === 'recent') {
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

  // Intermediate per-game shape carrying BOTH source's raw fields. The split
  // pass below emits one display row per source when a game exists on both
  // Steam and PSN, so the reader can see each platform's own playtime and
  // achievement/trophy counts.
  const gameItems = (rows ?? []).map((r: any) => {
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
      // Per-source raw fields — collapsed into display fields by the split pass.
      steamAppid:      ugs?.steam_appid ?? null,
      steamPlaytime:   ugs?.steam_playtime_minutes ?? null,
      steamLastPlayed: ugs?.steam_last_played_at ?? null,
      psnNpCommId:     ugs?.psn_np_communication_id ?? null,
      psnPlatform:     ugs?.psn_platform ?? null,
      psnPlaytime:     ugs?.psn_playtime_minutes ?? null,
      psnLastPlayed:   ugs?.psn_last_played_at ?? null,
      // Trophy counts stored on user_game_status by sync-library — used as a
      // fallback when user_trophies hasn't been populated yet.
      psnTrophiesEarned: ugs?.psn_trophies_earned ?? null,
      psnTrophiesTotal:  ugs?.psn_trophies_total ?? null,
      // Xbox raw fields. No playtime — Xbox doesn't expose hours; we surface
      // gamerscore instead. xbox_progress is the precomputed
      // 100 * current / max, useful as a progress-bar fallback when
      // user_xbox_achievements hasn't been synced yet.
      xboxTitleId:       ugs?.xbox_title_id ?? null,
      xboxLastPlayed:    ugs?.xbox_last_played_at ?? null,
      xboxCurrentScore:  ugs?.xbox_current_gamerscore ?? null,
      xboxMaxScore:      ugs?.xbox_max_gamerscore ?? null,
      xboxProgress:      ugs?.xbox_progress ?? null,
      // Populated by the count passes below.
      steamAchUnlocked: null as number | null,
      steamAchTotal:    null as number | null,
      psnAchUnlocked:   null as number | null,
      psnAchTotal:      null as number | null,
      xboxAchUnlocked:  null as number | null,
      xboxAchTotal:     null as number | null,
    };
  });

  // Per-game achievement progress — drives the Detailed view's progress bar
  // and the gold "100%" cover treatment. user_achievements is keyed on
  // steam_appid; runs against every Steam-imported game on the page, even the
  // ones that also have a PSN counterpart (since we split those into two rows
  // below and each row needs its own count).
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
    for (const it of gameItems as any[]) {
      const c = it.steamAppid != null ? counts.get(it.steamAppid) : null;
      it.steamAchUnlocked = c ? c.unlocked : null;
      it.steamAchTotal = c ? c.total : null;
    }
  }

  // Per-game trophy progress — same idea as the Steam pass above, but keyed on
  // np_communication_id and reading from user_trophies. Runs against every
  // PSN-tracked game on the page.
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
          .eq('profile_id', profile.id)
          .in('np_communication_id', npCommIds)
          .range(start, start + CHUNK - 1);
        if (tErr) {
          console.error('[library API] trophy counts error:', JSON.stringify(tErr));
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
      // If user_trophies has fresh data (post trophy-sync), use it. Otherwise
      // fall back to the aggregate counts stored on user_game_status by
      // sync-library, so a user who's synced their library but not trophies
      // still sees a progress bar.
      if (c) {
        it.psnAchUnlocked = c.earned;
        it.psnAchTotal = c.total;
      } else if (typeof it.psnTrophiesTotal === 'number' && it.psnTrophiesTotal > 0) {
        it.psnAchUnlocked = it.psnTrophiesEarned ?? 0;
        it.psnAchTotal = it.psnTrophiesTotal;
      }
    }
  }

  // Per-game Xbox achievement progress — same pattern as Steam + PSN, keyed
  // on xbox_title_id. Populates xboxAchUnlocked/xboxAchTotal for every
  // Xbox-tracked game on the page.
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
          .eq('profile_id', profile.id)
          .in('xbox_title_id', titleIds)
          .range(start, start + CHUNK - 1);
        if (xErr) {
          console.error('[library API] xbox achievement counts error:', JSON.stringify(xErr));
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
      // Same fallback pattern as PSN — if user_xbox_achievements hasn't
      // been synced yet, fall back to the gamerscore ratio stored on
      // user_game_status by sync-library, so a user who's synced their
      // library but not achievements still sees a progress bar.
      if (c) {
        it.xboxAchUnlocked = c.unlocked;
        it.xboxAchTotal = c.total;
      } else if (typeof it.xboxMaxScore === 'number' && it.xboxMaxScore > 0) {
        // Use gamerscore ratio as achievement proxy — approximation, but
        // matches what the user sees on their Xbox dashboard for the title.
        it.xboxAchUnlocked = it.xboxCurrentScore ?? 0;
        it.xboxAchTotal = it.xboxMaxScore;
      }
    }
  }

  // Split pass — a game owned on multiple platforms (Steam + PSN + Xbox)
  // emits one display row PER platform, each with its own chip, playtime
  // (where available), last-played date, and progress bar. Overview grid
  // dedupes by gameId client-side; detailed grid renders every row.
  //
  // All split rows carry the same gameId — bulk edit and status changes are
  // still per-game — but a distinct rowKey so client renderers can key their
  // per-row state on it.
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
    // Xbox doesn't expose playtime; leaving playtime null keeps the row
    // consistent with the "no hours" state manual/PS3-only games already
    // render.
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
      // Manually-tracked game with no external source.
      items.push({
        ...shared(it),
        ...emptyPlatformFields,
        rowKey: it.gameId,
        sourcePlatform: null,
        playtime: null, lastPlayed: null, achUnlocked: null, achTotal: null,
      });
    }
  }

  // total remains the game-level count so pagination stays stable — a page
  // may render up to 2*PAGE_SIZE detail rows for a heavily-mixed library, but
  // it always represents PAGE_SIZE games.
  return json({ items, total: total ?? 0, page, pageSize: PAGE_SIZE, hasMore: gameItems.length === PAGE_SIZE });
};
