export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAuth, json } from '../../../utils/api';
import { validateSocialUrl } from '../../../utils/socialLinks';
import { parseYouTubeId } from '../../../utils/youtube';
import { readHiddenShowcases } from '../../../utils/profileShowcases';

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const urlFields = [
    'twitch_url', 'youtube_url', 'twitter_url', 'discord_url',
    'steam_url', 'psn_url', 'xbox_url', 'instagram_url', 'tiktok_url', 'bluesky_url',
    'retroachievements_url',
  ];
  const allowed = ['bio', 'favorite_game_id', 'showcase_games', 'showcase_achievements', ...urlFields, 'accent_color'];
  const update: Record<string, any> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  // Video showcase: mode is 'latest' | 'featured' | null (off). A featured
  // video arrives as a pasted link and is stored as its 11-char id.
  if ('showcase_video_mode' in body) {
    const mode = body.showcase_video_mode || null;
    if (mode !== null && mode !== 'latest' && mode !== 'featured')
      return json({ error: 'Invalid video showcase option.' }, 400);
    if (mode === 'featured') {
      const id = parseYouTubeId(typeof body.showcase_video_url === 'string' ? body.showcase_video_url : '');
      if (!id) return json({ error: "That doesn't look like a YouTube video link." }, 400);
      update.showcase_video_id = id;
    }
    if (mode === 'latest') {
      const { data: row } = await db.from('profiles').select('youtube_url').eq('id', profile.id).maybeSingle();
      const youtubeUrl = 'youtube_url' in update ? update.youtube_url : row?.youtube_url;
      if (!youtubeUrl) return json({ error: 'Add your YouTube channel to your profile links first.' }, 400);
    }
    update.showcase_video_mode = mode;
  }

  if ('hidden_showcases' in body) {
    const hidden = readHiddenShowcases(body.hidden_showcases);
    if (!hidden) return json({ error: 'Invalid showcase list.' }, 400);
    update.hidden_showcases = hidden;
  }

  if (Object.keys(update).length === 0)
    return json({ error: 'Nothing to update.' }, 400);

  for (const key of urlFields) {
    if (!(key in update)) continue;
    const value = typeof update[key] === 'string' ? update[key].trim() : update[key];
    if (!value) { update[key] = null; continue; }
    if (typeof value !== 'string' || value.length > 300) {
      return json({ error: `Invalid ${key.replace('_url', '')} link.` }, 400);
    }
    const check = validateSocialUrl(key, value);
    if (!check.ok) return json({ error: check.error }, 400);
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
