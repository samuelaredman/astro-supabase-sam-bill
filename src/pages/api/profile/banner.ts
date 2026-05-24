export const prerender = false;
import type { APIRoute } from 'astro';
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from '../../../utils/database';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Unauthorized', detail: authError?.message }, 401);

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: 'Invalid request body' }, 400);
  }

  const file = form.get('banner') as File;
  if (!file) return json({ error: 'No file provided' }, 400);
  if (file.size > 15 * 1024 * 1024) return json({ error: 'File must be under 15MB' }, 400);

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(file.type)) return json({ error: 'Only JPEG, PNG, WebP, or GIF allowed' }, 400);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: 'Profile not found' }, 404);

  const { data: existing } = await db.storage.from('banners').list(user.id);
  if (existing?.length) {
    await db.storage.from('banners').remove(existing.map((f: any) => `${user.id}/${f.name}`));
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
  const path = `${user.id}/banner.${ext}`;

  const { error: uploadError } = await db.storage
    .from('banners').upload(path, file, { contentType: file.type, upsert: true });
  if (uploadError) {
    console.error('[profile/banner] upload error:', JSON.stringify(uploadError));
    return json({ error: uploadError.message }, 500);
  }

  const { data: { publicUrl } } = db.storage.from('banners').getPublicUrl(path);
  const bannerPosition = (form.get('banner_position') as string) || 'center';

  const { error: updateError } = await db
    .from('profiles')
    .update({ banner_url: publicUrl, banner_position: bannerPosition })
    .eq('id', profile.id);

  if (updateError) {
    console.error('[profile/banner] update error:', JSON.stringify(updateError));
    return json({ error: updateError.message }, 500);
  }

  return json({ url: publicUrl + '?t=' + Date.now() });
};
