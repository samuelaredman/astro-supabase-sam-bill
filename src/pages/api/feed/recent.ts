import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";
import { igdbImage } from "../../../utils/format";
import { cdnCacheHeaders } from "../../../utils/cache";
import { attachReviewVideos } from "../../../utils/reviewVideos";

const REVIEW_FIELDS = `
  id, score, title, body, play_time_hours,
  contains_spoilers, status, published_at, created_at,
  played_on:platform_played_on ( id, name, slug ),
  games ( id, title, slug, cover_img_url ),
  profiles ( id, username, avatar_url, profile_badges!profile_badges_profile_id_fkey ( badge_slug ) ),
  review_votes( vote, profile_id ),
  review_reactions( reaction_type, profile_id ),
  review_comments( id )
`;

const REC_FIELDS = `
  id, body, contains_spoilers, created_at, profile_id,
  source_game:games!source_game_id ( id, title, slug, cover_img_url ),
  target_game:games!target_game_id ( id, title, slug, cover_img_url ),
  profiles ( id, username, avatar_url, profile_badges!profile_badges_profile_id_fkey ( badge_slug ) ),
  recommendation_votes ( vote, profile_id ),
  recommendation_reactions ( reaction_type, profile_id ),
  recommendation_comments ( id )
`;

const LIST_FIELDS = `
  id, title, description, is_ranked, cover_image_url, created_at, last_posted_to_feed_at, profile_id,
  profiles ( id, username, avatar_url, profile_badges!profile_badges_profile_id_fkey ( badge_slug ) ),
  list_entries ( games ( cover_img_url ) ),
  list_votes ( vote, profile_id ),
  list_comments ( id ),
  list_reactions ( reaction_type, profile_id )
`;

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  // Per-stream cursors — reviews, recs, and lists each advance independently.
  // A single shared cursor silently skips rows: if one stream is sparse (e.g.
  // the oldest-of-10 list is 8 days old while the oldest-of-30 reviews is 1
  // day old), the merged "oldest overall" cursor jumps past every review in
  // between on the next page. Falls back to the legacy `cursor` param so an
  // older client still gets something back; new client sends all three.
  const now = new Date().toISOString();
  const legacyCursor = url.searchParams.get("cursor");
  const rCursor  = url.searchParams.get("r_cursor")  ?? legacyCursor ?? now;
  const rcCursor = url.searchParams.get("rc_cursor") ?? legacyCursor ?? now;
  const lCursor  = url.searchParams.get("l_cursor")  ?? legacyCursor ?? now;
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);

  const db = getSupabaseAdmin();

  const [reviewsRes, recsRes, listsRes] = await Promise.all([
    db.from("reviews")
      .select(REVIEW_FIELDS)
      .eq("status", "published")
      .lt("published_at", rCursor)
      .order("published_at", { ascending: false })
      .limit(limit),

    db.from("recommendations")
      .select(REC_FIELDS)
      .eq("status", "published")
      .lt("created_at", rcCursor)
      .order("created_at", { ascending: false })
      .limit(limit),

    db.from("lists")
      .select(LIST_FIELDS)
      .eq("visibility", "public")
      .not("last_posted_to_feed_at", "is", null)
      .lt("last_posted_to_feed_at", lCursor)
      .order("last_posted_to_feed_at", { ascending: false })
      .limit(limit),
  ]);

  if (reviewsRes.error) console.error("[feed/recent] reviews error:", JSON.stringify(reviewsRes.error));
  if (recsRes.error)    console.error("[feed/recent] recs error:",    JSON.stringify(recsRes.error));
  if (listsRes.error)   console.error("[feed/recent] lists error:",   JSON.stringify(listsRes.error));

  const reviews = (reviewsRes.data ?? []).map((r: any) => ({
    ...r,
    _type: "review",
    _date: r.published_at || r.created_at,
  }));
  await attachReviewVideos(db, reviews);

  const recs = (recsRes.data ?? []).map((r: any) => ({
    ...r,
    _type: "rec",
    _date: r.created_at,
  }));

  const lists = (listsRes.data ?? []).map((l: any) => {
    const entries = Array.isArray(l.list_entries) ? l.list_entries : [];
    const coverUrls: string[] = [];
    for (const e of entries) {
      const img = igdbImage(e.games?.cover_img_url, "t_cover_big");
      if (img && coverUrls.length < 10) coverUrls.push(img);
    }
    return {
      ...l,
      _type: "list",
      // A list rides the feed on its last post time — a repost should surface
      // the list again rather than keeping its original created_at position.
      _date: l.last_posted_to_feed_at ?? l.created_at,
      entryCount: entries.length,
      coverUrls,
    };
  });

  const items = [...reviews, ...recs, ...lists]
    .sort((a, b) => new Date(b._date).getTime() - new Date(a._date).getTime())
    .slice(0, limit);

  // Advance each stream's cursor only to the oldest of its own rows in the
  // output slice. A stream that fetched 0 rows is exhausted (null). A stream
  // that fetched < limit but had no row in the slice is also exhausted —
  // everything it has is older than the slice cutoff, so re-querying would
  // just loop. A stream that fetched a full page but got nothing in the
  // slice keeps its cursor so its rows reappear on the next merge.
  function nextCursor(type: string, fetched: any[], prev: string): string | null {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]._type === type) return items[i]._date;
    }
    if (fetched.length < limit) return null;
    return prev;
  }
  const cursors = {
    reviews: nextCursor("review", reviews, rCursor),
    recs:    nextCursor("rec",    recs,    rcCursor),
    lists:   nextCursor("list",   lists,   lCursor),
  };

  return new Response(JSON.stringify({ items, cursors }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...cdnCacheHeaders(120, 300),
      "Cache-Control": "no-store",
    },
  });
};
