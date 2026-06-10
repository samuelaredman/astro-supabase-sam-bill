export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAuth, json } from '../../../utils/api';

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const allowed = ['bio', 'favorite_game_id', 'showcase_games'];
  const update: Record<string, any> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  if (Object.keys(update).length === 0)
    return json({ error: 'Nothing to update.' }, 400);

  const { error: updateError } = await (db as any)
    .from('profiles')
    .update(update)
    .eq('id', profile.id);

  if (updateError) {
    console.error('[profile/update] error:', JSON.stringify(updateError));
    return json({ error: updateError.message }, 500);
  }

  return json({ ok: true });
};
