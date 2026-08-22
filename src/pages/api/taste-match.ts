export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAuth, json } from '../../utils/api';
import { getTasteMatch } from '../../utils/tasteMatch';

export const GET: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const targetId = context.url.searchParams.get('with');
  if (!targetId) return json({ error: 'Missing "with" profile id.' }, 400);
  if (targetId === profile.id) return json({ error: 'Cannot compare a profile with itself.' }, 400);

  const refresh = context.url.searchParams.get('refresh') === '1';

  try {
    const result = await getTasteMatch(db, profile.id, targetId, { refresh });
    return json(result);
  } catch (e) {
    console.error('[taste-match] compute error:', e);
    return json({ error: 'Could not compute taste match.' }, 500);
  }
};
