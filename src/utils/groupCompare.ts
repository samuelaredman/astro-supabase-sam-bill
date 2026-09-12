/**
 * The group Stats tab: the group's own averages, and a chosen handful of
 * members lined up against each other and against the group.
 *
 * All the aggregation happens in the group_compare_* / group_score_distribution
 * functions (migration 20260912000000), which read through group_reviews() like
 * the rest of the group stats. Nothing here counts or averages review rows —
 * see "Review stats" in CLAUDE.md.
 *
 * Both the page (src/pages/groups/[id]/index.astro) and the partial route the
 * member picker re-fetches (src/pages/groups/[id]/compare.astro) call
 * loadGroupCompare() and render src/components/groups/CompareTab.astro, so the
 * first paint and every later selection can't drift apart.
 */

/** Games listed under "Game by game". */
export const COMPARE_GAMES_SHOWN = 30;

/** Most members that can be compared at once — four score bars per game stay readable. */
export const COMPARE_MAX_MEMBERS = 4;

/**
 * Members offered in the picker. A creator's group can have thousands, and the
 * long tail has one review each; the viewer, the owner and anyone already picked
 * are kept regardless of where they rank (see comparePickerList).
 */
export const COMPARE_PICKER_SHOWN = 60;

/** One colour per compared member, in pick order. Readable on both themes. */
export const COMPARE_COLORS = ["#6ea8fe", "#f0883e", "#56d364", "#db61a2"] as const;

export const COMPARE_SORTS = ["disagreement", "vs_group", "popular", "highest", "lowest"] as const;
export type CompareSort = (typeof COMPARE_SORTS)[number];

export const COMPARE_SORT_LABELS: Record<CompareSort, string> = {
  disagreement: "Biggest disagreement",
  vs_group: "Furthest from group average",
  popular: "Most reviewed in group",
  highest: "Highest rated by picks",
  lowest: "Lowest rated by picks",
};

/** "any" lists games any pick reviewed; "all" only games every pick reviewed. */
export type CompareMode = "any" | "all";

export interface CompareMemberInput {
  id: string;
  username: string;
  avatar_url?: string | null;
  role?: string | null;
}

export interface CompareMemberRow extends CompareMemberInput {
  /** Position in the picked set — the member's colour and score-line marker. */
  color: string;
  isViewer: boolean;
  isOwner: boolean;
  reviewCount: number;
  avgScore: number | null;
  hoursSum: number;
  /** Games another member also reviewed — the only ones with a group average to differ from. */
  vsGroupGames: number;
  /** Mean |their score − the group's average on that game|. Null with nothing to compare. */
  vsGroupAbsDiff: number | null;
  vsGroupAbove: number;
  vsGroupBelow: number;
  vsGroupLevel: number;
  /** Reviews at each score, index 0 = score 1. */
  distribution: number[];
}

export interface CompareGameRow {
  game: { id: string; title: string; slug: string | null; cover_img_url: string | null };
  groupCount: number;
  groupAvg: number;
  selCount: number;
  selAvg: number;
  selSpread: number;
  selVsGroup: number;
  /** One entry per pick who reviewed it, in the picked order. */
  scores: { profileId: string; score: number }[];
}

export interface ComparePairRow {
  a: CompareMemberRow;
  b: CompareMemberRow;
  sharedGames: number;
  meanAbsDiff: number;
  exactMatches: number;
  withinOne: number;
  aHigher: number;
  bHigher: number;
  /** Share of shared games scored within a point of each other, 0–100. */
  agreementPct: number;
}

export interface GroupCompareData {
  members: CompareMemberRow[];
  /** The members the picker offers — see comparePickerList. */
  pickable: { id: string; username: string; avatar_url?: string | null; reviewCount: number; isOwner: boolean; isViewer: boolean }[];
  groupAvg: number | null;
  groupReviewCount: number;
  groupGameCount: number;
  groupHoursSum: number;
  /** Group reviews at each score, index 0 = score 1. */
  groupDistribution: number[];
  games: CompareGameRow[];
  pairs: ComparePairRow[];
  sort: CompareSort;
  mode: CompareMode;
  /** More games matched than COMPARE_GAMES_SHOWN. */
  truncated: boolean;
}

export function isCompareSort(value: unknown): value is CompareSort {
  return typeof value === "string" && (COMPARE_SORTS as readonly string[]).includes(value);
}

/**
 * With two or more picks the interesting order is where they disagree with each
 * other; with one there is no disagreement to sort by, so sort by distance from
 * the group instead.
 */
export function defaultCompareSort(selectedCount: number): CompareSort {
  return selectedCount >= 2 ? "disagreement" : "vs_group";
}

