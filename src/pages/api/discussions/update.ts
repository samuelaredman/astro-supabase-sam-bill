import type { APIRoute } from "astro";
import { requireAuth, json, isSiteAdmin } from "../../../utils/api";

// Edit a site discussion: title + body. Author may edit their own; site
// admins may edit any.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { discussion_id, title, body } = await context.request.json();
  if (!discussion_id || !body?.trim())
    return json({ error: "discussion_id and body are required" }, 400);
  if (title && String(title).length > 200)
    return json({ error: "Title too long (max 200)" }, 400);
  if (body.length > 2000000)
    return json({ error: "Discussion is too large" }, 400);

  const { data: discussion } = await (db as any)
    .from("site_discussions")
    .select("id, profile_id")
    .eq("id", discussion_id)
    .maybeSingle();
  if (!discussion) return json({ error: "Discussion not found" }, 404);

  const isAuthor = discussion.profile_id === profile.id;
  if (!isAuthor && !(await isSiteAdmin(db, profile.id)))
    return json({ error: "Not authorized" }, 403);

  const { error } = await (db as any)
    .from("site_discussions")
    .update({
      title: title ? String(title).trim() : null,
      body: body.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", discussion_id);
  if (error) {
    console.error("[discussions/update] error:", JSON.stringify(error));
    return json({ error: "Failed to update discussion" }, 500);
  }

  return json({ success: true });
};
