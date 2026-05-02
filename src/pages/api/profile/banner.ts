export const prerender = false;
import type { APIRoute } from 'astro';
import { createSupabaseServerClientFromContext } from '../../../utils/database';

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized', detail: authError?.message }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  const form = await context.request.formData();
  const file = form.get('banner') as File;
  if (!file) {
    return new Response(JSON.stringify({ error: 'No file provided' }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }

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

  // Delete any existing banner files for this user (all extensions)
  // so we don't end up with stale jpg when uploading png etc.
  const { data: existing } = await supabase.storage
    .from('banners')
    .list(user.id);

  if (existing && existing.length > 0) {
    const paths = existing.map((f: any) => `${user.id}/${f.name}`);
    await supabase.storage.from('banners').remove(paths);
  }

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${user.id}/banner.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('banners')
    .upload(path, file, { contentType: file.type });

  if (uploadError) {
    return new Response(JSON.stringify({ error: uploadError.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const { data: { publicUrl } } = supabase.storage.from('banners').getPublicUrl(path);

  const { data, error: updateError } = await (supabase as any)
    .from('profiles')
    .update({ banner_url: publicUrl })
    .eq('auth_user_id', user.id)
    .select('id');

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!data || data.length === 0) {
    return new Response(JSON.stringify({ error: 'No profile found', userId: user.id }), {
      status: 404, headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ url: publicUrl + '?t=' + Date.now() }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
};
