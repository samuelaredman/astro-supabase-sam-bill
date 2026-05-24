export const prerender = false;
import type { APIRoute } from 'astro';
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from '../../../utils/database';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async (context) => {
  try {
    const userClient = createSupabaseServerClientFromContext(context);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const body = await context.request.json();
    const { path, banner_position, groupId } = body;
    if (!path || !groupId) return json({ error: 'Missing path or groupId' }, 400);

    if (!path.startsWith(`groups/${groupId}/`)) return json({ error: 'Invalid path' }, 403);

    const db = getSupabaseAdmin() as any;

    const { data: profile } = await db
      .from('profiles').select('id').eq('auth_user_id', user.id).single();
    if (!profile) return json({ error: 'Profile not found' }, 404);

    const { data: membership } = await db
      .from('group_members').select('role')
      .eq('group_id', groupId).eq('profile_id', profile.id).maybeSingle();
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return json({ error: 'Not authorized' }, 403);
    }

    const { data: { publicUrl } } = db.storage.from('banners').getPublicUrl(path);

    const { error: updateError } = await db
      .from('groups')
      .update({ banner_url: publicUrl, banner_position: banner_position || 'center' })
      .eq('id', groupId);

    if (updateError) {
      console.error('[groups/banner-save] update error:', JSON.stringify(updateError));
      return json({ error: updateError.message }, 500);
    }

    return json({ url: publicUrl + '?t=' + Date.now() });
  } catch (err) {
    console.error('[groups/banner-save] unhandled error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
};
