/**
 * The group Feed tab: what the group has been reviewing, and the argument of the
 * day at the top of it.
 *
 * Reading a group's reviews used to mean a sidebar card showing five of them as
 * one-line rows. This is the feed proper — real review cards, the viewer's own
 * score beside each one, and filters that only exist because the scores are
 * structured data (nothing else the group could be on can tell you which of
 * today's reviews you disagree with).
 *
 * Aggregation and filtering happen in group_feed() and group_daily_disagreement()
 * (migration 20260912000001). The page and the partial route
 * /groups/[id]/feed both call loadGroupFeed() and render the same components.
 */

/** Reviews per page. */
export const FEED_PAGE_SIZE = 20;

/** Scores this far apart are a disagreement worth surfacing. */
export const DISAGREEMENT_GAP = 3;

export const FEED_FILTERS = ["all", "disagree", "unplayed"] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];

export const FEED_FILTER_LABELS: Record<FeedFilter, string> = {
  all: "Everything",
  disagree: "We disagree",
  unplayed: "Haven't played",
};

export const FEED_FILTER_EMPTY: Record<FeedFilter, string> = {
  all: "Nobody in the group has published a review yet.",
  disagree: "You and the group agree on everything you've both played — so far.",
  unplayed: "You've played everything the group has reviewed.",
};

/** The fields a ReviewCard needs. Same shape the home feed selects. */
export const GROUP_FEED_SELECT = `
  id, score, title, body, play_time_hours,
  contains_spoilers, status, published_at, created_at,
  played_on:platform_played_on ( id, name, slug ),
  games ( id, title, slug, cover_img_url ),
  profiles ( id, username, avatar_url ),
  review_votes( vote, profile_id ),
  review_reactions( reaction_type, profile_id ),
  review_comments( id )
`;

export interface DisagreementSide {
  profile: { id: string; username: string; avatar_url?: string | null };
  score: number;
  reviewId: string;
  votes: number;
  /** The viewer is one of the two people arguing. */
  isViewer: boolean;
}

export interface DailyDisagreement {
  /** The day it was picked for, as YYYY-MM-DD in the site's timezone. */
  day: string;
  game: { id: string; title: string; slug: string | null; cover_img_url: string | null };
  spread: number;
  high: DisagreementSide;
  low: DisagreementSide;
  totalVotes: number;
  /** The profile the viewer sided with, if they have voted today. */
  myVote: string | null;
}

export interface GroupFeedData {
  reviews: any[];
  /** game_id → the viewer's own published score, for the comparison line. */
  viewerScores: Record<string, number>;
  viewerProfileId: string | null;
  filter: FeedFilter;
  /** Offset for the next page, or null when the feed is exhausted. */
  nextOffset: number | null;
  /** Only built for the first page — it heads the feed, it isn't part of it. */
  disagreement: DailyDisagreement | null;
}

export function isFeedFilter(value: unknown): value is FeedFilter {
  return typeof value === "string" && (FEED_FILTERS as readonly string[]).includes(value);
}

/**
 * The filter for a request. The viewer-relative filters need a viewer, so they
 * fall back to "all" for a logged-out visitor — matching what group_feed() does
 * with a null viewer, so the tab's highlighted filter can't disagree with the
 * rows underneath it.
 */
export function parseFeedFilter(input: unknown, hasViewer: boolean): FeedFilter {
  if (!hasViewer) return "all";
  return isFeedFilter(input) ? input : "all";
}

