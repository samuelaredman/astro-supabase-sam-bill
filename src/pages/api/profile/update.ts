import { createSupabaseServerClientFromContext } from '../../../utils/database'
export const prerender = false
export async function POST({ request, ...Astro }: any) {
  const supabase = createSupabaseServerClientFromContext({ request, ...Astro })
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const body = await request.json()
  const allowed = ['bio', 'favorite_game_id']
  const update: any = {}
  for (const key of allowed) if (key in body) update[key] = body[key]
  const { data: profile } = await supabase.from('profiles').select('id').eq('auth_user_id', user.id).single()
  if (!profile) return new Response('Not found', { status: 404 })
  await supabase.from('profiles').update(update).eq('id', profile.id)
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}
