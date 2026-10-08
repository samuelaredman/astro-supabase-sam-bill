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

import { formatScore } from "./format";

/**
 * Other members who must have reviewed a game before it counts as the
 * community's opinion. One: most games here have only a handful of reviews,
 * and at two a typical member had nothing in common with their group at all.
 */
export const COMMUNITY_MIN_REVIEWS = 1;

/** Games shown at first, and added by each "Show more". */
export const VERSUS_GAMES_PAGE = 10;
/** The most games one view will show, however many times "Show more" is pressed. */
export const VERSUS_GAMES_MAX = 200;

/**
 * The tab-wide "Games" filter (?sc=), which narrows every stat on the tab —
 * the cards, the middle numbers, the charts and the list — to:
 * - all: every game either side reviewed (the other side enough to count)
 * - shared: both sides reviewed it
 * - disagree / agree: shared, more than / at most VERSUS_AGREE_GAP apart
 * The SQL side is group_versus_scope() (migration 20261006000004).
 */
export const VERSUS_SCOPES = ["all", "shared", "disagree", "agree"] as const;
export type VersusScope = (typeof VERSUS_SCOPES)[number];

/**
 * The games list's own filter (?gf=), only offered under the "all" scope,
 * since the other scopes are shared games by definition:
 * - all: every game in the scope
 * - yours: only the subject reviewed it
 * - theirs: only the other side did
 */
export const VERSUS_GAME_FILTERS = ["all", "yours", "theirs"] as const;
export type VersusGameFilter = (typeof VERSUS_GAME_FILTERS)[number];

/** ?sc=. Links from before the scope moved tab-wide carried it in ?gf=, so that's read too. */
export function parseVersusScope(raw: string | null | undefined, legacyFilter?: string | null): VersusScope {
  for (const v of [raw, legacyFilter]) {
    if ((VERSUS_SCOPES as readonly string[]).includes(v ?? "")) return v as VersusScope;
  }
  return "all";
}

/** How the games list is ordered. Every one ends on stable tie-breaks. */
export const VERSUS_GAME_SORTS = ["gap", "top", "low", "most-reviewed", "title"] as const;
export type VersusGameSort = (typeof VERSUS_GAME_SORTS)[number];

export function parseVersusGameFilter(raw: string | null | undefined): VersusGameFilter {
  return (VERSUS_GAME_FILTERS as readonly string[]).includes(raw ?? "") ? (raw as VersusGameFilter) : "all";
}

