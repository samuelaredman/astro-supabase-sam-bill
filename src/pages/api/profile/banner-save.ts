export const prerender = false;
import type { APIRoute } from 'astro';
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from '../../../utils/database';
import { json } from '../../../utils/api';

export const POST: APIRoute = async (context) => {
  try {
    const userClient = createSupabaseServerClientFromContext(context);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const body = await context.request.json();
    const { path, banner_position } = body;
    if (!path) return json({ error: 'Missing path' }, 400);

    if (!path.startsWith(`${user.id}/`)) return json({ error: 'Invalid path' }, 403);

    const db = getSupabaseAdmin();

    const { data: profile } = await db
      .from('profiles').select('id').eq('auth_user_id', user.id).single();
    if (!profile) return json({ error: 'Profile not found' }, 404);

    const { data: { publicUrl } } = db.storage.from('banners').getPublicUrl(path);

    const { error: updateError } = await db
      .from('profiles')
      .update({ banner_url: publicUrl, banner_position: banner_position || 'center' })
      .eq('id', profile.id);

    if (updateError) {
      console.error('[profile/banner-save] update error:', JSON.stringify(updateError));
      return json({ error: updateError.message }, 500);
    }

    return json({ url: publicUrl });
  } catch (err) {
    console.error('[profile/banner-save] unhandled error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
};
