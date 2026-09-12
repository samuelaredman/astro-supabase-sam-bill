/**
 * Data loaders for the reviewer profile's on-demand tabs.
 *
 * The profile page used to build every tab on every visit — each tab's queries
 * plus its full HTML (a recommendations-heavy profile shipped 318 KB of recs
 * markup nobody had opened). Now the page builds only the tab in the URL, and
 * the rest are fetched as HTML fragments from /reviewers/[username]/tab/[tab]
 * the first time they're opened. Both paths call these loaders and render the
 * same components (src/components/profile/*Tab.astro), so the two can't drift.
 *
 * The logic is lifted unchanged from the page; only independent queries that
 * used to run one after another now run together.
 */
import { getVoteCounts, igdbImage as igdbCover } from './format';
import { REC_SELECT, shapeRec } from './recommendationsFeed';

export const LAZY_PROFILE_TABS = ['reviews', 'recommendations', 'lists', 'library', 'groups'] as const;
export type LazyProfileTab = (typeof LAZY_PROFILE_TABS)[number];

export function isLazyProfileTab(tab: string): tab is LazyProfileTab {
  return (LAZY_PROFILE_TABS as readonly string[]).includes(tab);
}

/** The reviewer's reviews, as the Reviews tab (cards + filters) needs them. */
export const PROFILE_REVIEWS_SELECT = `
  id, score, title, body, published_at, created_at,
  contains_spoilers, play_time_hours, status,
  played_on:platform_played_on ( id, name, slug ),
  games ( id, title, slug, cover_img_url, date_released, game_genres(genres(id, name, slug)) ),
  review_votes ( vote, profile_id ),
  review_reactions( reaction_type, profile_id ),
  review_comments( id )
`;

export function sortPublishedReviews(reviews: any[] | null | undefined): any[] {
  return (reviews ?? [])
    .filter((r: any) => r.status === 'published')
    .sort((a: any, b: any) =>
      new Date(b.published_at ?? b.created_at).getTime() -
      new Date(a.published_at ?? a.created_at).getTime()
    );
}

