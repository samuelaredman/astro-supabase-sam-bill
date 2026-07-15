import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

// Delete a forum comment. The author may delete their own; a site_admin may
// delete any (moderation). Deleting a comment cascades to its replies.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id } = await context.request.json();
  if (!comment_id) return json({ error: "comment_id is required." }, 400);

  const { data: adminRow } = await (db as any)
    .from("site_admins").select("profile_id").eq("profile_id", profile.id).maybeSingle();
  const isAdmin = !!adminRow;

  let query = (db as any).from("forum_comments").delete().eq("id", comment_id);
  // Non-admins may only delete their own comment.
  if (!isAdmin) query = query.eq("profile_id", profile.id);

  const { error } = await query;
  if (error) {
    console.error("[forum/comments/delete] delete error:", JSON.stringify(error));
    return json({ error: "Failed to delete comment." }, 500);
  }

  return json({ success: true });
};