/** A page offset from the query string — never negative, never a fraction. */
export function parseFeedOffset(input: unknown): number {
  const n = Number(input);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/**
 * Today, where the site draws the day boundary. The daily disagreement rotates
 * on this, so it has to be one timezone for everyone rather than the viewer's —
 * the same Los Angeles day the home page's "today" uses.
 */
export function siteDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/** How the two sides of a disagreement split the vote, as whole percentages. */
export function votePercents(high: number, low: number): { high: number; low: number } {
  const total = high + low;
  if (total === 0) return { high: 0, low: 0 };
  const highPct = Math.round((high / total) * 100);
  return { high: highPct, low: 100 - highPct };
}

/** How the viewer's score sits against one from the feed. */
export function scoreComparison(
  viewerScore: number | undefined,
  reviewScore: number
): { gap: number; verdict: "agree" | "close" | "disagree" } | null {
  if (viewerScore == null) return null;
  const gap = Math.abs(viewerScore - reviewScore);
  return {
    gap,
    verdict: gap === 0 ? "agree" : gap < DISAGREEMENT_GAP ? "close" : "disagree",
  };
}

export interface GroupFeedContext {
  /** Service-role client — group_feed and group_daily_disagreement are service_role only. */
  db: any;
  groupId: string;
  genreId?: string | null;
  platformId?: string | null;
  viewerProfileId?: string | null;
  filter: FeedFilter;
  offset: number;
  /** Skip the day's argument when paging — it heads the feed, it isn't in it. */
  withDisagreement: boolean;
  /** Overridable so the day doesn't shift under a test. */
  day?: string;
}

/**
 * One page of the feed, plus the day's disagreement on the first page.
 *
 * The filters are applied inside group_feed() rather than here: filtering a page
 * of 20 after it arrives would show a handful of rows and page through the feed
 * wrongly.
 */
export async function loadGroupFeed(ctx: GroupFeedContext): Promise<GroupFeedData> {
  const { db, groupId, viewerProfileId = null, filter, offset } = ctx;
  const day = ctx.day ?? siteDay();

  const focus = {
    p_genre_id: ctx.genreId ?? undefined,
    p_platform_id: ctx.genreId ? undefined : ctx.platformId ?? undefined,
  };

  // One row past the page tells us whether there's another page, without a count
  const { data: rows, error } = await db
    .rpc("group_feed", {
      p_group_id: groupId,
      p_viewer_profile_id: viewerProfileId ?? undefined,
      p_filter: filter,
      ...focus,
    })
    .select(GROUP_FEED_SELECT)
    .order("published_at", { ascending: false })
    .order("id")
    .range(offset, offset + FEED_PAGE_SIZE);
  if (error) console.error("[groupFeed] feed error:", JSON.stringify(error));

  const page: any[] = rows ?? [];
  const hasMore = page.length > FEED_PAGE_SIZE;
  const reviews = hasMore ? page.slice(0, FEED_PAGE_SIZE) : page;

  // Second wave: the viewer's own scores on the games in this page, so each card
  // can carry "you gave it 10". Bounded by the page size.
  const viewerScores: Record<string, number> = {};
  const gameIds = [...new Set(reviews.map((r) => r.games?.id).filter(Boolean))];
  if (viewerProfileId && gameIds.length > 0) {
    const { data: own, error: ownErr } = await db
      .from("reviews")
      .select("game_id, score")
      .eq("profile_id", viewerProfileId)
      .eq("status", "published")
      .in("game_id", gameIds);
    if (ownErr) console.error("[groupFeed] viewer scores error:", JSON.stringify(ownErr));
    for (const row of own ?? []) viewerScores[row.game_id] = row.score;
  }

  const disagreement = ctx.withDisagreement
    ? await loadDailyDisagreement({ db, groupId, day, viewerProfileId, focus })
    : null;

  return {
    reviews,
    viewerScores,
    viewerProfileId,
    filter,
    nextOffset: hasMore ? offset + FEED_PAGE_SIZE : null,
    disagreement,
  };
}

/**
 * The day's disagreement, with how the group has voted and where the viewer
 * stands. Returns null when the group has nothing far enough apart to argue
 * about, which is the normal state of a new group.
 */
export async function loadDailyDisagreement(opts: {
  db: any;
  groupId: string;
  day: string;
  viewerProfileId?: string | null;
  focus?: { p_genre_id?: string; p_platform_id?: string };
}): Promise<DailyDisagreement | null> {
  const { db, groupId, day, viewerProfileId = null, focus = {} } = opts;

  const { data: pick, error } = await db
    .rpc("group_daily_disagreement", { p_group_id: groupId, p_day: day, ...focus })
    .maybeSingle();
  if (error) console.error("[groupFeed] disagreement error:", JSON.stringify(error));
  if (!pick) return null;

  const [{ data: game }, { data: people }, { data: tally }, { data: myVote }] = await Promise.all([
    db.from("games").select("id, title, slug, cover_img_url").eq("id", pick.game_id).maybeSingle(),
    db.from("profiles").select("id, username, avatar_url")
      .in("id", [pick.high_profile_id, pick.low_profile_id]),
    db.rpc("group_disagreement_tally", { p_group_id: groupId, p_day: day }),
    viewerProfileId
      ? db.from("group_disagreement_votes").select("voted_for")
          .eq("group_id", groupId).eq("day", day).eq("profile_id", viewerProfileId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!game) return null;

  type SideProfile = { id: string; username: string; avatar_url?: string | null };
  const byId = new Map<string, SideProfile>(
    (people ?? []).map((p: SideProfile) => [p.id, p])
  );
  const votesFor = (id: string) =>
    (tally ?? []).find((t: any) => t.voted_for === id)?.votes ?? 0;

  const side = (profileId: string, score: number, reviewId: string): DisagreementSide | null => {
    const profile = byId.get(profileId);
    if (!profile) return null;
    return { profile, score, reviewId, votes: votesFor(profileId), isViewer: profileId === viewerProfileId };
  };

  const high = side(pick.high_profile_id, pick.high_score, pick.high_review_id);
  const low = side(pick.low_profile_id, pick.low_score, pick.low_review_id);
  if (!high || !low) return null;

  return {
    day,
    game,
    spread: pick.spread,
    high,
    low,
    totalVotes: high.votes + low.votes,
    myVote: myVote?.voted_for ?? null,
  };
}
