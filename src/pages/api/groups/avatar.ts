export const prerender = false;
import type { APIRoute } from 'astro';
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from '../../../utils/database';

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const form = await context.request.formData();
  const file = form.get('avatar') as File;
  const groupId = form.get('group_id') as string;
  if (!file || !groupId) return json({ error: 'Missing file or group_id' }, 400);
  if (file.size > 5 * 1024 * 1024) return json({ error: 'File must be under 5MB' }, 400);

  const { data: profile } = await (supabase as any)
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: 'Profile not found' }, 404);

  const { data: membership } = await (supabase as any)
    .from('group_members').select('role')
    .eq('group_id', groupId).eq('profile_id', profile.id).maybeSingle();
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return json({ error: 'Not authorized' }, 403);
  }

  const db = getSupabaseAdmin() as any;
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `groups/${groupId}/avatar.${ext}`;

  const { data: existing } = await db.storage.from('avatars').list(`groups/${groupId}`);
  if (existing?.length) {
    await db.storage.from('avatars').remove(existing.map((f: any) => `groups/${groupId}/${f.name}`));
  }

  const { error: uploadError } = await db.storage
    .from('avatars').upload(path, file, { contentType: file.type });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { data: { publicUrl } } = db.storage.from('avatars').getPublicUrl(path);
  const { error: updateError } = await db.from('groups')
    .update({ avatar_url: publicUrl }).eq('id', groupId);
  if (updateError) return json({ error: updateError.message }, 500);

  return json({ url: publicUrl + '?t=' + Date.now() });
};

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
