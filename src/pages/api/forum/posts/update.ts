import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

// Edit a forum post. Restricted to site_admins; an admin may only edit their own
// post (the .eq('profile_id') scopes the update to the author).
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { post_id, title, body, category, pinned, is_locked } = await context.request.json();
  if (!post_id) return json({ error: "post_id is required." }, 400);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) {
    if (!title?.trim()) return json({ error: "Title cannot be empty." }, 400);
    if (title.trim().length > 200) return json({ error: "Title must be 200 characters or fewer." }, 400);
    patch.title = title.trim();
  }
  if (body !== undefined) {
    if (!body?.trim()) return json({ error: "Body cannot be empty." }, 400);
    if (body.trim().length > 2000000) return json({ error: "Post body is too large." }, 400);
    patch.body = body.trim();
  }
  if (category !== undefined && typeof category === "string" && category.trim()) patch.category = category.trim();
  if (pinned !== undefined) patch.pinned = pinned === true;
  if (is_locked !== undefined) patch.is_locked = is_locked === true;

  const { error } = await (db as any)
    .from("forum_posts")
    .update(patch)
    .eq("id", post_id)
    .eq("profile_id", profile.id);

  if (error) {
    console.error("[forum/posts/update] update error:", JSON.stringify(error));
    return json({ error: "Failed to update post." }, 500);
  }

  return json({ success: true });
};