export function parseCompareSort(input: unknown, selectedCount: number): CompareSort {
  return isCompareSort(input) ? input : defaultCompareSort(selectedCount);
}

export function parseCompareMode(input: unknown): CompareMode {
  return input === "all" ? "all" : "any";
}

/**
 * The picked members, from a `?with=` list. Ignores anything that isn't a
 * current member with reviews, drops duplicates, keeps the given order and caps
 * the set — the ids arrive in a URL a visitor can edit.
 */
export function parseCompareSelection(
  input: string | null | undefined,
  allowedIds: Iterable<string>,
  max = COMPARE_MAX_MEMBERS
): string[] {
  const allowed = new Set(allowedIds);
  const out: string[] = [];
  for (const raw of (input ?? "").split(",")) {
    const id = raw.trim();
    if (!id || !allowed.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Who to compare before anyone has picked: the viewer against the group's
 * owner, which is the creator on a creator's group. Falls back to the two most
 * active reviewers so the tab is never empty for a visitor who isn't a member.
 */
export function defaultCompareSelection(opts: {
  /** Most active reviewers first. */
  rankedMemberIds: string[];
  viewerProfileId?: string | null;
  ownerProfileId?: string | null;
  max?: number;
}): string[] {
  const { rankedMemberIds, viewerProfileId, ownerProfileId, max = COMPARE_MAX_MEMBERS } = opts;
  const ranked = new Set(rankedMemberIds);
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && ranked.has(id) && !out.includes(id) && out.length < max) out.push(id);
  };
  add(viewerProfileId);
  add(ownerProfileId);
  for (const id of rankedMemberIds) {
    if (out.length >= 2) break;
    add(id);
  }
  return out;
}

/**
 * The members the picker offers, from the ranked list (most active reviewers
 * first). The viewer, the owner and anyone already picked come first and are
 * always present however little they have reviewed — you can always find
 * yourself and the creator — then the ranking fills the rest of the list.
 */
export function comparePickerList<T extends { id: string; isOwner: boolean; isViewer: boolean }>(
  ranked: T[],
  selectedIds: string[] = [],
  max = COMPARE_PICKER_SHOWN
): T[] {
  const pinned = new Set(selectedIds);
  for (const m of ranked) if (m.isOwner || m.isViewer) pinned.add(m.id);
  const out = ranked.filter((m) => pinned.has(m.id));
  for (const m of ranked) {
    if (out.length >= max) break;
    if (!pinned.has(m.id)) out.push(m);
  }
  return out.slice(0, max);
}

/**
 * Who to compare, for a request. An explicit `?with=` wins, re-validated against
 * the current members; an empty one is a deliberate "compare nobody"; an absent
 * one takes the default pairing. Shared by the page and the partial route so the
 * first paint and a later re-fetch of the same URL agree.
 */
export function resolveCompareSelection(
  params: URLSearchParams,
  opts: {
    memberIds: string[];
    memberStats: { profile_id: string; review_count: number }[];
    viewerProfileId?: string | null;
    ownerProfileId?: string | null;
  }
): string[] {
  if (params.has("with")) {
    return parseCompareSelection(params.get("with"), opts.memberIds);
  }
  const rankedMemberIds = [...opts.memberStats]
    .sort((a, b) => b.review_count - a.review_count || a.profile_id.localeCompare(b.profile_id))
    .map((s) => s.profile_id);
  return defaultCompareSelection({
    rankedMemberIds,
    viewerProfileId: opts.viewerProfileId,
    ownerProfileId: opts.ownerProfileId,
  });
}

/** Reviews at each score as a 10-slot array, index 0 = score 1. */
export function distributionBuckets(rows: { score: number; review_count: number }[]): number[] {
  const buckets = new Array(10).fill(0);
  for (const row of rows) {
    const i = row.score - 1;
    if (i >= 0 && i < 10) buckets[i] += row.review_count;
  }
  return buckets;
}

/**
 * A 1–10 score or average as a percentage of a full bar — the width of a score
 * bar, and where the group-average line sits across it.
 */
export function barPercent(score: number): number {
  return Math.min(100, Math.max(0, (score / 10) * 100));
}

/** Share of shared games two members scored within a point of each other. */
export function agreementPercent(withinOne: number, sharedGames: number): number {
  if (sharedGames <= 0) return 0;
  return Math.round((withinOne / sharedGames) * 100);
}

/** "agree closely" / "mostly agree" / … — how to describe a pair's gap. */
export function agreementLabel(meanAbsDiff: number): string {
  if (meanAbsDiff < 0.5) return "Near-identical taste";
  if (meanAbsDiff < 1) return "Mostly agree";
  if (meanAbsDiff < 2) return "Broadly agree";
  if (meanAbsDiff < 3) return "Often disagree";
  return "Opposite taste";
}

/** Consensus / Mixed / Divisive, from the spread across the picked members. */
export function spreadLabel(spread: number): { label: string; className: string } {
  if (spread >= 5) return { label: "Divisive", className: "variance-high" };
  if (spread >= 3) return { label: "Mixed", className: "variance-mid" };
  return { label: "Consensus", className: "variance-low" };
}

const round1 = (n: number | null | undefined): number | null =>
  n == null ? null : Math.round(n * 10) / 10;

/** PostgREST order clauses per sort, each ending in a stable tiebreak. */
const SORT_ORDERS: Record<CompareSort, [string, boolean][]> = {
  disagreement: [["sel_spread", false], ["group_count", false], ["game_id", true]],
  vs_group: [["sel_vs_group_abs", false], ["group_count", false], ["game_id", true]],
  popular: [["group_count", false], ["sel_avg", false], ["game_id", true]],
  highest: [["sel_avg", false], ["group_count", false], ["game_id", true]],
  lowest: [["sel_avg", true], ["group_count", false], ["game_id", true]],
};

export interface GroupCompareContext {
  /** Service-role client — the group_* stat functions are service_role only. */
  db: any;
  groupId: string;
  /** The group's focus, from stats_config. */
  genreId?: string | null;
  platformId?: string | null;
  /** Current members, for names and avatars. */
  members: CompareMemberInput[];
  ownerProfileId?: string | null;
  viewerProfileId?: string | null;
  /** Picked member ids, already validated (parseCompareSelection). */
  selectedIds: string[];
  sort: CompareSort;
  mode: CompareMode;
  /** group_review_summary, which the page has already read for its header. */
  summary?: { review_count: number; game_count: number; avg_score: number | null; hours_sum: number } | null;
  /** group_member_review_stats, likewise — used to rank the picker. */
  memberStats?: { profile_id: string; review_count: number; avg_score: number }[];
}

/**
 * Everything the Stats tab renders.
 *
 * Every query here is bounded by the picked set (at most four members) or by
 * COMPARE_GAMES_SHOWN, so none of them can reach Supabase's 1000-row cap and
 * none need fetchAll: the distribution returns at most (picks + 1) x 10 rows,
 * the per-game scores at most (games shown x picks), the pairs at most six.
 */
export async function loadGroupCompare(ctx: GroupCompareContext): Promise<GroupCompareData> {
  const {
    db, groupId, members, selectedIds, sort, mode,
    ownerProfileId, viewerProfileId,
  } = ctx;

  const statArgs = {
    p_group_id: groupId,
    p_genre_id: ctx.genreId ?? undefined,
    p_platform_id: ctx.genreId ? undefined : ctx.platformId ?? undefined,
  };
  const selectArgs = { ...statArgs, p_profile_ids: selectedIds };

  const memberById = new Map(members.map((m) => [m.id, m]));
  const statsByProfile = new Map((ctx.memberStats ?? []).map((s) => [s.profile_id, s]));

  // Every member ranks, most active reviewer first, not only those with reviews:
  // a ?with= naming someone who hasn't reviewed anything still needs a chip, or
  // their empty column can't be deselected. In a big group the long tail falls
  // off the end of the list anyway.
  const ranked = members
    .map((m) => ({
      id: m.id,
      username: m.username,
      avatar_url: m.avatar_url ?? null,
      reviewCount: statsByProfile.get(m.id)?.review_count ?? 0,
      isOwner: m.id === ownerProfileId,
      isViewer: m.id === viewerProfileId,
    }))
    .sort((a, b) => b.reviewCount - a.reviewCount || a.id.localeCompare(b.id));
  const pickable = comparePickerList(ranked, selectedIds);

  const hasPicks = selectedIds.length > 0;
  let gamesQuery = hasPicks
    ? db.rpc("group_compare_games", selectArgs)
    : null;
  if (gamesQuery) {
    if (mode === "all" && selectedIds.length > 1) gamesQuery = gamesQuery.eq("sel_count", selectedIds.length);
    for (const [col, ascending] of SORT_ORDERS[sort]) gamesQuery = gamesQuery.order(col, { ascending });
    // One extra row tells us whether there were more than we show
    gamesQuery = gamesQuery.limit(COMPARE_GAMES_SHOWN + 1);
  }

  const [distRes, memberStatsRes, gamesRes, pairsRes] = await Promise.all([
    db.rpc("group_score_distribution", { ...statArgs, p_profile_ids: hasPicks ? selectedIds : undefined }),
    hasPicks ? db.rpc("group_compare_member_stats", selectArgs) : Promise.resolve({ data: [], error: null }),
    gamesQuery ?? Promise.resolve({ data: [], error: null }),
    selectedIds.length >= 2
      ? db.rpc("group_compare_pairs", selectArgs)
      : Promise.resolve({ data: [], error: null }),
  ]);

  for (const res of [distRes, memberStatsRes, gamesRes, pairsRes]) {
    if (res?.error) console.error("[groupCompare] stats error:", JSON.stringify(res.error));
  }

  const distRows: { profile_id: string | null; score: number; review_count: number }[] = distRes?.data ?? [];
  const groupDistribution = distributionBuckets(distRows.filter((r) => r.profile_id == null));

  const compareStatsByProfile = new Map<string, any>(
    (memberStatsRes?.data ?? []).map((r: any) => [r.profile_id, r])
  );

  const membersOut: CompareMemberRow[] = selectedIds.map((id, i) => {
    const m = memberById.get(id)!;
    const s = compareStatsByProfile.get(id);
    return {
      ...m,
      color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      isViewer: id === viewerProfileId,
      isOwner: id === ownerProfileId,
      reviewCount: s?.review_count ?? statsByProfile.get(id)?.review_count ?? 0,
      avgScore: round1(s?.avg_score ?? statsByProfile.get(id)?.avg_score ?? null),
      hoursSum: s?.hours_sum ?? 0,
      vsGroupGames: s?.vs_group_games ?? 0,
      vsGroupAbsDiff: round1(s?.vs_group_abs_diff ?? null),
      vsGroupAbove: s?.vs_group_above ?? 0,
      vsGroupBelow: s?.vs_group_below ?? 0,
      vsGroupLevel: s?.vs_group_level ?? 0,
      distribution: distributionBuckets(distRows.filter((r) => r.profile_id === id)),
    };
  });
  const memberRowById = new Map(membersOut.map((m) => [m.id, m]));

  const gameRows: any[] = gamesRes?.data ?? [];
  const truncated = gameRows.length > COMPARE_GAMES_SHOWN;
  const shownGames = gameRows.slice(0, COMPARE_GAMES_SHOWN);

  // Second wave: the picked members' own scores on just the games being shown
  const scoresByGame = new Map<string, { profileId: string; score: number }[]>();
  if (shownGames.length > 0) {
    const { data: scoreRows, error: scoreErr } = await db.rpc("group_compare_scores", {
      p_group_id: groupId,
      p_profile_ids: selectedIds,
      p_game_ids: shownGames.map((g) => g.game_id),
    });
    if (scoreErr) console.error("[groupCompare] scores error:", JSON.stringify(scoreErr));
    for (const row of scoreRows ?? []) {
      const list = scoresByGame.get(row.game_id) ?? [];
      list.push({ profileId: row.profile_id, score: row.score });
      scoresByGame.set(row.game_id, list);
    }
  }

  const games: CompareGameRow[] = shownGames.map((row: any) => ({
    game: { id: row.game_id, title: row.title, slug: row.slug, cover_img_url: row.cover_img_url },
    groupCount: row.group_count,
    groupAvg: round1(row.group_avg)!,
    selCount: row.sel_count,
    selAvg: round1(row.sel_avg)!,
    selSpread: row.sel_spread,
    selVsGroup: round1(row.sel_vs_group)!,
    // Keep the picked order so a member's colour is in the same place every row
    scores: selectedIds.flatMap((id) => {
      const hit = (scoresByGame.get(row.game_id) ?? []).find((s) => s.profileId === id);
      return hit ? [hit] : [];
    }),
  }));

  const pairs: ComparePairRow[] = (pairsRes?.data ?? [])
    .flatMap((row: any) => {
      const a = memberRowById.get(row.a_profile_id);
      const b = memberRowById.get(row.b_profile_id);
      if (!a || !b || row.shared_games === 0) return [];
      return [{
        a, b,
        sharedGames: row.shared_games,
        meanAbsDiff: round1(row.mean_abs_diff)!,
        exactMatches: row.exact_matches,
        withinOne: row.within_one,
        aHigher: row.a_higher,
        bHigher: row.b_higher,
        agreementPct: agreementPercent(row.within_one, row.shared_games),
      }];
    })
    // Most overlap first — a pair with two games in common says little
    .sort((x: ComparePairRow, y: ComparePairRow) => y.sharedGames - x.sharedGames);

  return {
    members: membersOut,
    pickable,
    groupAvg: round1(ctx.summary?.avg_score ?? null),
    groupReviewCount: ctx.summary?.review_count ?? 0,
    groupGameCount: ctx.summary?.game_count ?? 0,
    groupHoursSum: ctx.summary?.hours_sum ?? 0,
    groupDistribution,
    games,
    pairs,
    sort,
    mode,
    truncated,
  };
}
