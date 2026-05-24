import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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

export const GET: APIRoute = async (context) => {
  const url = new URL(context.request.url);
  const tab    = url.searchParams.get("tab") ?? "recent";
  const cursor = url.searchParams.get("cursor"); // ISO timestamp — exclusive lower bound
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);

  const db = getSupabaseAdmin() as any;

  // ── Following tab — requires auth ─────────────────────────────────────────
  if (tab === "following") {
    const userClient = createSupabaseServerClientFromContext(context);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await db
      .from("profiles").select("id").eq("auth_user_id", user.id).single();
    if (!profile) return json({ error: "Profile not found." }, 404);

    const { data: followRows } = await db
      .from("follows").select("following_id").eq("follower_id", profile.id);
    const followingIds = (followRows ?? []).map((r: any) => r.following_id);
    if (followingIds.length === 0) return json([]);

    let query = db
      .from("reviews")
      .select(REVIEW_FIELDS)
      .eq("status", "published")
      .in("profile_id", followingIds)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (cursor) query = query.lt("published_at", cursor);

    const { data, error } = await query;
    if (error) {
      console.error("[feed] following error:", JSON.stringify(error));
      return json({ error: "Failed to load reviews." }, 500);
    }
    return json(data ?? []);
  }

  // ── Recent tab — public, CDN-cacheable ────────────────────────────────────
  // Cache at the edge for 2 min so repeated/bot requests don't hit Supabase.
  // Cursor varies the response so we vary the cache key on it.
  context.response.headers.set('Netlify-CDN-Cache-Control', 'public, max-age=120, stale-while-revalidate=300');
  context.response.headers.set('Cache-Control', 'no-store');

  let query = db
    .from("reviews")
    .select(REVIEW_FIELDS)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (cursor) query = query.lt("published_at", cursor);

  const { data, error } = await query;
  if (error) {
    console.error("[feed] recent error:", JSON.stringify(error));
    return json({ error: "Failed to load reviews." }, 500);
  }
  return json(data ?? []);
};