export function parseVersusGameSort(raw: string | null | undefined): VersusGameSort {
  return (VERSUS_GAME_SORTS as readonly string[]).includes(raw ?? "") ? (raw as VersusGameSort) : "gap";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?gg=, the tab-wide genre: a genre id. Anything else means every genre; an id that isn't a genre just finds no games. */
export function parseVersusGenre(raw: string | null | undefined): string | null {
  return raw && UUID.test(raw) ? raw.toLowerCase() : null;
}

/** The longest title search kept. */
export const VERSUS_SEARCH_MAX = 80;

/**
 * ?gq=, a title search, made safe for a PostgREST ilike pattern: its
 * wildcards (% _ *) and the characters that end a filter value are dropped,
 * spaces collapsed. Null when nothing is left.
 */
export function parseVersusGameSearch(raw: string | null | undefined): string | null {
  const q = (raw ?? "").replace(/[%_*\\,()"]/g, " ").replace(/\s+/g, " ").trim().slice(0, VERSUS_SEARCH_MAX).trim();
  return q || null;
}

/** ?gn=, how many games to show: a whole number of pages, at least one, at most VERSUS_GAMES_MAX. */
export function parseVersusGameLimit(raw: string | null | undefined): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= VERSUS_GAMES_PAGE) return VERSUS_GAMES_PAGE;
  return Math.min(VERSUS_GAMES_MAX, Math.ceil(n / VERSUS_GAMES_PAGE) * VERSUS_GAMES_PAGE);
}

/**
 * Narrow a group_versus_games query to the tab's scope and, under the "all"
 * scope, the list's own filter. Mirrors group_versus_scope() in SQL.
 */
export function filterVersusGames(query: any, scope: VersusScope, filter: VersusGameFilter, minReviews: number): any {
  const shared = () => query.not("subject_score", "is", null).gte("other_count", minReviews);
  switch (scope) {
    case "shared": return shared();
    case "disagree": return shared().gt("diff_abs", VERSUS_AGREE_GAP);
    case "agree": return shared().lte("diff_abs", VERSUS_AGREE_GAP);
  }
  switch (filter) {
    case "yours": return query.not("subject_score", "is", null).lt("other_count", minReviews);
    case "theirs": return query.is("subject_score", null).gte("other_count", minReviews);
    default: return query.or(`subject_score.not.is.null,other_count.gte.${minReviews}`);
  }
}

/**
 * Order a group_versus_games_ranked query. Games a sort has nothing to say
 * about (no gap) go last. "top" and "low" are one ranking for both sides —
 * a shared game at the two sides' average, any other at its one side's score
 * — and at an equal rating the sides take turns (`turn`, then `rated_side`).
 */
export function sortVersusGames(query: any, sort: VersusGameSort): any {
  const desc = { ascending: false, nullsFirst: false };
  const asc = { ascending: true, nullsFirst: false };
  switch (sort) {
    case "top": query = query.order("rated", desc).order("turn", asc).order("rated_side", asc); break;
    case "low": query = query.order("rated", asc).order("turn", asc).order("rated_side", asc); break;
    case "most-reviewed": query = query.order("other_count", desc).order("other_weighted", desc); break;
    case "title": query = query.order("title", asc); break;
    default: query = query.order("diff_abs", desc).order("pair_avg", desc).order("other_weighted", desc);
  }
  return query.order("other_count", desc).order("game_id");
}

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
  /** Each side's hours, completion and platform; absent when they couldn't be read. */
  subjectDetail?: GameSideDetail;
  otherDetail?: GameSideDetail;
}

/** One side's numbers for one game, from group_versus_game_details. */
export interface GameSideDetail {
  /** The side's reviews of the game — the community's can be many. */
  reviewCount: number;
  /** Average logged play time, and how many reviews logged any. */
  avgHours: number | null;
  hoursCount: number;
  /** Average share of the game's achievements earned, 0–1, and how many people it's over. */
  achievementPct: number | null;
  achievementCount: number;
  /** The platform the side's reviews say they played on most. */
  platform: string | null;
}

const EMPTY_DETAIL: GameSideDetail = {
  reviewCount: 0, avgHours: null, hoursCount: 0, achievementPct: null, achievementCount: 0, platform: null,
};

/** group_versus_game_details' rows, keyed by game, then side. */
export function gameDetails(rows: any[] | null | undefined): Map<string, { subject: GameSideDetail; other: GameSideDetail }> {
  const out = new Map<string, { subject: GameSideDetail; other: GameSideDetail }>();
  for (const r of rows ?? []) {
    const entry = out.get(r.game_id) ?? { subject: EMPTY_DETAIL, other: EMPTY_DETAIL };
    entry[r.side === "subject" ? "subject" : "other"] = {
      reviewCount: r.review_count ?? 0,
      avgHours: r.avg_hours ?? null,
      hoursCount: r.hours_count ?? 0,
      achievementPct: r.avg_achievement_pct ?? null,
      achievementCount: r.achievement_count ?? 0,
      platform: r.top_platform ?? null,
    };
    out.set(r.game_id, entry);
  }
  return out;
}

/** One side's numbers, from group_versus_profile. */
export interface VersusProfile {
  reviewCount: number;
  /** Distinct games — the community pools everyone's reviews, so this can be fewer than reviewCount. */
  gamesPlayed: number;
  avgScore: number | null;
  topGenre: string | null;
  topGenreCount: number;
  avgHours: number | null;
  tens: number;
  /** Average share of each reviewed game's achievements earned, 0–1; null with no synced sets. */
  avgAchievementPct: number | null;
  /** Reviewed games with a synced achievement set — what avgAchievementPct is out of. */
  achievementGames: number;
}

/** One row of a side's stat card. */
export interface StatCardRow {
  key: string;
  label: string;
  left: TapeSide;
  right: TapeSide;
  /** Colour the values like a score. */
  score?: boolean;
}

/** One side's value on a tile. */
export interface TapeSide {
  value: string;
  sub?: string;
}

