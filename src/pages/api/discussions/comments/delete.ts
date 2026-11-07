import type { APIRoute } from "astro";
import { requireAuth, json, isSiteAdmin } from "../../../../utils/api";

// Delete a site discussion comment. Author may delete their own; site
// admins may delete any.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id } = await context.request.json();
  if (!comment_id) return json({ error: "comment_id is required." }, 400);

  const { data: comment } = await (db as any)
    .from("site_discussion_comments")
    .select("id, profile_id")
    .eq("id", comment_id)
    .maybeSingle();
  if (!comment) return json({ error: "Comment not found." }, 404);

  const isAuthor = comment.profile_id === profile.id;
  if (!isAuthor && !(await isSiteAdmin(db, profile.id)))
    return json({ error: "Not authorized." }, 403);

  const { error } = await (db as any)
    .from("site_discussion_comments").delete().eq("id", comment_id);
  if (error) {
    console.error("[discussions/comments/delete] delete error:", JSON.stringify(error));
    return json({ error: "Failed to delete comment." }, 500);
  }

  return json({ success: true });
};
