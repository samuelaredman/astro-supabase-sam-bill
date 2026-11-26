import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";
import { cdnCacheHeaders, CACHE_TAG_UPDATES } from "../../../utils/cache";

// Every page checks this to decide whether to show the dot badge, so it was one
// of the most-invoked functions on the site at a 2-minute TTL. Posts are rare
// and staff-only: cache 1 h and let forum/posts/(create|update|delete) purge
// the `updates` tag so a new post still shows up immediately.
export const GET: APIRoute = async () => {
  const db = getSupabaseAdmin() as any;

  const { data } = await db
    .from("forum_posts")
    .select("id, title, created_at, pinned")
    .order("created_at", { ascending: false })
    .limit(10);

  const posts = data ?? [];
  const latest = posts[0] ?? null;
  const latestPinned = posts.find((p: any) => p.pinned) ?? null;

  return new Response(
    JSON.stringify({
      latest_at: latest?.created_at ?? null,
      ids: posts.map((p: any) => p.id),
      pinned: latestPinned
        ? { id: latestPinned.id, title: latestPinned.title }
        : null,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...cdnCacheHeaders(3600, 86400, [CACHE_TAG_UPDATES]),
      },
    }
  );
};
