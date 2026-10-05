/**
 * The group Stats tab: "you vs someone". The viewer (or, for a visitor, the
 * group's owner) against either the community — everyone else in the group —
 * or one member they pick, such as the creator.
 *
 * All the aggregation happens in group_versus_games / group_versus_summary
 * (migration 20261005000002), which read through group_reviews() like the rest
 * of the group stats. Nothing here counts or averages review rows — see
 * "Review stats" in CLAUDE.md.
 *
 * Both the page (src/pages/groups/[id]/index.astro) and the partial route the
 * picker re-fetches (src/pages/groups/[id]/compare.astro) call
 * loadGroupVersus() and render src/components/groups/CompareTab.astro, so the
 * first paint and every later pick can't drift apart.
 */

/**
 * Other members who must have reviewed a game before it counts as the
 * community's opinion. One: most games here have only a handful of reviews,
 * and at two a typical member had nothing in common with their group at all.
 */
export const COMMUNITY_MIN_REVIEWS = 1;

/** Games in each list on the tab. */
export const VERSUS_LIST_SHOWN = 5;

/** Members the "compare with" menu offers. The owner and the current pick are always in it. */
export const VERSUS_OPTIONS_SHOWN = 60;

/** More than this far apart counts as a disagreement; this close or closer is agreement. */
export const VERSUS_AGREE_GAP = 1;

export interface VersusMember {
  id: string;
  username: string;
  avatar_url?: string | null;
  isOwner: boolean;
  isViewer: boolean;
  reviewCount: number;
}

export interface VersusGameRow {
  game: { id: string; title: string; slug: string | null; cover_img_url: string | null };
  subjectScore: number | null;
  /** The other side's score: one member's, or the community's average. */
  otherScore: number | null;
  /** Reviews behind otherScore — always 1 against a member. */
  otherCount: number;
  /** subjectScore − otherScore, null unless both exist. */
  diff: number | null;
}

export interface GroupVersusData {
  /** The left side. Null when the group has no members to compare. */
  subject: VersusMember | null;
  /** The right side; null means the community. */
  opponent: VersusMember | null;
  /** Members the "compare with" menu offers (never the subject). */
  options: VersusMember[];
  /** The viewer can't be the left side: logged out, or not a member. */
  viewerIsGuest: boolean;
  /** Other-side reviews a game needs before it counts. */
  minReviews: number;
  /** A stats query failed (e.g. the migration isn't applied), so the numbers can't be trusted. */
  failed: boolean;
  sharedGames: number;
  subjectAvg: number | null;
  otherAvg: number | null;
  meanAbsDiff: number | null;
  agreementPct: number;
  above: number;
  below: number;
  level: number;
  disagreements: VersusGameRow[];
  agreements: VersusGameRow[];
  /** The other side's favourites the subject hasn't reviewed. */
  unreviewed: VersusGameRow[];
}

/** Member ids with reviews, most active reviewer first, ties in a stable order. */
export function rankMemberIds(memberStats: { profile_id: string; review_count: number }[]): string[] {
  return [...memberStats]
    .sort((a, b) => b.review_count - a.review_count || a.profile_id.localeCompare(b.profile_id))
    .map((s) => s.profile_id);
}

/**
 * The left side: the viewer when they're a member, otherwise the owner (the
 * creator on a creator's group), otherwise the most active reviewer.
 */
export function resolveVersusSubject(opts: {
  memberIds: string[];
  /** Most active reviewers first. */
  rankedMemberIds: string[];
  viewerProfileId?: string | null;
  ownerProfileId?: string | null;
}): string | null {
  const members = new Set(opts.memberIds);
  const candidates = [opts.viewerProfileId, opts.ownerProfileId, opts.rankedMemberIds[0], opts.memberIds[0]];
  return candidates.find((id): id is string => !!id && members.has(id)) ?? null;
}

/**
 * The right side, from `?with=`: a current member other than the subject, or
 * null for the community. The id arrives in a URL a visitor can edit.
 */
