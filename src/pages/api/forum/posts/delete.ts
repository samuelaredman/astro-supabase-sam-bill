import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

// Delete a forum post (and, via ON DELETE CASCADE, its comments). Restricted to
// site_admins; scoped to the author's own posts.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { post_id } = await context.request.json();
  if (!post_id) return json({ error: "post_id is required." }, 400);

  const { error } = await (db as any)
    .from("forum_posts")
    .delete()
    .eq("id", post_id)
    .eq("profile_id", profile.id);

  if (error) {
    console.error("[forum/posts/delete] delete error:", JSON.stringify(error));
    return json({ error: "Failed to delete post." }, 500);
  }

  return json({ success: true });
};
