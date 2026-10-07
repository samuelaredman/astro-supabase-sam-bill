/**
 * The group Games tab (?tab=games): games a creator features — the ones they
 * 100%, review or play through — each with its video, a note, an optional question
 * and how the group did on it.
 *
 * The members' numbers come from group_featured_game_stats() (migration
 * 20261006000007): played, completed, 100% / platinum, average rating,
 * achievement % and hours. Nothing here counts review or library rows — see
 * "Review stats" in CLAUDE.md. A featured game's question is an ordinary group
 * poll with featured_game_id set (migration 20261006000005), so voting, closing
 * and deleting go through /api/groups/polls/*. Its options are optional, and
 * members can always answer in their own words too (group_poll_answers,
 * migration 20261006000008, through /api/groups/polls/answer).
 *
 * The page (src/pages/groups/[id]/index.astro) calls loadGroupFeaturedGames()
 * only when it's the tab in the URL, and src/components/groups/GamesTab.astro
 * renders it.
 */

import { fetchAll } from "./fetchAll";
import { getGroupAuthority, type SupabaseAdmin } from "./api";

/** The most featured games one group can have, and the most the tab shows. */
export const FEATURED_GAMES_MAX = 50;
/** Avatars shown for the members who 100%'d / platinumed a game. */
export const FEATURED_FULL_AVATARS = 8;

export const FEATURED_NOTE_MAX = 500;
export const POLL_QUESTION_MAX = 300;
export const POLL_OPTION_MAX = 80;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 6;
export const POLL_ANSWER_MAX = 500;

export interface FeaturedPollInput {
  question: string;
  options: string[];
}

/**
 * Reads the optional `poll` field of a feature request: the creator's question.
 * Absent or null → no question. Otherwise it needs a question, and either no
 * options (members only write answers) or 2–6 distinct ones, within the same
 * limits as the group's other polls.
 */
export function readFeaturedPoll(
  value: unknown,
): { poll: FeaturedPollInput | null } | { error: string } {
  if (value == null) return { poll: null };
  if (typeof value !== "object") return { error: "Invalid question." };
  const { question, options } = value as { question?: unknown; options?: unknown };
  const q = typeof question === "string" ? question.trim() : "";
  if (!q) return { error: "Write a question." };
  if (q.length > POLL_QUESTION_MAX) return { error: `The question is too long (max ${POLL_QUESTION_MAX} characters).` };
  if (options != null && !Array.isArray(options)) return { error: "Invalid options." };
  const clean = (options ?? [])
    .map((o: unknown) => (typeof o === "string" ? o.trim() : ""))
    .filter(Boolean);
  if (clean.some((o: string) => o.length > POLL_OPTION_MAX)) return { error: `Options can be at most ${POLL_OPTION_MAX} characters.` };
  const unique = [...new Set(clean.map((o: string) => o.toLowerCase()))];
  if (unique.length !== clean.length) return { error: "Options must be different from each other." };
  if (clean.length > 0 && (clean.length < POLL_OPTIONS_MIN || clean.length > POLL_OPTIONS_MAX))
    return { error: `Add between ${POLL_OPTIONS_MIN} and ${POLL_OPTIONS_MAX} options, or none to only take written answers.` };
  return { poll: { question: q, options: clean } };
}

/** A member's written answer to a question: trimmed, 1–500 characters; empty → delete it. */
export function readPollAnswer(value: unknown): { body: string | null } | { error: string } {
  if (value == null) return { body: null };
  if (typeof value !== "string") return { error: "Invalid answer." };
  const body = value.trim();
  if (body.length > POLL_ANSWER_MAX) return { error: `Your answer is too long (max ${POLL_ANSWER_MAX} characters).` };
  return { body: body || null };
}

/** Reads the optional note: absent → leave alone, empty → clear. */
export function readFeaturedNote(
  body: Record<string, unknown>,
): { present: false } | { present: true; note: string | null } | { present: true; error: string } {
  if (!("note" in body)) return { present: false };
  const value = body.note;
  if (value == null) return { present: true, note: null };
  if (typeof value !== "string") return { present: true, error: "Invalid note." };
  const note = value.trim();
  if (note.length > FEATURED_NOTE_MAX) return { present: true, error: `The note is too long (max ${FEATURED_NOTE_MAX} characters).` };
  return { present: true, note: note || null };
}

