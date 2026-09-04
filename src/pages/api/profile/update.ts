export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAuth, json } from '../../../utils/api';

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const urlFields = ['twitch_url', 'youtube_url', 'twitter_url', 'discord_url', 'website_url'];
  const allowed = ['bio', 'favorite_game_id', 'showcase_games', 'showcase_achievements', ...urlFields, 'accent_color'];
  const update: Record<string, any> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  if (Object.keys(update).length === 0)
    return json({ error: 'Nothing to update.' }, 400);

  for (const key of urlFields) {
    if (!(key in update)) continue;
    const value = typeof update[key] === 'string' ? update[key].trim() : update[key];
    if (!value) { update[key] = null; continue; }
    if (typeof value !== 'string' || value.length > 300 || !/^https?:\/\/.+/i.test(value)) {
      return json({ error: `Invalid ${key.replace('_url', '')} link — must be a full http(s) URL.` }, 400);
    }
    update[key] = value;
  }

  if ('accent_color' in update) {
    const value = typeof update.accent_color === 'string' ? update.accent_color.trim() : update.accent_color;
    if (!value) { update.accent_color = null; }
    else if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
      return json({ error: 'Invalid accent color.' }, 400);
    } else {
      update.accent_color = value;
    }
  }

  const { error: updateError } = await db
    .from('profiles')
    .update(update)
    .eq('id', profile.id);

  if (updateError) {
    console.error('[profile/update] error:', JSON.stringify(updateError));
    return json({ error: updateError.message }, 500);
  }

  return json({ ok: true });
};
