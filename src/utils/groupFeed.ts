/**
 * The group Feed tab: what the group has been reviewing.
 *
 * Reading a group's reviews used to mean a sidebar card showing five of them as
 * one-line rows. This is the feed proper — real review cards, the viewer's own
 * score beside each one, and filters that only exist because the scores are
 * structured data (nothing else the group could be on can tell you which of
 * today's reviews you disagree with).
 *
 * Aggregation and filtering happen in group_feed() (migration 20260912000001). The page and the partial route
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

export interface GroupFeedData {
  reviews: any[];
  /** game_id → the viewer's own published score, for the comparison line. */
  viewerScores: Record<string, number>;
  viewerProfileId: string | null;
  filter: FeedFilter;
  /** Offset for the next page, or null when the feed is exhausted. */
  nextOffset: number | null;
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
  /** Service-role client — group_feed is service_role only. */
  db: any;
  groupId: string;
  genreId?: string | null;
  platformId?: string | null;
  viewerProfileId?: string | null;
  filter: FeedFilter;
  offset: number;
}

/**
 * One page of the feed.
 *
 * The filters are applied inside group_feed() rather than here: filtering a page
 * of 20 after it arrives would show a handful of rows and page through the feed
 * wrongly.
 */
export async function loadGroupFeed(ctx: GroupFeedContext): Promise<GroupFeedData> {
  const { db, groupId, viewerProfileId = null, filter, offset } = ctx;

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

  return {
    reviews,
    viewerScores,
    viewerProfileId,
    filter,
    nextOffset: hasMore ? offset + FEED_PAGE_SIZE : null,
  };
}