/**
 * Whether someone may feature games in a group: owners and admins (site admins
 * count, via getGroupAuthority), and custom roles with can_feature_games that
 * aren't view-only.
 */
export async function canFeatureGames(db: SupabaseAdmin, groupId: string, profileId: string): Promise<boolean> {
  const authority = await getGroupAuthority(db, groupId, profileId);
  if (!authority) return false;
  if (["owner", "admin"].includes(authority.role)) return true;
  if (!authority.custom_role_id) return false;
  const { data: role } = await db.from("group_roles")
    .select("can_feature_games, is_view_only").eq("id", authority.custom_role_id).maybeSingle();
  return !!role?.can_feature_games && !role.is_view_only;
}

/** Creates the featured game's question and any options; returns an error, or null on success. */
export async function createFeaturedPoll(
  db: SupabaseAdmin,
  groupId: string,
  featuredId: string,
  profileId: string,
  poll: FeaturedPollInput,
): Promise<unknown> {
  const { data: row, error } = await db.from("group_polls").insert({
    group_id: groupId, profile_id: profileId, question: poll.question, featured_game_id: featuredId,
  }).select("id").single();
  if (error) {
    console.error("[groups/featured-games] poll insert error:", JSON.stringify(error));
    return error;
  }
  if (poll.options.length === 0) return null;
  const { error: optError } = await db.from("group_poll_options").insert(
    poll.options.map((label, i) => ({ poll_id: row.id, label, position: i })),
  );
  if (optError) {
    console.error("[groups/featured-games] poll option insert error:", JSON.stringify(optError));
    await db.from("group_polls").delete().eq("id", row.id);
    return optError;
  }
  return null;
}

// ── Stats ────────────────────────────────────────────────────────────────────

/** One row of group_featured_game_stats(). */
export interface FeaturedStatsRow {
  game_id: string;
  member_count: number;
  played_count: number;
  completed_count: number;
  full_count: number;
  review_count: number;
  avg_score: number | null;
  achievement_count: number;
  avg_achievement_pct: number | null;
  hours_count: number;
  avg_hours: number | null;
  full_profile_ids: string[] | null;
}

export interface FeaturedStats {
  memberCount: number;
  played: number;
  /** Share of the group's members who played it, 0–100. */
  playedPct: number | null;
  completed: number;
  /** Share of those who played it who finished it, 0–100. */
  completedPct: number | null;
  full: number;
  /** Share of those who played it who 100%'d or platinumed it, 0–100. */
  fullPct: number | null;
  reviewCount: number;
  avgScore: number | null;
  achievementCount: number;
  /** Average achievement completion, 0–100. */
  avgAchievementPct: number | null;
  hoursCount: number;
  avgHours: number | null;
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** A stats row as the card shows it; a game nobody has touched is all zeros. */
export function buildFeaturedStats(row: FeaturedStatsRow | null | undefined, memberCount = 0): FeaturedStats {
  const members = row?.member_count ?? memberCount;
  const played = row?.played_count ?? 0;
  const completed = row?.completed_count ?? 0;
  const full = row?.full_count ?? 0;
  const reviewCount = row?.review_count ?? 0;
  const achievementCount = row?.achievement_count ?? 0;
  const hoursCount = row?.hours_count ?? 0;
  return {
    memberCount: members,
    played,
    playedPct: pct(played, members),
    completed,
    completedPct: pct(completed, played),
    full,
    fullPct: pct(full, played),
    reviewCount,
    avgScore: reviewCount > 0 && row?.avg_score != null ? row.avg_score : null,
    achievementCount,
    avgAchievementPct: achievementCount > 0 && row?.avg_achievement_pct != null
      ? Math.round(row.avg_achievement_pct * 100)
      : null,
    hoursCount,
    avgHours: hoursCount > 0 && row?.avg_hours != null ? Math.round(row.avg_hours * 10) / 10 : null,
  };
}

/** "37h", "4.5h", "45m" — hours as the card shows them. */
export function formatHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  return hours >= 10 ? `${Math.round(hours)}h` : `${Math.round(hours * 10) / 10}h`;
}

