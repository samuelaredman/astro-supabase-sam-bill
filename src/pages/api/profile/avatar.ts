export const prerender = false;
import type { APIRoute } from 'astro';
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from '../../../utils/database';
import { json } from '../../../utils/api';
import { classifyImageUrl } from '../../../utils/moderation/openaiModeration';

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const form = await context.request.formData();
  const file = form.get('avatar') as File;
  if (!file) return json({ error: 'No file provided.' }, 400);

  if (file.size > 5 * 1024 * 1024)
    return json({ error: 'File must be under 5MB.' }, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`;
  const moderation = await classifyImageUrl(dataUrl);
  if (moderation.flagged) return json({ error: "This image isn't allowed." }, 400);

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${user.id}/avatar.${ext}`;

  // Use admin client for storage and DB writes
  const db = getSupabaseAdmin();

  const { error: uploadError } = await db.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) {
    console.error('[profile/avatar] upload error:', JSON.stringify(uploadError));
    return json({ error: uploadError.message }, 500);
  }

  const { data: { publicUrl } } = db.storage.from('avatars').getPublicUrl(path);

  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();

  if (!profile) return json({ error: 'Profile not found.' }, 404);

  const { error: updateError } = await db
    .from('profiles').update({ avatar_url: publicUrl }).eq('id', profile.id);

  if (updateError) {
    console.error('[profile/avatar] update error:', JSON.stringify(updateError));
    return json({ error: updateError.message }, 500);
  }

  return json({ url: publicUrl + '?t=' + Date.now() });
};
