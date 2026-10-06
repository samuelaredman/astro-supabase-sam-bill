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

/** One side's value on a tile. */
export interface TapeSide {
  value: string;
  sub?: string;
}

/**
 * A tile on the tale of the tape. Each kind has its own little visual:
 * - pick: each side's favourite (genre, platform, studio), merged into one when they match
 * - bar: a tug-of-war bar split by who has more, with a one-line takeaway
 * - era: both sides placed on a release-year timeline
 */
export type TapeTile =
  | { kind: "pick"; key: string; icon: string; label: string; left: TapeSide | null; right: TapeSide | null; same: boolean }
  | { kind: "bar"; key: string; icon: string; label: string; left: TapeSide; right: TapeSide; leftShare: number; headline: string }
  | {
      kind: "era"; key: string; icon: string; label: string;
      /** Average release year, and where it sits along the axis, 0–100. */
      left: { year: number; pos: number } | null;
      right: { year: number; pos: number } | null;
      from: number; to: number; headline: string;
    };

/** How a tile's sentences name the two sides: "You" / "@sam" / "The community". */
export interface TapeNames {
  subject: string;
  other: string;
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
  /** The tale of the tape: both sides' profiles as tiles. Empty when either side has no reviews. */
  tape: TapeTile[];
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

/** "2010s" from an average release year. */
export function decadeLabel(year: number | null): string | null {
  if (year == null || !Number.isFinite(year)) return null;
  return `${Math.floor(Math.round(year) / 10) * 10}s`;
}

/** "1.8×", or "3×" once the gap is big enough that a decimal is noise. */
export function ratioLabel(ratio: number): string {
  return ratio >= 3 ? `${Math.round(ratio)}×` : `${(Math.round(ratio * 10) / 10).toFixed(1)}×`;
}

/** "You play" / "@sam plays" / "The community plays". */
function says(name: string, you: string, they: string): string {
  return `${name} ${name === "You" ? you : they}`;
}

/**
 * The takeaway under a bar: who has more and by how much. Close enough
 * (within 15%) reads as a tie; nothing at all on one side reads as "only".
 */
export function barHeadline(
  a: number, b: number, names: TapeNames,
  verb: { you: string; they: string; more: string },
  same: string,
): string {
  if (a === 0 && b === 0) return same;
  const [winner, hi, lo] = a >= b ? [names.subject, a, b] : [names.other, b, a];
  if (lo === 0) {
    // Mid-sentence: "Only you …", "Only the community …"
    const mid = winner === "You" ? "you" : winner.replace(/^The /, "the ");
    return `Only ${mid} ${winner === "You" ? verb.you : verb.they}`;
  }
  const ratio = hi / lo;
  if (ratio < 1.15) return same;
  return `${says(winner, verb.you, verb.they)} ${ratioLabel(ratio)} ${verb.more}`;
}

/**
 * The tale of the tape, from the two sides' profiles. A tile is left out when
 * neither side has the data for it (a bar needs both sides).
 */
export function buildTape(
  a: VersusProfile, b: VersusProfile, names: TapeNames, thisYear = new Date().getFullYear(),
): TapeTile[] {
  if (a.reviewCount === 0 || b.reviewCount === 0) return [];
  const tiles: TapeTile[] = [];

  const pick = (key: string, icon: string, label: string, an: string | null, ac: number, bn: string | null, bc: number, sub: (n: number, total: number) => string) => {
    if (!an && !bn) return;
    tiles.push({
      kind: "pick", key, icon, label,
      left: an ? { value: an, sub: sub(ac, a.reviewCount) } : null,
      right: bn ? { value: bn, sub: sub(bc, b.reviewCount) } : null,
      same: !!an && an === bn,
    });
  };
  const share = (n: number, total: number) => `${pct(n, total)}%`;
  const games = (n: number) => `${n} game${n === 1 ? "" : "s"}`;
  pick("genre", "🎮", "Favourite genre", a.topGenre, a.topGenreCount, b.topGenre, b.topGenreCount, share);
  pick("platform", "🕹️", "Go-to platform", a.topPlatform, a.topPlatformCount, b.topPlatform, b.topPlatformCount, share);
  pick("studio", "🏢", "Favourite studio", a.topStudio, a.topStudioCount, b.topStudio, b.topStudioCount, (n) => games(n));

  // Era: both sides on a timeline from 1980 (earlier if needed) to this year
  const ay = a.avgReleaseYear, by = b.avgReleaseYear;
  if (ay != null || by != null) {
    const years = [ay, by].filter((y): y is number => y != null);
    const from = Math.min(1980, Math.floor(Math.min(...years) / 5) * 5);
    const to = Math.max(thisYear, Math.ceil(Math.max(...years)));
    const at = (y: number | null) => (y == null ? null : { year: Math.round(y), pos: ((y - from) / (to - from)) * 100 });
    let headline = "";
    if (ay != null && by != null) {
      const gap = Math.round(Math.abs(ay - by));
      headline = gap < 2
        ? `Same era: the ${decadeLabel((ay + by) / 2)}`
        : `${says(ay > by ? names.subject : names.other, "play", "plays")} ${gap} years newer`;
    }
    tiles.push({ kind: "era", key: "era", icon: "📅", label: "Era", left: at(ay), right: at(by), from, to, headline });
  }

  const bar = (key: string, icon: string, label: string, av: number | null, bv: number | null, fmt: (v: number) => TapeSide, headline: (x: number, y: number) => string) => {
    if (av == null || bv == null) return;
    const total = av + bv;
    tiles.push({
      kind: "bar", key, icon, label,
      left: fmt(av), right: fmt(bv),
      leftShare: total > 0 ? Math.round((av / total) * 100) : 50,
      headline: headline(av, bv),
    });
  };

  bar("hours", "⏱️", "Hours per game", a.avgHours, b.avgHours,
    (v) => ({ value: `${Math.round(v).toLocaleString("en-US")}h` }),
    (x, y) => barHeadline(x, y, names, { you: "play", they: "plays", more: "longer per game" }, "Same pace per game"));

  const tensA = pct(a.tens, a.reviewCount), tensB = pct(b.tens, b.reviewCount);
  bar("tens", "💯", "Perfect 10s", tensA, tensB,
    (v) => ({ value: `${v}%` }),
    (x, y) => barHeadline(x, y, names, { you: "hand out 10s", they: "hands out 10s", more: "as often" }, x === 0 ? "No 10s on either side" : "Just as generous with 10s"));

  bar("takes", "🌶️", "Hot takes", a.hotTakeBase > 0 ? pct(a.hotTakes, a.hotTakeBase) : null, b.hotTakeBase > 0 ? pct(b.hotTakes, b.hotTakeBase) : null,
    (v) => ({ value: `${v}%` }),
    (x, y) => barHeadline(x, y, names, { you: "go against the crowd", they: "goes against the crowd", more: "more often" }, x === 0 ? "Nobody goes against the crowd" : "Equally contrarian"));

  bar("words", "✍️", "Review length", a.avgWords, b.avgWords,
    (v) => ({ value: `${Math.round(v).toLocaleString("en-US")}`, sub: "words" }),
    (x, y) => barHeadline(x, y, names, { you: "write", they: "writes", more: "as much" }, "About the same length"));

  return tiles;
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
      {
        subject: subject.isViewer ? "You" : `@${subject.username}`,
        other: opponent ? `@${opponent.username}` : "The community",
      },
    ),
  };
}