// ── Polls ────────────────────────────────────────────────────────────────────

export interface FeaturedPollOption {
  id: string;
  label: string;
  count: number;
  /** Share of the votes, 0–100. */
  pct: number;
}

export interface FeaturedAnswer {
  id: string;
  profileId: string;
  username: string;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  edited: boolean;
}

export interface FeaturedPoll {
  id: string;
  question: string;
  closed: boolean;
  profileId: string;
  totalVotes: number;
  myOptionId: string | null;
  /** Empty when the question only takes written answers. */
  options: FeaturedPollOption[];
  /** Written answers, the viewer's first, then newest first. */
  answers: FeaturedAnswer[];
  myAnswer: FeaturedAnswer | null;
}

export interface AnswerRow {
  id: string;
  poll_id: string;
  profile_id: string;
  body: string;
  created_at: string;
  updated_at: string;
  profiles: { username: string; avatar_url: string | null } | null;
}

/**
 * A question with its options in order, each option's share of the votes, and
 * its written answers — the viewer's first, then newest first.
 */
export function summarizePoll(
  poll: { id: string; question: string; closed: boolean; profile_id: string },
  options: { id: string; poll_id: string; label: string; position: number }[],
  votes: { poll_id: string; option_id: string; profile_id: string }[],
  viewerProfileId: string | null,
  answerRows: AnswerRow[] = [],
): FeaturedPoll {
  const mine = votes.filter((v) => v.poll_id === poll.id);
  const total = mine.length;
  const answers: FeaturedAnswer[] = answerRows
    .filter((a) => a.poll_id === poll.id && a.profiles)
    .sort((a, b) =>
      Number(b.profile_id === viewerProfileId) - Number(a.profile_id === viewerProfileId)
      || b.created_at.localeCompare(a.created_at))
    .map((a) => ({
      id: a.id,
      profileId: a.profile_id,
      username: a.profiles!.username,
      avatarUrl: a.profiles!.avatar_url,
      body: a.body,
      createdAt: a.created_at,
      edited: a.updated_at !== a.created_at,
    }));
  return {
    id: poll.id,
    question: poll.question,
    closed: poll.closed,
    profileId: poll.profile_id,
    totalVotes: total,
    myOptionId: viewerProfileId ? mine.find((v) => v.profile_id === viewerProfileId)?.option_id ?? null : null,
    options: options
      .filter((o) => o.poll_id === poll.id)
      .sort((a, b) => a.position - b.position)
      .map((o) => {
        const count = mine.filter((v) => v.option_id === o.id).length;
        return { id: o.id, label: o.label, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 };
      }),
    answers,
    myAnswer: viewerProfileId ? answers.find((a) => a.profileId === viewerProfileId) ?? null : null,
  };
}

// ── Loader ───────────────────────────────────────────────────────────────────

export interface FeaturedGame {
  id: string;
  createdAt: string;
  createdBy: string | null;
  note: string | null;
  youtubeVideoId: string | null;
  game: { id: string; title: string; slug: string | null; coverImgUrl: string | null; year: number | null };
  stats: FeaturedStats;
  /** Some of the members who 100%'d or platinumed it (public libraries only). */
  fullMembers: { id: string; username: string; avatarUrl: string | null }[];
  poll: FeaturedPoll | null;
  /** The viewer's published review of the game, if any. */
  myReview: { id: string; score: number } | null;
}

export interface GroupGamesData {
  games: FeaturedGame[];
  memberCount: number;
}

