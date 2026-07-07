import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id } = await context.request.json();
  if (!comment_id) return json({ error: "comment_id is required." }, 400);

  const { data: comment } = await (db as any)
    .from('recommendation_comments')
    .select('id, profile_id')
    .eq('id', comment_id)
    .maybeSingle();

  if (!comment) return json({ error: "Comment not found." }, 404);
  if (comment.profile_id !== profile.id) return json({ error: "Not your comment." }, 403);

  const { error } = await (db as any)
    .from('recommendation_comments')
    .delete()
    .eq('id', comment_id);

  if (error) {
    console.error('[recommendations/comments/delete] error:', JSON.stringify(error));
    return json({ error: "Failed to delete comment." }, 500);
  }

  return json({ success: true });
};