export interface ProfileTabContext {
  /** Service-role client. */
  db: any;
  /** The viewer's cookie-bound client — list visibility follows the viewer's RLS. */
  supabase: any;
  reviewer: {
    id: string;
    username: string;
    steam_id?: string | null;
    steam_username?: string | null;
    steam_synced_at?: string | null;
    want_to_play_privacy?: string | null;
    dropped_privacy?: string | null;
  };
  /** Published, newest first (sortPublishedReviews). */
  publishedReviews: any[];
  viewerProfileId: string | null;
  isLoggedIn: boolean;
  isOwnProfile: boolean;
  isMutualFollow: boolean;
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export async function loadReviewsTab(ctx: ProfileTabContext) {
  const { db, publishedReviews } = ctx;
  const reviewGameIds = [...new Set(publishedReviews.map((r: any) => r.games?.id).filter(Boolean))] as string[];

  // Developer names per reviewed game — for the dev filter.
  const { data: revCompanyRows } = reviewGameIds.length > 0
    ? await db.from('game_companies')
        .select('game_id, developers(name)')
        .eq('role', 'developer')
        .in('game_id', reviewGameIds)
    : { data: [] };
  const devsByGameId: Record<string, string[]> = {};
  for (const row of (revCompanyRows ?? []) as any[]) {
    if (row.developers?.name) (devsByGameId[row.game_id] ||= []).push(row.developers.name);
  }

  // Both views (Overview grid, Detailed cards) render from this one list and
  // are filtered client-side by the single filter bar.
  const reviewFilterItems = publishedReviews.map((r: any) => {
    const genres = [...new Set(
      (r.games?.game_genres ?? []).map((gg: any) => gg.genres?.name).filter(Boolean)
    )] as string[];
    const devs = [...new Set(devsByGameId[r.games?.id] ?? [])] as string[];
    const votes = getVoteCounts(r.review_votes);
    return {
      review: r,
      searchText: `${r.games?.title ?? ''} ${r.title ?? ''}`.trim(),
      sortTitle: r.games?.title ?? '',
      genres,
      devs,
      platform: r.played_on?.name ?? '',
      score: r.score,
      date: r.published_at ?? r.created_at,
      up: votes.up,
      down: votes.down,
    };
  });
  return {
    reviewFilterItems,
    reviewGenres: [...new Set(reviewFilterItems.flatMap((i) => i.genres))].sort() as string[],
    reviewPlatforms: [...new Set(reviewFilterItems.map((i) => i.platform).filter(Boolean))].sort() as string[],
    reviewDevs: [...new Set(reviewFilterItems.flatMap((i) => i.devs))].sort() as string[],
  };
}
export type ReviewsTabData = Awaited<ReturnType<typeof loadReviewsTab>>;

// ── Recommendations ──────────────────────────────────────────────────────────

export async function loadRecommendationsTab(ctx: ProfileTabContext) {
  const { db, reviewer, viewerProfileId } = ctx;
  const { data: recsRaw } = await db.from('recommendations')
    .select(REC_SELECT)
    .eq('profile_id', reviewer.id)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(100);
  const reviewerRecs = (recsRaw ?? []).map((r: any) => shapeRec(r, viewerProfileId));

  // Genre / platform / dev are the union across a rec's source and target games.
  const recGameIds = [...new Set(
    reviewerRecs.flatMap((r: any) => [r.sourceGame?.id, r.targetGame?.id]).filter(Boolean)
  )] as string[];
  const genresByGame: Record<string, string[]> = {};
  const platformsByGame: Record<string, string[]> = {};
  const devsByGame: Record<string, string[]> = {};
  if (recGameIds.length > 0) {
    const [{ data: g }, { data: p }, { data: c }] = await Promise.all([
      db.from('game_genres').select('game_id, genres(name)').in('game_id', recGameIds),
      db.from('game_platforms').select('game_id, platforms(name)').in('game_id', recGameIds),
      db.from('game_companies').select('game_id, developers(name)').eq('role', 'developer').in('game_id', recGameIds),
    ]);
    for (const row of g ?? []) if (row.genres?.name) (genresByGame[row.game_id] ||= []).push(row.genres.name);
    for (const row of p ?? []) if (row.platforms?.name) (platformsByGame[row.game_id] ||= []).push(row.platforms.name);
    for (const row of c ?? []) if (row.developers?.name) (devsByGame[row.game_id] ||= []).push(row.developers.name);
  }
  const recFilterItems = reviewerRecs.map((rec: any) => {
    const gids = [rec.sourceGame?.id, rec.targetGame?.id].filter(Boolean) as string[];
    return {
      rec,
      searchText: `${rec.sourceGame?.title ?? ''} ${rec.targetGame?.title ?? ''} ${rec.body ?? ''}`.trim(),
      sortTitle: rec.sourceGame?.title ?? rec.targetGame?.title ?? '',
      genres: [...new Set(gids.flatMap((id) => genresByGame[id] ?? []))] as string[],
      platforms: [...new Set(gids.flatMap((id) => platformsByGame[id] ?? []))] as string[],
      devs: [...new Set(gids.flatMap((id) => devsByGame[id] ?? []))] as string[],
      date: rec.createdAt,
      up: rec.upVotes,
      down: rec.downVotes,
    };
  });
  return {
    reviewerRecs,
    recFilterItems,
    recGenres: [...new Set(recFilterItems.flatMap((i: any) => i.genres))].sort() as string[],
    recPlatforms: [...new Set(recFilterItems.flatMap((i: any) => i.platforms))].sort() as string[],
    recDevs: [...new Set(recFilterItems.flatMap((i: any) => i.devs))].sort() as string[],
  };
}
export type RecommendationsTabData = Awaited<ReturnType<typeof loadRecommendationsTab>>;

// ── Lists ────────────────────────────────────────────────────────────────────

/** Cover thumbnails, game ids, release years and entry counts for a set of lists. */
async function listEntryMeta(supabase: any, listIds: string[]) {
  const coversByListId: Record<string, string[]> = {};
  const gameIdsByListId: Record<string, string[]> = {};
  const yearsByListId: Record<string, number[]> = {};
  const entryCountByListId: Record<string, number> = {};
  if (listIds.length === 0) return { coversByListId, gameIdsByListId, yearsByListId, entryCountByListId };

  const [{ data: coverEntries }, { data: allEntries }] = await Promise.all([
    supabase.from('list_entries')
      .select('list_id, games(id, cover_img_url, date_released)')
      .in('list_id', listIds)
      .order('position', { ascending: true, nullsFirst: false })
      .order('added_at', { ascending: true }),
    supabase.from('list_entries').select('list_id').in('list_id', listIds),
  ]);
  for (const e of coverEntries ?? []) {
    const cover = igdbCover(e.games?.cover_img_url, 't_cover_big');
    if (cover) {
      coversByListId[e.list_id] ||= [];
      if (coversByListId[e.list_id].length < 4) coversByListId[e.list_id].push(cover);
    }
    if (e.games?.id) (gameIdsByListId[e.list_id] ||= []).push(e.games.id);
    if (e.games?.date_released) (yearsByListId[e.list_id] ||= []).push(new Date(e.games.date_released).getFullYear());
  }
  for (const e of allEntries ?? []) entryCountByListId[e.list_id] = (entryCountByListId[e.list_id] ?? 0) + 1;
  return { coversByListId, gameIdsByListId, yearsByListId, entryCountByListId };
}

export async function loadListsTab(ctx: ProfileTabContext) {
  const { supabase, reviewer, isOwnProfile, publishedReviews } = ctx;
  const [{ data: profileListsRaw }, { data: savedRaw }] = await Promise.all([
    supabase.from('lists')
      .select('id, title, is_ranked, visibility, cover_image_url, updated_at')
      .eq('profile_id', reviewer.id)
      .order('updated_at', { ascending: false }),
    supabase.from('list_saves')
      .select('list_id, is_hidden, lists(id, title, is_ranked, visibility, cover_image_url, updated_at, profiles(id, username, avatar_url))')
      .eq('profile_id', reviewer.id)
      .order('created_at', { ascending: false }),
  ]);

  // Owners see all saves; others only see non-hidden ones.
  const rawSavedLists = (savedRaw ?? [])
    .filter((s: any) => s.lists && (isOwnProfile || !s.is_hidden))
    .map((s: any) => ({ ...s.lists, isHidden: s.is_hidden ?? false }));

  const [mine, saved] = await Promise.all([
    listEntryMeta(supabase, (profileListsRaw ?? []).map((l: any) => l.id)),
    listEntryMeta(supabase, rawSavedLists.map((l: any) => l.id)),
  ]);

  let profileLists = (profileListsRaw ?? []).map((l: any) => ({
    ...l,
    coverUrls: mine.coversByListId[l.id] ?? [],
    entryCount: mine.entryCountByListId[l.id] ?? 0,
  }));
  let savedLists = rawSavedLists.map((l: any) => ({
    ...l,
    ownerId: l.profiles?.id ?? null,
    ownerUsername: l.profiles?.username,
    ownerAvatar: l.profiles?.avatar_url,
    coverUrls: saved.coversByListId[l.id] ?? [],
    entryCount: saved.entryCountByListId[l.id] ?? 0,
  }));

  // Genre / platform / dev metadata for the filters.
  const allGameIds = [...new Set([
    ...Object.values(mine.gameIdsByListId).flat(),
    ...Object.values(saved.gameIdsByListId).flat(),
  ])];
  if (allGameIds.length > 0) {
    const [{ data: genreRows }, { data: platformRows }, { data: companyRows }] = await Promise.all([
      supabase.from('game_genres').select('game_id, genres(name)').in('game_id', allGameIds),
      supabase.from('game_platforms').select('game_id, platforms(name)').in('game_id', allGameIds),
      supabase.from('game_companies').select('game_id, role, developers(name)').eq('role', 'developer').in('game_id', allGameIds),
    ]);
    const genresByGameId: Record<string, string[]> = {};
    const platformsByGameId: Record<string, string[]> = {};
    const devsByGameId: Record<string, string[]> = {};
    for (const row of genreRows ?? []) if (row.genres?.name) (genresByGameId[row.game_id] ||= []).push(row.genres.name);
    for (const row of platformRows ?? []) if (row.platforms?.name) (platformsByGameId[row.game_id] ||= []).push(row.platforms.name);
    for (const row of companyRows ?? []) if (row.developers?.name) (devsByGameId[row.game_id] ||= []).push(row.developers.name);
    const buildListMeta = (listId: string, gids: Record<string, string[]>, yrs: Record<string, number[]>) => {
      const ids = gids[listId] ?? [];
      const years = yrs[listId] ?? [];
      return {
        genres: [...new Set(ids.flatMap((id) => genresByGameId[id] ?? []))].sort(),
        platforms: [...new Set(ids.flatMap((id) => platformsByGameId[id] ?? []))].sort(),
        devs: [...new Set(ids.flatMap((id) => devsByGameId[id] ?? []))].sort(),
        minYear: years.length ? Math.min(...years) : null,
        maxYear: years.length ? Math.max(...years) : null,
      };
    };
    profileLists = profileLists.map((l: any) => ({ ...l, ...buildListMeta(l.id, mine.gameIdsByListId, mine.yearsByListId) }));
    savedLists = savedLists.map((l: any) => ({ ...l, ...buildListMeta(l.id, saved.gameIdsByListId, saved.yearsByListId) }));
  }

  // Per-list review metrics (avg score + total hours from the reviewer's own reviews).
  const reviewByGameId: Record<string, { score: number; hours: number }> = {};
  for (const r of publishedReviews) {
    if (r.games?.id) reviewByGameId[r.games.id] = { score: r.score, hours: r.play_time_hours ?? 0 };
  }
  const buildListReviewMeta = (gameIds: string[]) => {
    const reviews = gameIds.map((id) => reviewByGameId[id]).filter(Boolean);
    return {
      avgScore: reviews.length > 0 ? reviews.reduce((s, r) => s + r.score, 0) / reviews.length : null,
      totalHours: reviews.reduce((s, r) => s + r.hours, 0),
    };
  };
  profileLists = profileLists.map((l: any) => ({ ...l, ...buildListReviewMeta(mine.gameIdsByListId[l.id] ?? []) }));
  savedLists = savedLists.map((l: any) => ({ ...l, ...buildListReviewMeta(saved.gameIdsByListId[l.id] ?? []) }));

  const uniq = (lists: any[], key: string) => [...new Set(lists.flatMap((l: any) => l[key] ?? []))].sort() as string[];
  return {
    profileLists,
    savedLists,
    myGenres: uniq(profileLists, 'genres'),
    myPlatforms: uniq(profileLists, 'platforms'),
    myDevs: uniq(profileLists, 'devs'),
    savedGenres: uniq(savedLists, 'genres'),
    savedPlatforms: uniq(savedLists, 'platforms'),
    savedDevs: uniq(savedLists, 'devs'),
  };
}
export type ListsTabData = Awaited<ReturnType<typeof loadListsTab>>;

// ── Library ──────────────────────────────────────────────────────────────────

export async function loadLibraryTab(ctx: ProfileTabContext) {
  const { db, reviewer, isOwnProfile, isMutualFollow } = ctx;

  // Library settings (defaults for old rows).
  const { data: settingsRow } = await db.from('profiles')
    .select('library_visibility, library_show_hours, library_hidden_tabs')
    .eq('id', reviewer.id)
    .maybeSingle();
  const librarySettings = {
    visibility: (settingsRow?.library_visibility ?? 'public') as string,
    showHours: (settingsRow?.library_show_hours ?? true) as boolean,
    hiddenTabs: (settingsRow?.library_hidden_tabs ?? []) as string[],
    isPrivate: false,
  };
  const libraryIsPrivate = librarySettings.visibility === 'private' && !isOwnProfile;
  librarySettings.isPrivate = libraryIsPrivate;

  const canSeeWantToPlay = isOwnProfile
    || !(reviewer.want_to_play_privacy === 'private'
         || (reviewer.want_to_play_privacy === 'friends' && !isMutualFollow));
  const canSeeDropped = isOwnProfile
    || !(reviewer.dropped_privacy === 'private'
         || (reviewer.dropped_privacy === 'friends' && !isMutualFollow));

  // Distinct genre / platform / developer names across the visible library —
  // the filter dropdowns. Queried FROM each game↔X junction with a two-level
  // inner join down to user_game_status; one row per (game, value) pair, so
  // paginate past the 1000-row cap.
  async function libDimNames(junction: string, dimEmbed: string, roleFilter?: string): Promise<string[]> {
    const CHUNK = 1000;
    const key = dimEmbed.split('(')[0];
    const names = new Set<string>();
    for (let start = 0; ; start += CHUNK) {
      let q = db.from(junction)
        .select(`${dimEmbed}, games!inner(user_game_status!inner(profile_id, is_hidden))`)
        .eq('games.user_game_status.profile_id', reviewer.id)
        .eq('games.user_game_status.is_hidden', false);
      if (roleFilter) q = q.eq('role', roleFilter);
      const { data, error } = await q.range(start, start + CHUNK - 1);
      if (error) {
        console.error(`[profile library] ${junction} filter-option query failed:`, JSON.stringify(error));
        break;
      }
      for (const row of (data ?? []) as any[]) {
        const n = row[key]?.name;
        if (n) names.add(n);
      }
      if (!data || data.length < CHUNK) break;
    }
    return [...names].sort();
  }

  const libCounts = { all: 0, playing: 0, want_to_play: 0, owned: 0, completed: 0, hundred_percent: 0, dropped: 0, unplayed: 0, hidden: 0 };
  let libGenres: string[] = [];
  let libPlatforms: string[] = [];
  let libDevs: string[] = [];
  if (!libraryIsPrivate) {
    const [{ data: countRows }, dims] = await Promise.all([
      db.rpc('library_status_counts', { p_profile_id: reviewer.id }),
      Promise.all([
        libDimNames('game_genres', 'genres(name)'),
        libDimNames('game_platforms', 'platforms(name)'),
        libDimNames('game_companies', 'developers(name)', 'developer'),
      ]),
    ]);
    const c = (countRows as any)?.[0] ?? {};
    libCounts.all             = Number(c.all_count ?? 0);
    libCounts.playing         = Number(c.playing ?? 0);
    // Privacy: these tabs are hidden from viewers who aren't allowed to see them.
    libCounts.want_to_play    = canSeeWantToPlay ? Number(c.want_to_play ?? 0) : 0;
    libCounts.owned           = Number(c.owned ?? 0);
    libCounts.completed       = Number(c.completed ?? 0);
    libCounts.hundred_percent = Number(c.hundred_percent ?? 0);
    libCounts.dropped         = canSeeDropped ? Number(c.dropped ?? 0) : 0;
    libCounts.hidden          = isOwnProfile ? Number(c.hidden ?? 0) : 0;
    libCounts.unplayed        = Number(c.unplayed ?? 0);
    [libGenres, libPlatforms, libDevs] = dims;
  }
  return { librarySettings, libraryIsPrivate, libCounts, libGenres, libPlatforms, libDevs };
}
export type LibraryTabData = Awaited<ReturnType<typeof loadLibraryTab>>;

// ── Groups ───────────────────────────────────────────────────────────────────

export interface ProfileGroup {
  id: string;
  name: string;
  avatar_url: string | null;
  visibility: string;
  slug: string | null;
  role: string;
  memberCount: number;
}

/**
 * Groups this reviewer belongs to: public ones for everyone, private ones only
 * on their own profile. Member counts are counted by Postgres (an embedded
 * count), not by fetching every member row — creator groups run to hundreds.
 */
export async function loadGroupsTab(ctx: ProfileTabContext) {
  const { data, error } = await ctx.db
    .from('group_members')
    .select('role, groups!inner ( id, name, avatar_url, visibility, slug, group_members ( count ) )')
    .eq('profile_id', ctx.reviewer.id)
    .order('joined_at', { ascending: true });
  if (error) console.error('[profileTabs] groups error:', JSON.stringify(error));

  const groups: ProfileGroup[] = (data ?? [])
    .map((m: any): ProfileGroup => ({
      id: m.groups.id,
      name: m.groups.name,
      avatar_url: m.groups.avatar_url,
      visibility: m.groups.visibility,
      slug: m.groups.slug,
      role: m.role,
      memberCount: Number(m.groups.group_members?.[0]?.count ?? 1),
    }))
    .filter((g: ProfileGroup) => ctx.isOwnProfile || g.visibility === 'public');
  return { groups };
}
export type GroupsTabData = Awaited<ReturnType<typeof loadGroupsTab>>;

export function loadProfileTab(tab: LazyProfileTab, ctx: ProfileTabContext) {
  switch (tab) {
    case 'reviews': return loadReviewsTab(ctx);
    case 'recommendations': return loadRecommendationsTab(ctx);
    case 'lists': return loadListsTab(ctx);
    case 'library': return loadLibraryTab(ctx);
    case 'groups': return loadGroupsTab(ctx);
  }
}
