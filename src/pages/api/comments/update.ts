import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "You must be signed in to edit a comment." }, 401);

  const { comment_id, body } = await context.request.json();

  if (!comment_id || !body?.trim())
    return json({ error: "comment_id and body are required." }, 400);
  if (body.trim().length > 2000)
    return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

  const { error } = await db
    .from('review_comments')
    .update({ body: body.trim(), updated_at: new Date().toISOString() })
    .eq('id', comment_id)
    .eq('profile_id', profile.id);

  if (error) {
    console.error('[comments/update] update error:', JSON.stringify(error));
    return json({ error: "Failed to update comment." }, 500);
  }

  return json({ success: true });
};
