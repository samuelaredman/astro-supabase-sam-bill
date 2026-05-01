import { createSupabaseServerClientFromContext } from '../../../utils/database'
export const prerender = false
export async function POST({ request, ...Astro }: any) {
  const supabase = createSupabaseServerClientFromContext({ request, ...Astro })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const form = await request.formData()
  const file = form.get('avatar') as File
  if (!file) return new Response('No file', { status: 400 })
  const ext = file.name.split('.').pop()
  const path = `${user.id}/avatar.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
  if (error) return new Response(error.message, { status: 500 })
  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
  const { data: profile } = await supabase.from('profiles').select('id').eq('auth_user_id', user.id).single()
  await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', profile.id)
  return new Response(JSON.stringify({ url: publicUrl }), { status: 200 })
}
