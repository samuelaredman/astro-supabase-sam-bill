import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { comment_id, body } = await context.request.json();
  if (!comment_id || !body?.trim()) return json({ error: "comment_id and body are required." }, 400);
  if (body.trim().length > 2000) return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  const { error } = await (db as any)
    .from('list_comments')
    .update({ body: body.trim(), updated_at: new Date().toISOString() })
    .eq('id', comment_id)
    .eq('profile_id', profile.id);

  if (error) {
    console.error('[lists/comments/update] error:', JSON.stringify(error));
    return json({ error: "Failed to update comment." }, 500);
  }

  return json({ success: true });
};
