export const prerender = false;
import { createSupabaseServerClientFromContext } from '../../../utils/database';

export async function POST(context: any) {
  const supabase = createSupabaseServerClientFromContext(context);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const body = await context.request.json();

  // Only allow these fields to be updated
  const allowed = ['bio', 'favorite_game_id', 'showcase_games'];
  const update: Record<string, any> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  if (Object.keys(update).length === 0) {
    return new Response('Nothing to update', { status: 400 });
  }

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
    .update(update)
    .eq('id', profile.id);

  if (updateError) return new Response(updateError.message, { status: 500 });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  });
}