export function resolveVersusOpponent(input: string | null | undefined, memberIds: string[], subjectId: string | null): string | null {
  const id = (input ?? "").trim();
  if (!id || id === subjectId || !memberIds.includes(id)) return null;
  return id;
}

/**
 * The "compare with" menu: the owner first, then the most active reviewers.
 * The current pick is always kept, however little they've reviewed, so the
 * menu can show it as selected.
 */
export function versusOptions(ranked: VersusMember[], subjectId: string | null, opponentId: string | null, max = VERSUS_OPTIONS_SHOWN): VersusMember[] {
  const others = ranked.filter((m) => m.id !== subjectId);
  const pinned = [...others.filter((m) => m.isOwner), ...others.filter((m) => !m.isOwner && m.id === opponentId)];
  const rest = others.filter((m) => !m.isOwner && m.id !== opponentId);
  return [...pinned, ...rest].slice(0, Math.max(max, pinned.length));
}

/** Share of shared games scored within a point of each other, 0–100. */
export function agreementPercent(withinOne: number, sharedGames: number): number {
  if (sharedGames <= 0) return 0;
  return Math.round((withinOne / sharedGames) * 100);
}

/** How to describe an average gap. */
export function agreementLabel(meanAbsDiff: number): string {
  if (meanAbsDiff < 0.5) return "Near-identical taste";
  if (meanAbsDiff < 1) return "Mostly agree";
  if (meanAbsDiff < 2) return "Broadly agree";
  if (meanAbsDiff < 3) return "Often disagree";
  return "Opposite taste";
}

/** "You score more generously than the community", or null when it can't be said. */
export function graderLabel(subjectName: string, otherName: string, subjectAvg: number | null, otherAvg: number | null): string | null {
  if (subjectAvg == null || otherAvg == null) return null;
  const delta = subjectAvg - otherAvg;
  const verb = subjectName === "You" ? "score" : "scores";
  if (Math.abs(delta) < 0.3) return `${subjectName} and ${otherName} score about the same`;
  return `${subjectName} ${verb} ${delta > 0 ? "more generously" : "tougher"} than ${otherName}`;
}

