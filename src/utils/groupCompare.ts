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

/** One side of the tale of the tape, from group_versus_profile. */
export interface VersusProfile {
  reviewCount: number;
  topGenre: string | null;
  topGenreCount: number;
  topPlatform: string | null;
  topPlatformCount: number;
  topStudio: string | null;
  topStudioCount: number;
  avgReleaseYear: number | null;
  avgHours: number | null;
  hoursSum: number;
  tens: number;
  hotTakes: number;
  /** Reviews of games someone else on the site reviewed too — what the hot-take rate is out of. */
  hotTakeBase: number;
  avgWords: number | null;
}

export interface TapeCell {
  value: string;
  sub?: string;
}

export interface TapeRow {
  key: string;
  label: string;
  left: TapeCell;
  right: TapeCell;
  /** Which side to highlight: the bigger number, or "same" when both picked the same thing. */
  lead: "left" | "right" | "same" | null;
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
  /** The tale of the tape: both sides' profiles side by side. Empty when either side has no reviews. */
  tape: TapeRow[];
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

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const EMPTY: TapeCell = { value: "—" };

/** "2010s" from an average release year. */
export function decadeLabel(year: number | null): string | null {
  if (year == null || !Number.isFinite(year)) return null;
  return `${Math.floor(Math.round(year) / 10) * 10}s`;
}

/** The bigger side, when the gap is worth pointing at. */
function leadOf(a: number | null, b: number | null, minGap: number): TapeRow["lead"] {
  if (a == null || b == null || Math.abs(a - b) < minGap) return null;
  return a > b ? "left" : "right";
}

/** A row picking a favourite (genre, platform, studio): "same" when both sides picked it. */
function favouriteRow(
  key: string, label: string,
  a: { name: string | null; count: number; total: number }, b: { name: string | null; count: number; total: number },
  sub: (count: number, total: number) => string
): TapeRow {
  const cell = (s: typeof a): TapeCell => (s.name ? { value: s.name, sub: sub(s.count, s.total) } : EMPTY);
  return { key, label, left: cell(a), right: cell(b), lead: a.name && a.name === b.name ? "same" : null };
}

/**
 * The tale of the tape, from the two sides' profiles. A side with no data for
 * a row shows a dash, and a row with no data on either side is left out.
 */
export function buildTape(a: VersusProfile, b: VersusProfile): TapeRow[] {
  if (a.reviewCount === 0 || b.reviewCount === 0) return [];
  const share = (count: number, total: number) => `${pct(count, total)}% of reviews`;
  const games = (count: number) => `${count} game${count === 1 ? "" : "s"}`;

  const rows: TapeRow[] = [
    favouriteRow("genre", "Favourite genre",
      { name: a.topGenre, count: a.topGenreCount, total: a.reviewCount },
      { name: b.topGenre, count: b.topGenreCount, total: b.reviewCount }, share),
    favouriteRow("platform", "Go-to platform",
      { name: a.topPlatform, count: a.topPlatformCount, total: a.reviewCount },
      { name: b.topPlatform, count: b.topPlatformCount, total: b.reviewCount }, share),
    favouriteRow("studio", "Favourite studio",
      { name: a.topStudio, count: a.topStudioCount, total: a.reviewCount },
      { name: b.topStudio, count: b.topStudioCount, total: b.reviewCount }, (n) => games(n)),
  ];

  const era = (p: VersusProfile): TapeCell => {
    const decade = decadeLabel(p.avgReleaseYear);
    return decade ? { value: decade, sub: `avg ${Math.round(p.avgReleaseYear!)}` } : EMPTY;
  };
  rows.push({
    key: "era", label: "Era", left: era(a), right: era(b),
    lead: decadeLabel(a.avgReleaseYear) && decadeLabel(a.avgReleaseYear) === decadeLabel(b.avgReleaseYear) ? "same" : null,
  });

  const hours = (p: VersusProfile): TapeCell =>
    p.avgHours != null ? { value: `${Math.round(p.avgHours).toLocaleString("en-US")}h`, sub: `${p.hoursSum.toLocaleString("en-US")}h logged` } : EMPTY;
  rows.push({ key: "hours", label: "Hours per game", left: hours(a), right: hours(b), lead: leadOf(a.avgHours, b.avgHours, 1) });

  const tens = (p: VersusProfile): TapeCell => ({ value: `${pct(p.tens, p.reviewCount)}%`, sub: `${p.tens} of ${p.reviewCount}` });
  rows.push({
    key: "tens", label: "Perfect 10s", left: tens(a), right: tens(b),
    lead: leadOf(pct(a.tens, a.reviewCount), pct(b.tens, b.reviewCount), 1),
  });

  const takes = (p: VersusProfile): TapeCell =>
    p.hotTakeBase > 0 ? { value: `${pct(p.hotTakes, p.hotTakeBase)}%`, sub: `3+ from the crowd` } : EMPTY;
  rows.push({
    key: "takes", label: "Hot take rate", left: takes(a), right: takes(b),
    lead: a.hotTakeBase > 0 && b.hotTakeBase > 0 ? leadOf(pct(a.hotTakes, a.hotTakeBase), pct(b.hotTakes, b.hotTakeBase), 1) : null,
  });

  const words = (p: VersusProfile): TapeCell =>
    p.avgWords != null ? { value: Math.round(p.avgWords).toLocaleString("en-US"), sub: "words per review" } : EMPTY;
  rows.push({ key: "words", label: "Review length", left: words(a), right: words(b), lead: leadOf(a.avgWords, b.avgWords, 5) });

  return rows.filter((r) => r.left !== EMPTY || r.right !== EMPTY);
}

const toProfile = (row: any): VersusProfile => ({
  reviewCount: row?.review_count ?? 0,
  topGenre: row?.top_genre ?? null,
  topGenreCount: row?.top_genre_count ?? 0,
  topPlatform: row?.top_platform ?? null,
  topPlatformCount: row?.top_platform_count ?? 0,
  topStudio: row?.top_studio ?? null,
  topStudioCount: row?.top_studio_count ?? 0,
  avgReleaseYear: row?.avg_release_year ?? null,
  avgHours: row?.avg_hours ?? null,
  hoursSum: row?.hours_sum ?? 0,
  tens: row?.tens ?? 0,
  hotTakes: row?.hot_takes ?? 0,
  hotTakeBase: row?.hot_take_base ?? 0,
  avgWords: row?.avg_words ?? null,
});

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
 * Everything the Stats tab renders. The summary is one row, the profile two
 * (one per side), and every list is a .limit()ed read of group_versus_games, so
 * nothing here can reach Supabase's 1000-row cap.
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
    disagreements: [], agreements: [], unreviewed: [], tape: [],
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

  const [summaryRes, disagreeRes, agreeRes, unreviewedRes, profileRes] = await Promise.all([
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
    db.rpc("group_versus_profile", args),
  ]);
  const results = [summaryRes, disagreeRes, agreeRes, unreviewedRes];
  for (const res of [...results, profileRes]) {
    if (res?.error) console.error("[groupCompare] versus error:", JSON.stringify(res.error));
  }
  if (results.some((res) => res?.error)) return { ...data, failed: true };
  // A failed profile only costs the tale of the tape, not the whole tab

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
    tape: buildTape(
      toProfile((profileRes?.data ?? []).find((r: any) => r.side === "subject")),
      toProfile((profileRes?.data ?? []).find((r: any) => r.side === "other")),
    ),
  };
}
