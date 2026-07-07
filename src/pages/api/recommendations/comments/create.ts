import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { recommendation_id, body, parent_id } = await context.request.json();
  if (!recommendation_id || !body?.trim()) return json({ error: "recommendation_id and body are required." }, 400);
  if (body.trim().length > 2000) return json({ error: "Comment must be 2000 characters or fewer." }, 400);

  const { data: inserted, error } = await (db as any)
    .from('recommendation_comments')
    .insert({ recommendation_id, profile_id: profile.id, body: body.trim(), parent_id: parent_id || null })
    .select('id, body, created_at, parent_id')
    .single();

  if (error) {
    console.error('[recommendations/comments/create] insert error:', JSON.stringify(error));
    return json({ error: "Failed to post comment." }, 500);
  }

  // Notify recommendation owner (non-blocking)
  try {
    const { data: rec } = await (db as any)
      .from('recommendations').select('profile_id').eq('id', recommendation_id).single();
    if (rec && rec.profile_id !== profile.id) {
      await (db as any).from('notifications').insert({
        profile_id: rec.profile_id,
        actor_profile_id: profile.id,
        recommendation_id,
        type: 'recommendation_comment',
      });
    }
  } catch (e) {
    console.error('[recommendations/comments/create] notification error (non-fatal):', e);
  }

  const { data: profileRow } = await (db as any)
    .from('profiles').select('id, username, avatar_url').eq('id', profile.id).single();

  return json({ comment: { ...inserted, profiles: profileRow } });
};