/** A score gap with its sign, one decimal: "+1.5", "−0.4", "0.0". */
export function signedScore(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)}`;
}

const round1 = (n: number | null | undefined): number | null =>
  n == null ? null : Math.round(n * 10) / 10;

const toGameRow = (row: any): VersusGameRow => ({
  game: { id: row.game_id, title: row.title, slug: row.slug, cover_img_url: row.cover_img_url },
  subjectScore: row.subject_score ?? null,
  otherScore: round1(row.other_avg),
  otherCount: row.other_count ?? 0,
  diff: round1(row.diff),
});

export interface GroupVersusContext {
  /** Service-role client — the group_* stat functions are service_role only. */
  db: any;
  groupId: string;
  /** The group's focus, from stats_config. */
  genreId?: string | null;
  platformId?: string | null;
  /** Current members, for names and avatars. */
  members: { id: string; username: string; avatar_url?: string | null }[];
  /** group_member_review_stats, which the page has already read. */
  memberStats: { profile_id: string; review_count: number }[];
  /** Null on the site group, whose owner isn't a creator to compare with. */
  ownerProfileId?: string | null;
  viewerProfileId?: string | null;
  /** The raw ?with= value. */
  withParam?: string | null;
}

/**
 * Everything the Stats tab renders. The summary is one row and every list is a
 * .limit()ed read of group_versus_games, so nothing here can reach Supabase's
 * 1000-row cap.
 */
export async function loadGroupVersus(ctx: GroupVersusContext): Promise<GroupVersusData> {
  const { db, groupId, members, memberStats, ownerProfileId = null, viewerProfileId = null } = ctx;

  const memberIds = members.map((m) => m.id);
  const reviewsById = new Map(memberStats.map((s) => [s.profile_id, s.review_count]));
  const ranked: VersusMember[] = members
    .map((m) => ({
      id: m.id,
      username: m.username,
      avatar_url: m.avatar_url ?? null,
      isOwner: m.id === ownerProfileId,
      isViewer: m.id === viewerProfileId,
      reviewCount: reviewsById.get(m.id) ?? 0,
    }))
    .sort((a, b) => b.reviewCount - a.reviewCount || a.id.localeCompare(b.id));
  const byId = new Map(ranked.map((m) => [m.id, m]));

  const subjectId = resolveVersusSubject({
    memberIds,
    rankedMemberIds: rankMemberIds(memberStats),
    viewerProfileId,
    ownerProfileId,
  });
  const opponentId = resolveVersusOpponent(ctx.withParam, memberIds, subjectId);
  const subject = subjectId ? byId.get(subjectId)! : null;
  const opponent = opponentId ? byId.get(opponentId)! : null;
  const minReviews = opponent ? 1 : COMMUNITY_MIN_REVIEWS;

  const data: GroupVersusData = {
    subject,
    opponent,
    options: versusOptions(ranked, subjectId, opponentId),
    viewerIsGuest: !viewerProfileId || !byId.has(viewerProfileId),
    minReviews,
    failed: false,
    sharedGames: 0, subjectAvg: null, otherAvg: null, meanAbsDiff: null,
    agreementPct: 0, above: 0, below: 0, level: 0,
    disagreements: [], agreements: [], unreviewed: [],
  };
  if (!subject) return data;

  const args = {
    p_group_id: groupId,
    p_profile_id: subject.id,
    p_other_id: opponent?.id ?? undefined,
    p_genre_id: ctx.genreId ?? undefined,
    p_platform_id: ctx.genreId ? undefined : ctx.platformId ?? undefined,
  };
  const games = () => db.rpc("group_versus_games", args);
  // Scored by the subject and by enough of the other side to call it an opinion
  const shared = () => games().not("subject_score", "is", null).gte("other_count", minReviews);

  const [summaryRes, disagreeRes, agreeRes, unreviewedRes] = await Promise.all([
    db.rpc("group_versus_summary", { ...args, p_min_reviews: minReviews }).maybeSingle(),
    shared().gt("diff_abs", VERSUS_AGREE_GAP)
      .order("diff_abs", { ascending: false }).order("other_count", { ascending: false }).order("game_id")
      .limit(VERSUS_LIST_SHOWN),
    shared().lte("diff_abs", VERSUS_AGREE_GAP)
      .order("pair_avg", { ascending: false }).order("other_count", { ascending: false }).order("game_id")
      .limit(VERSUS_LIST_SHOWN),
    games().is("subject_score", null).gte("other_count", minReviews)
      .order("other_weighted", { ascending: false }).order("other_count", { ascending: false }).order("game_id")
      .limit(VERSUS_LIST_SHOWN),
  ]);
  const results = [summaryRes, disagreeRes, agreeRes, unreviewedRes];
  for (const res of results) {
    if (res?.error) console.error("[groupCompare] versus error:", JSON.stringify(res.error));
  }
  if (results.some((res) => res?.error)) return { ...data, failed: true };

  const s = summaryRes?.data;
  return {
    ...data,
    sharedGames: s?.shared_games ?? 0,
    subjectAvg: round1(s?.subject_avg),
    otherAvg: round1(s?.other_avg),
    meanAbsDiff: round1(s?.mean_abs_diff),
    agreementPct: agreementPercent(s?.within_one ?? 0, s?.shared_games ?? 0),
    above: s?.above ?? 0,
    below: s?.below ?? 0,
    level: s?.level ?? 0,
    disagreements: (disagreeRes?.data ?? []).map(toGameRow),
    agreements: (agreeRes?.data ?? []).map(toGameRow),
    unreviewed: (unreviewedRes?.data ?? []).map(toGameRow),
  };
}
