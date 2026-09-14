export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAuth, json } from '../../../utils/api';

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { group_id } = body;

  if (group_id === null || group_id === undefined || group_id === '') {
    const { error } = await db.from('profiles').update({ featured_group_id: null }).eq('id', profile.id);
    if (error) {
      console.error('[profile/featured-group] clear error:', JSON.stringify(error));
      return json({ error: 'Failed to update.' }, 500);
    }
    return json({ ok: true });
  }

  // Must be a member of the group to feature it — doesn't have to be one they created
  const { data: membership } = await db
    .from('group_members')
    .select('id')
    .eq('group_id', group_id)
    .eq('profile_id', profile.id)
    .maybeSingle();
  if (!membership) return json({ error: 'You can only feature a group you belong to.' }, 403);

  const { error } = await db.from('profiles').update({ featured_group_id: group_id }).eq('id', profile.id);
  if (error) {
    console.error('[profile/featured-group] update error:', JSON.stringify(error));
    return json({ error: 'Failed to update.' }, 500);
  }

  return json({ ok: true });
};