/**
 * A chart under the stat cards. Each kind has its own little visual:
 * - dist: both sides' score distributions as two lines
 * - radar: both sides' top genres
 * - pick: each side's favourite genre, merged into one when they match
 */
export type TapeTile =
  | {
      kind: "dist"; key: string; icon: string; label: string;
      /** Share of each side's reviews at each score, index 0 = score 1, 0–100. */
      left: number[]; right: number[];
      /** Reviews at each score, and in all, per side — for the bar readouts. */
      leftCounts: number[]; rightCounts: number[];
      leftTotal: number; rightTotal: number;
      leftAvg: number | null; rightAvg: number | null;
      /** Each side's most-given score. */
      leftMode: number; rightMode: number;
      /** The top of the chart's axis: the tallest bar, rounded up to a ten. */
      scale: number;
      headline: string;
    }
  | {
      kind: "radar"; key: string; icon: string; label: string;
      /** One spoke per genre: each side's share of its own reviews, 0–100. */
      axes: { genre: string; left: number; right: number }[];
      /** The outer ring's value — the biggest share, rounded up to a ten. */
      scale: number;
    }
  | { kind: "pick"; key: string; icon: string; label: string; left: TapeSide | null; right: TapeSide | null; same: boolean };

/** Fewer reviews than this on a side make a distribution too lumpy to read. */
export const DIST_MIN_REVIEWS = 3;

/** Reviews at each score as a 10-slot array, index 0 = score 1. */
export function scoreBuckets(rows: { score: number; review_count: number }[]): number[] {
  const out = new Array(10).fill(0);
  for (const r of rows) if (r.score >= 1 && r.score <= 10) out[r.score - 1] += r.review_count;
  return out;
}

/**
 * The score distribution tile: each side's reviews at each score as a share of
 * its own reviews, with averages and most-given scores. Null when either side
 * has too few reviews for the shape to mean anything.
 */
