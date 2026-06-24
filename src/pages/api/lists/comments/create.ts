import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id, body, parent_id } = await context.request.json();
  if (!list_id || !body?.trim()) return json({ error: "list_id and body are required." }, 400);
  if (body.trim().length > 2000) return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  const { data: inserted, error } = await (db as any)
    .from('list_comments')
    .insert({ list_id, profile_id: profile.id, body: body.trim(), parent_id: parent_id || null })
    .select('id, body, created_at, parent_id')
    .single();

  if (error) {
    console.error('[lists/comments/create] insert error:', JSON.stringify(error));
    return json({ error: "Failed to post comment." }, 500);
  }

  // Notify list owner (non-blocking)
  try {
    const { data: list } = await (db as any)
      .from('lists').select('profile_id').eq('id', list_id).single();
    if (list && list.profile_id !== profile.id) {
      await (db as any).from('notifications').insert({
        profile_id: list.profile_id,
        actor_profile_id: profile.id,
        list_id,
        type: 'list_comment',
      });
    }
  } catch (e) {
    console.error('[lists/comments/create] notification error (non-fatal):', e);
  }

  const { data: profileRow } = await (db as any)
    .from('profiles').select('id, username, avatar_url').eq('id', profile.id).single();

  return json({ comment: { ...inserted, profiles: profileRow } });
};
