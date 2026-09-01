import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";

// CDN-cached 2 min — every page checks this to decide whether to show the dot badge.
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
        "Netlify-CDN-Cache-Control": "public, max-age=120, stale-while-revalidate=300",
      },
    }
  );
};
