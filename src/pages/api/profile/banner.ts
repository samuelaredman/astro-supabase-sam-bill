export const prerender = false;
import type { APIRoute } from 'astro';
import { getSupabase } from '../../../utils/database';

export const POST: APIRoute = async ({ request }) => {
  const supabase = getSupabase();

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const token = authHeader.slice(7);

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const form = await request.formData();
  const file = form.get('banner') as File;
  if (!file) return new Response('No file', { status: 400 });

  if (file.size > 6 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'File must be under 6MB' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.type)) {
    return new Response(JSON.stringify({ error: 'Only JPEG, PNG, or WebP allowed' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${user.id}/banner.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('banners')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return new Response(uploadError.message, { status: 500 });

  const { data: { publicUrl } } = supabase.storage.from('banners').getPublicUrl(path);

  const { data: profile, error: profileError } = await (supabase as any)
    .from('profiles').select('id').eq('auth_user_id', user.id).single();

  if (profileError || !profile) return new Response('Profile not found', { status: 404 });

  const { error: updateError } = await (supabase as any)
    .from('profiles').update({ banner_url: publicUrl }).eq('id', profile.id);

  if (updateError) return new Response(updateError.message, { status: 500 });

  return new Response(JSON.stringify({ url: publicUrl + '?t=' + Date.now() }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
};
