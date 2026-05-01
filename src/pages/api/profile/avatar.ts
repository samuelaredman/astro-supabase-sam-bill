export const prerender = false;
import { createSupabaseServerClientFromContext } from '../../../utils/database';

export async function POST(context: any) {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const form = await context.request.formData();
  const file = form.get('avatar') as File;
  if (!file) return new Response('No file', { status: 400 });

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${user.id}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return new Response(uploadError.message, { status: 500 });

  const { data: { publicUrl } } = supabase.storage
    .from('avatars')
    .getPublicUrl(path);

  const { data: profile, error: profileError } = await (supabase as any)
    .from('profiles')
    .select('id')
    .eq('auth_user_id', user.id)
    .single();

  if (profileError || !profile) {
    return new Response('Profile not found', { status: 404 });
  }

  const { error: updateError } = await (supabase as any)
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', profile.id);

  if (updateError) return new Response(updateError.message, { status: 500 });

  return new Response(JSON.stringify({ url: publicUrl }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
