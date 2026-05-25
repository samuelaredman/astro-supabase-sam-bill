import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "You must be signed in to delete a comment." }, 401);

  const { comment_id } = await context.request.json();
  if (!comment_id) return json({ error: "comment_id is required." }, 400);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

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
