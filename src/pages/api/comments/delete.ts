import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id } = await context.request.json();
  if (!comment_id) return json({ error: "comment_id is required." }, 400);

  const { error } = await db
    .from('review_comments')
    .delete()
    .eq('id', comment_id)
    .eq('profile_id', profile.id);

  if (error) {
    console.error('[comments/delete] delete error:', JSON.stringify(error));
    return json({ error: "Failed to delete comment." }, 500);
  }

  return json({ success: true });
};
