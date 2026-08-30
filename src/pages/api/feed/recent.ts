import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";
import { igdbImage } from "../../../utils/format";

const REVIEW_FIELDS = `
  id, score, title, body, play_time_hours,
  contains_spoilers, status, published_at, created_at,
  played_on:platform_played_on ( id, name, slug ),
  games ( id, title, slug, cover_img_url ),
  profiles ( id, username, avatar_url ),
  review_votes( vote, profile_id ),
  review_reactions( reaction_type, profile_id ),
  review_comments( id )
`;

const REC_FIELDS = `
  id, body, contains_spoilers, created_at, profile_id,
  source_game:games!source_game_id ( id, title, slug, cover_img_url ),
  target_game:games!target_game_id ( id, title, slug, cover_img_url ),
  profiles ( id, username, avatar_url ),
  recommendation_votes ( vote, profile_id ),
  recommendation_reactions ( reaction_type, profile_id ),
  recommendation_comments ( id )
`;

const LIST_FIELDS = `
  id, title, description, is_ranked, cover_image_url, created_at, profile_id,
  profiles ( id, username, avatar_url ),
  list_entries ( games ( cover_img_url ) ),
  list_votes ( vote, profile_id ),
  list_comments ( id ),
  list_reactions ( reaction_type, profile_id )
`;

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const cursor = url.searchParams.get("cursor") ?? new Date().toISOString();
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);
  const overFetch = limit * 2;

  const db = getSupabaseAdmin();

  const [reviewsRes, recsRes, listsRes] = await Promise.all([
    db.from("reviews")
      .select(REVIEW_FIELDS)
      .eq("status", "published")
      .lt("published_at", cursor)
      .order("published_at", { ascending: false })
      .limit(overFetch),

    db.from("recommendations")
      .select(REC_FIELDS)
      .eq("status", "published")
      .lt("created_at", cursor)
      .order("created_at", { ascending: false })
      .limit(overFetch),

    db.from("lists")
      .select(LIST_FIELDS)
      .eq("visibility", "public")
      .eq("shared_to_feed", true)
      .lt("created_at", cursor)
      .order("created_at", { ascending: false })
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
      _date: l.created_at,
      entryCount: entries.length,
      coverUrls,
    };
  });

  const items = [...reviews, ...recs, ...lists]
    .sort((a, b) => new Date(b._date).getTime() - new Date(a._date).getTime())
    .slice(0, limit);

  return new Response(JSON.stringify(items), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Netlify-CDN-Cache-Control": "public, max-age=120, stale-while-revalidate=300",
      "Cache-Control": "no-store",
    },
  });
};
