import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { following_id } = await context.request.json();

  const { error } = await db.from('follows').insert({ follower_id: profile.id, following_id });
  if (error) return json({ error: error.message }, 400);

  // Fire new_follower notification (non-blocking)
  try {
    const { data: existing } = await db.from('notifications')
      .select('id').eq('profile_id', following_id).eq('actor_profile_id', profile.id)
      .eq('type', 'new_follower').maybeSingle();
    if (!existing) {
      await db.from('notifications').insert({
        profile_id: following_id,
        actor_profile_id: profile.id,
        type: 'new_follower',
      });
    }
  } catch (e) {
    console.error('[follows/toggle] notification error (non-fatal):', e);
  }

  return json({ success: true });
};

export const DELETE: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { following_id } = await context.request.json();

  const { error } = await db.from('follows').delete().eq('follower_id', profile.id).eq('following_id', following_id);
  if (error) return json({ error: error.message }, 400);

  return json({ success: true });
};
