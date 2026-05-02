export const prerender = false;
import type { APIRoute } from 'astro';
import { getSupabase } from '../../../utils/database';

export const POST: APIRoute = async ({ request }) => {
  const supabase = getSupabase();

  // Get session from Authorization header sent by the client
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const token = authHeader.slice(7);

  // Verify the token and get the user
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await request.json();
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
};
