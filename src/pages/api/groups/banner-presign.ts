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
    const { fileType, fileSize, groupId } = body;
    if (!groupId) return json({ error: 'Missing groupId' }, 400);

    if (fileSize > 15 * 1024 * 1024) return json({ error: 'File must be under 15MB' }, 400);
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(fileType)) return json({ error: 'Only JPEG, PNG, WebP, or GIF allowed' }, 400);

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

    const { data: existing } = await db.storage.from('banners').list(`groups/${groupId}`);
    if (existing?.length) {
      await db.storage.from('banners').remove(existing.map((f: any) => `groups/${groupId}/${f.name}`));
    }

    const ext = fileType === 'image/png' ? 'png' : fileType === 'image/webp' ? 'webp' : fileType === 'image/gif' ? 'gif' : 'jpg';
    const path = `groups/${groupId}/banner-${Date.now()}.${ext}`;

    const { data: signedData, error: signError } = await db.storage
      .from('banners')
      .createSignedUploadUrl(path, { upsert: true });

    if (signError) {
      console.error('[groups/banner-presign] sign error:', JSON.stringify(signError));
      return json({ error: signError.message }, 500);
    }

    return json({ signedUrl: signedData.signedUrl, path });
  } catch (err) {
    console.error('[groups/banner-presign] unhandled error:', err);
    return json({ error: 'Internal server error' }, 500);
  }
};