export function buildScoreDistribution(
  left: number[], right: number[], names: TapeNames,
): Extract<TapeTile, { kind: "dist" }> | null {
  const total = (b: number[]) => b.reduce((x, y) => x + y, 0);
  const lt = total(left), rt = total(right);
  if (lt < DIST_MIN_REVIEWS || rt < DIST_MIN_REVIEWS) return null;
  const shares = (b: number[], t: number) => b.map((n) => Math.round((n / t) * 1000) / 10);
  const avg = (b: number[], t: number) => Math.round((b.reduce((sum, n, i) => sum + n * (i + 1), 0) / t) * 10) / 10;
  // Ties go to the higher score
  const mode = (b: number[]) => b.reduce((best, n, i) => (n >= b[best] ? i : best), 0) + 1;
  const l = shares(left, lt), r = shares(right, rt);
  const lm = mode(left), rm = mode(right);
  // Mid-sentence the community is lower-case: "…; the community's is 7"
  const other = names.other.replace(/^The /, "the ");
  const headline = lm === rm
    ? `${names.subject === "You" ? "You both" : `${names.subject} and ${other} both`} give ${lm} most often`
    : `${names.subject === "You" ? "Your" : `${names.subject}'s`} most common score is ${lm}; ${other}'s is ${rm}`;
  return {
    kind: "dist", key: "scores", icon: "📊", label: "How you score",
    left: l, right: r,
    leftCounts: left, rightCounts: right,
    leftTotal: lt, rightTotal: rt,
    leftAvg: avg(left, lt), rightAvg: avg(right, rt),
    leftMode: lm, rightMode: rm,
    scale: Math.max(10, Math.ceil(Math.max(...l, ...r) / 10) * 10),
    headline,
  };
}

/** A side's most-reviewed genres, from group_versus_genres. */
export interface VersusGenreCount {
  genre: string;
  reviewCount: number;
}

/** Spokes on the genre radar. */
export const RADAR_MAX_AXES = 6;
/** Fewer genres than this don't make a shape worth drawing; the tile falls back to the favourite pick. */
export const RADAR_MIN_AXES = 3;

/**
 * The genre radar's spokes: the genres that matter most to either side,
 * ranked by the two sides' shares added together, each side as a share of
 * its own reviews so a community of hundreds and one member compare fairly.
 * Null when there aren't enough genres to draw a shape.
 */
export function buildGenreRadar(
  left: VersusGenreCount[], right: VersusGenreCount[], leftTotal: number, rightTotal: number,
): { axes: { genre: string; left: number; right: number }[]; scale: number } | null {
  if (leftTotal <= 0 || rightTotal <= 0) return null;
  const share = (list: VersusGenreCount[], total: number) =>
    new Map(list.map((g) => [g.genre, Math.round((g.reviewCount / total) * 100)]));
  const l = share(left, leftTotal), r = share(right, rightTotal);
  const genres = [...new Set([...l.keys(), ...r.keys()])];
  const axes = genres
    .map((genre) => ({ genre, left: l.get(genre) ?? 0, right: r.get(genre) ?? 0 }))
    .sort((x, y) => y.left + y.right - (x.left + x.right) || x.genre.localeCompare(y.genre))
    .slice(0, RADAR_MAX_AXES);
  if (axes.length < RADAR_MIN_AXES) return null;
  const top = Math.max(...axes.flatMap((a) => [a.left, a.right]));
  return { axes, scale: Math.max(10, Math.ceil(top / 10) * 10) };
}

/**
 * A genre name short enough for a radar spoke: IGDB's "Role-playing (RPG)"
 * becomes "RPG", "Real Time Strategy (RTS)" "RTS", and "Hack and slash/Beat
 * 'em up" "Hack and slash".
 */
export function shortGenre(name: string): string {
  const abbr = name.match(/\(([A-Z0-9]{2,5})\)\s*$/);
  if (abbr) return abbr[1];
  return name.replace(/\s*\(.*?\)\s*/g, " ").split("/")[0].trim();
}

/** How a tile's sentences name the two sides: "You" / "@sam" / "The community". */
export interface TapeNames {
  subject: string;
  other: string;
}

export interface VersusGames {
  filter: VersusGameFilter;
  sort: VersusGameSort;
  /** Only games whose title contains this, or null for every title. */
  search: string | null;
  /** How many were asked for — the next "Show more" asks for a page more. */
  limit: number;
  rows: VersusGameRow[];
  /** Games under the filter in all, for "Showing 10 of 31". */
  total: number;
  failed: boolean;
}

export interface GroupVersusData {
  /** The tab-wide "Games" filter. */
  scope: VersusScope;
  /** The tab-wide genre filter (its id), or null for every genre. */
  genre: string | null;
  /** The genre menu's choices, A–Z. Empty when the group has a genre focus, which already narrows everything to one. */
  genres: { id: string; name: string }[];
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
  /** The games list: one page (or a few) of the games under the chosen filter and sort. */
  games: VersusGames;
  /** Both sides' stat cards, row by row. Null when the profile couldn't be read. */
  card: StatCardRow[] | null;
  /** The charts under the cards. Empty when either side has no reviews. */
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

/** Members a "compare with" search returns at most. */
export const VERSUS_MEMBER_RESULTS = 30;

/** A member search, as typed: any leading @ dropped, case ignored. */
export function normalizeMemberQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().replace(/^@+/, "").trim().toLowerCase().slice(0, 50);
}

/**
 * The "compare with" search: members (never the subject) whose username
 * contains the query, those starting with it first, then the most active.
 * An empty query gives the menu's usual list.
 */
export function searchVersusMembers(
  ranked: VersusMember[], subjectId: string | null, opponentId: string | null, rawQuery: string | null | undefined,
  max = VERSUS_MEMBER_RESULTS,
): VersusMember[] {
  const q = normalizeMemberQuery(rawQuery);
  if (!q) return versusOptions(ranked, subjectId, opponentId);
  const hits = ranked.filter((m) => m.id !== subjectId && m.username.toLowerCase().includes(q));
  const starts = hits.filter((m) => m.username.toLowerCase().startsWith(q));
  const inside = hits.filter((m) => !m.username.toLowerCase().startsWith(q));
  return [...starts, ...inside].slice(0, max);
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

/** A score gap with its sign, one decimal: "+1.5", "−0.4", "0.0". */
export function signedScore(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)}`;
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

const count = (n: number) => n.toLocaleString("en-US");

/**
 * The two stat cards, as rows: the same stat for each side, so the cards line
 * up. A stat a side has no data for reads "—".
 */
export function buildStatCard(a: VersusProfile, b: VersusProfile): StatCardRow[] {
  const row = (key: string, label: string, side: (p: VersusProfile) => TapeSide, score = false): StatCardRow =>
    ({ key, label, left: side(a), right: side(b), ...(score ? { score } : {}) });
  const none = { value: "—" };
  return [
    row("games", "Games played", (p) => ({ value: count(p.gamesPlayed) })),
    row("rating", "Avg rating", (p) => p.avgScore == null ? none : ({
      value: formatScore(p.avgScore),
      sub: `${count(p.reviewCount)} review${p.reviewCount === 1 ? "" : "s"}`,
    }), true),
    row("achievements", "Avg achievement %", (p) => p.avgAchievementPct == null ? { ...none, sub: "None synced" } : ({
      value: `${Math.round(p.avgAchievementPct * 100)}%`,
      sub: `across ${count(p.achievementGames)} game${p.achievementGames === 1 ? "" : "s"}`,
    })),
    row("hours", "Avg hrs per game", (p) => p.avgHours == null ? none : ({ value: `${count(Math.round(p.avgHours))}h` })),
    row("tens", "Perfect 10s", (p) => ({
      value: count(p.tens),
      ...(p.reviewCount > 0 ? { sub: `${pct(p.tens, p.reviewCount)}% of reviews` } : {}),
    })),
  ];
}

/**
 * The charts under the stat cards: the score distribution, and the genres as
 * a radar when there are enough to make a shape, otherwise each side's
 * favourite. Empty when either side has no reviews.
 */
export function buildTape(
  a: VersusProfile, b: VersusProfile, names: TapeNames,
  genres: { left: VersusGenreCount[]; right: VersusGenreCount[] } = { left: [], right: [] },
  scores: { left: number[]; right: number[] } | null = null,
): TapeTile[] {
  if (a.reviewCount === 0 || b.reviewCount === 0) return [];
  const tiles: TapeTile[] = [];

  // The buckets are whole scores, so the legend's averages come from the
  // profiles instead: the same reviews, at their real one-decimal scores
  const dist = scores ? buildScoreDistribution(scores.left, scores.right, names) : null;
  if (dist) tiles.push({ ...dist, leftAvg: a.avgScore ?? dist.leftAvg, rightAvg: b.avgScore ?? dist.rightAvg });

  const radar = buildGenreRadar(genres.left, genres.right, a.reviewCount, b.reviewCount);
  if (radar) {
    tiles.push({ kind: "radar", key: "genres", icon: "🎮", label: "Top genres", ...radar });
  } else if (a.topGenre || b.topGenre) {
    const fav = (p: VersusProfile) => (p.topGenre ? { value: p.topGenre, sub: `${pct(p.topGenreCount, p.reviewCount)}%` } : null);
    tiles.push({
      kind: "pick", key: "genre", icon: "🎮", label: "Favourite genre",
      left: fav(a), right: fav(b), same: !!a.topGenre && a.topGenre === b.topGenre,
    });
  }

  return tiles;
}

/** Each side's score buckets from group_versus_score_distribution's rows. */
export function sideScores(
  rows: { side: string; score: number; review_count: number }[],
): { left: number[]; right: number[] } {
  return {
    left: scoreBuckets(rows.filter((r) => r.side === "subject")),
    right: scoreBuckets(rows.filter((r) => r.side === "other")),
  };
}

const genreCounts = (rows: any[] | null | undefined, side: string): VersusGenreCount[] =>
  (rows ?? []).filter((r) => r.side === side).map((r) => ({ genre: r.genre, reviewCount: r.review_count }));

const toProfile = (row: any): VersusProfile => ({
  reviewCount: row?.review_count ?? 0,
  gamesPlayed: row?.games_played ?? 0,
  avgScore: row?.avg_score ?? null,
  topGenre: row?.top_genre ?? null,
  topGenreCount: row?.top_genre_count ?? 0,
  avgHours: row?.avg_hours ?? null,
  tens: row?.tens ?? 0,
  avgAchievementPct: row?.avg_achievement_pct ?? null,
  achievementGames: row?.achievement_games ?? 0,
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
  /** The raw ?sc= and ?gg= values: the tab-wide scope and genre. */
  scopeParam?: string | null;
  genreParam?: string | null;
  /** The raw ?gf=, ?gs= and ?gn= values: the games list's filter, sort and length. */
  gamesFilter?: string | null;
  gamesSort?: string | null;
  gamesLimit?: string | null;
  /** The raw ?gq= value: text to find in game titles. */
  gamesSearch?: string | null;
  /** Only the games list is wanted (a filter or sort change): skip the rest of the tab's queries. */
  gamesOnly?: boolean;
}

type VersusArgs = {
  p_group_id: string; p_profile_id: string; p_other_id?: string;
  p_genre_id?: string; p_platform_id?: string;
};

/**
 * One view of the games list: the filtered, sorted page from
 * group_versus_games_ranked (with the total under the filter), then each listed
 * game's hours, completion and platform from group_versus_game_details. A
 * failed details read only costs those extras; the scores still show.
 */
async function loadVersusGames(
  db: any, args: VersusArgs, view: VersusGames, scope: VersusScope, minReviews: number,
): Promise<VersusGames> {
  // Under a narrower scope the list's own filter has nothing to do
  if (scope !== "all") view = { ...view, filter: "all" };
  let query = filterVersusGames(db.rpc("group_versus_games_ranked", args, { count: "exact" }), scope, view.filter, minReviews);
  if (view.search) query = query.ilike("title", `%${view.search}%`);
  const res = await sortVersusGames(query, view.sort).limit(view.limit);
  if (res?.error) {
    console.error("[groupCompare] games error:", JSON.stringify(res.error));
    return { ...view, failed: true };
  }
  const rows: VersusGameRow[] = (res?.data ?? []).map(toGameRow);
  const detailRes = rows.length > 0
    ? await db.rpc("group_versus_game_details", {
      p_group_id: args.p_group_id, p_profile_id: args.p_profile_id, p_game_ids: rows.map((g) => g.game.id),
      p_other_id: args.p_other_id, p_genre_id: args.p_genre_id, p_platform_id: args.p_platform_id,
    })
    : null;
  if (detailRes?.error) console.error("[groupCompare] game details error:", JSON.stringify(detailRes.error));
  const details = gameDetails(detailRes?.error ? null : detailRes?.data);
  return {
    ...view,
    total: res?.count ?? rows.length,
    rows: rows.map((g) => {
      const d = details.get(g.game.id);
      return d ? { ...g, subjectDetail: d.subject, otherDetail: d.other } : g;
    }),
  };
}

/**
 * Who's on each side: every member ranked by reviews, the subject (the viewer,
 * or for a visitor the owner or the most active reviewer) and the opponent
 * (?with=, or null for the community).
 */
export function versusSides(ctx: Pick<GroupVersusContext, "members" | "memberStats" | "ownerProfileId" | "viewerProfileId" | "withParam">) {
  const { members, memberStats, ownerProfileId = null, viewerProfileId = null } = ctx;
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
  return {
    ranked,
    byId,
    subject: subjectId ? byId.get(subjectId)! : null,
    opponent: opponentId ? byId.get(opponentId)! : null,
  };
}

/**
 * Everything the Stats tab renders, under its scope and genre. The summary is
 * one row, the profile two (one per side), the genres at most RADAR_MAX_AXES
 * per side, the score distribution at most twenty, and the games list a
 * .limit()ed read (VERSUS_GAMES_MAX at most), so nothing here can reach
 * Supabase's 1000-row cap.
 */
export async function loadGroupVersus(ctx: GroupVersusContext): Promise<GroupVersusData> {
  const { db, groupId, viewerProfileId = null } = ctx;
  const { ranked, byId, subject, opponent } = versusSides(ctx);
  const subjectId = subject?.id ?? null;
  const opponentId = opponent?.id ?? null;
  const minReviews = opponent ? 1 : COMMUNITY_MIN_REVIEWS;

  // A group's genre focus already narrows everything to one genre, so it has no genre menu
  const hasGenreFocus = !!ctx.genreId;
  const scope = parseVersusScope(ctx.scopeParam, ctx.gamesFilter);
  const genre = hasGenreFocus ? null : parseVersusGenre(ctx.genreParam);

  const data: GroupVersusData = {
    scope,
    genre,
    genres: [],
    subject,
    opponent,
    options: versusOptions(ranked, subjectId, opponentId),
    viewerIsGuest: !viewerProfileId || !byId.has(viewerProfileId),
    minReviews,
    failed: false,
    sharedGames: 0, subjectAvg: null, otherAvg: null, meanAbsDiff: null,
    agreementPct: 0, above: 0, below: 0, level: 0,
    games: {
      filter: parseVersusGameFilter(ctx.gamesFilter),
      sort: parseVersusGameSort(ctx.gamesSort),
      limit: parseVersusGameLimit(ctx.gamesLimit),
      search: parseVersusGameSearch(ctx.gamesSearch),
      rows: [], total: 0, failed: false,
    },
    card: null, tape: [],
  };
  if (!subject) return data;

  const args = {
    p_group_id: groupId,
    p_profile_id: subject.id,
    p_other_id: opponent?.id ?? undefined,
    // The genre menu narrows group_reviews() the same way a group's genre focus does
    p_genre_id: ctx.genreId ?? genre ?? undefined,
    // A group's genre focus wins over its platform focus; the genre menu doesn't
    p_platform_id: ctx.genreId ? undefined : ctx.platformId ?? undefined,
  };
  const scoped = { ...args, p_scope: scope, p_min_reviews: minReviews };
  const gamesPromise = loadVersusGames(db, args, data.games, scope, minReviews);
  const genreMenuPromise = hasGenreFocus ? null : db.from("genres").select("id, name").order("name").limit(500);
  const genreMenu = async () => {
    const res = await genreMenuPromise;
    if (res?.error) console.error("[groupCompare] genres error:", JSON.stringify(res.error));
    return (res?.data ?? []).filter((g: any) => g?.id && g?.name);
  };
  if (ctx.gamesOnly) {
    const [games, genres] = await Promise.all([gamesPromise, genreMenu()]);
    return { ...data, games, genres };
  }

  const [summaryRes, profileRes, genresRes, distRes, games, genres] = await Promise.all([
    db.rpc("group_versus_summary", { ...args, p_min_reviews: minReviews, p_scope: scope }).maybeSingle(),
    db.rpc("group_versus_profile", scoped),
    db.rpc("group_versus_genres", { ...scoped, p_limit: RADAR_MAX_AXES }),
    db.rpc("group_versus_score_distribution", scoped),
    gamesPromise,
    genreMenu(),
  ]);
  for (const res of [summaryRes, profileRes, genresRes, distRes]) {
    if (res?.error) console.error("[groupCompare] versus error:", JSON.stringify(res.error));
  }
  if (summaryRes?.error) return { ...data, failed: true };
  // A failed profile only costs the stat cards and charts, not the whole tab
  const left = toProfile((profileRes?.data ?? []).find((r: any) => r.side === "subject"));
  const right = toProfile((profileRes?.data ?? []).find((r: any) => r.side === "other"));

  const s = summaryRes?.data;
  const tape = buildTape(
    left, right,
    {
      subject: subject.isViewer ? "You" : `@${subject.username}`,
      other: opponent ? `@${opponent.username}` : "The community",
    },
    {
      left: genreCounts(genresRes?.data, "subject"),
      right: genreCounts(genresRes?.data, "other"),
    },
    distRes?.error ? null : sideScores(distRes?.data ?? []),
  );
  return {
    ...data,
    genres,
    sharedGames: s?.shared_games ?? 0,
    subjectAvg: round1(s?.subject_avg),
    otherAvg: round1(s?.other_avg),
    meanAbsDiff: round1(s?.mean_abs_diff),
    agreementPct: agreementPercent(s?.within_one ?? 0, s?.shared_games ?? 0),
    above: s?.above ?? 0,
    below: s?.below ?? 0,
    level: s?.level ?? 0,
    games,
    card: profileRes?.error ? null : buildStatCard(left, right),
    // Under one genre the genre charts would only show that genre: keep the histogram
    tape: genre ? tape.filter((t) => t.kind === "dist") : tape,
  };
}