export async function loadGroupFeaturedGames(opts: {
  db: any;
  groupId: string;
  memberCount: number;
  viewerProfileId: string | null;
}): Promise<GroupGamesData> {
  const { db, groupId, memberCount, viewerProfileId } = opts;

  const { data: rows, error } = await db
    .from("group_featured_games")
    .select("id, game_id, youtube_video_id, note, created_at, created_by, games ( id, title, slug, cover_img_url, date_released )")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(FEATURED_GAMES_MAX);
  if (error) console.error("[groupFeaturedGames] featured games:", JSON.stringify(error));
  const featured = (rows ?? []).filter((r: any) => r.games);
  if (featured.length === 0) return { games: [], memberCount };

  const gameIds: string[] = featured.map((r: any) => r.game_id);
  const featuredIds: string[] = featured.map((r: any) => r.id);

  const [statsRes, pollsRes, myReviewsRes] = await Promise.all([
    db.rpc("group_featured_game_stats", { p_group_id: groupId, p_game_ids: gameIds }),
    db.from("group_polls")
      .select("id, question, closed, profile_id, featured_game_id")
      .in("featured_game_id", featuredIds),
    viewerProfileId
      ? db.from("reviews").select("id, game_id, score")
          .eq("profile_id", viewerProfileId).eq("status", "published").in("game_id", gameIds)
      : Promise.resolve({ data: [] }),
  ]);
  if (statsRes.error) console.error("[groupFeaturedGames] stats:", JSON.stringify(statsRes.error));
  if (pollsRes.error) console.error("[groupFeaturedGames] polls:", JSON.stringify(pollsRes.error));

  const statsByGame = new Map<string, FeaturedStatsRow>(
    ((statsRes.data ?? []) as FeaturedStatsRow[]).map((s) => [s.game_id, s]),
  );
  const pollRows: any[] = pollsRes.data ?? [];
  const pollIds = pollRows.map((p) => p.id);

  // Votes and answers are paged: fifty questions in a big group pass the 1000-row cap
  const [optionsRes, voteRows, answerRows] = pollIds.length
    ? await Promise.all([
        db.from("group_poll_options").select("id, poll_id, label, position").in("poll_id", pollIds),
        fetchAll<any>((from, to) => db.from("group_poll_votes").select("poll_id, option_id, profile_id")
          .in("poll_id", pollIds).order("id").range(from, to)),
        fetchAll<AnswerRow>((from, to) => db.from("group_poll_answers")
          .select("id, poll_id, profile_id, body, created_at, updated_at, profiles ( username, avatar_url )")
          .in("poll_id", pollIds).order("id").range(from, to)),
      ])
    : [{ data: [] }, [], []];

  const fullIds = [...new Set(
    [...statsByGame.values()].flatMap((s) => (s.full_profile_ids ?? []).slice(0, FEATURED_FULL_AVATARS)),
  )];
  const { data: fullProfiles } = fullIds.length
    ? await db.from("profiles").select("id, username, avatar_url").in("id", fullIds)
    : { data: [] };
  const profileById = new Map<string, any>((fullProfiles ?? []).map((p: any) => [p.id, p]));

  const pollByFeatured = new Map<string, any>(pollRows.map((p) => [p.featured_game_id, p]));
  const myReviewByGame = new Map<string, any>((myReviewsRes.data ?? []).map((r: any) => [r.game_id, r]));

  const games: FeaturedGame[] = featured.map((r: any) => {
    const statsRow = statsByGame.get(r.game_id);
    const poll = pollByFeatured.get(r.id);
    const review = myReviewByGame.get(r.game_id);
    return {
      id: r.id,
      createdAt: r.created_at,
      createdBy: r.created_by,
      note: r.note,
      youtubeVideoId: r.youtube_video_id,
      game: {
        id: r.games.id,
        title: r.games.title,
        slug: r.games.slug,
        coverImgUrl: r.games.cover_img_url,
        year: r.games.date_released ? new Date(r.games.date_released).getFullYear() : null,
      },
      stats: buildFeaturedStats(statsRow, memberCount),
      fullMembers: (statsRow?.full_profile_ids ?? [])
        .slice(0, FEATURED_FULL_AVATARS)
        .map((id) => profileById.get(id))
        .filter(Boolean)
        .map((p: any) => ({ id: p.id, username: p.username, avatarUrl: p.avatar_url })),
      poll: poll ? summarizePoll(poll, optionsRes.data ?? [], voteRows, viewerProfileId, answerRows) : null,
      myReview: review ? { id: review.id, score: review.score } : null,
    };
  });

  return { games, memberCount: games[0]?.stats.memberCount ?? memberCount };
}
