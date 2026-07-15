import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

// Create a forum ("Updates") post. Restricted to site_admins via requireAdmin —
// this is the enforcement point for "only Sam and Bill can post".
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { title, body, category, pinned } = await context.request.json();

  if (!title?.trim() || !body?.trim())
    return json({ error: "Title and body are required." }, 400);
  if (title.trim().length > 200)
    return json({ error: "Title must be 200 characters or fewer." }, 400);
  if (body.trim().length > 20000)
    return json({ error: "Post must be 20000 characters or fewer." }, 400);

  const { data: inserted, error } = await (db as any)
    .from("forum_posts")
    .insert({
      profile_id: profile.id,
      title: title.trim(),
      body: body.trim(),
      category: typeof category === "string" && category.trim() ? category.trim() : "announcement",
      pinned: pinned === true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[forum/posts/create] insert error:", JSON.stringify(error));
    return json({ error: "Failed to create post." }, 500);
  }

  return json({ post_id: inserted.id });
};
