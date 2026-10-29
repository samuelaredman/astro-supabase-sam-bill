export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAuth, json } from '../../../utils/api';
import { validateSocialUrl } from '../../../utils/socialLinks';
import { parseYouTubeId } from '../../../utils/youtube';
import { readShowcaseKeys } from '../../../utils/profileShowcases';
import { resolveCanonicalGameId } from '../../../utils/games';

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
    const hidden = readShowcaseKeys(body.hidden_showcases);
    if (!hidden) return json({ error: 'Invalid showcase list.' }, 400);
    update.hidden_showcases = hidden;
  }

  if ('showcase_order' in body) {
    const order = readShowcaseKeys(body.showcase_order);
    if (!order) return json({ error: 'Invalid showcase order.' }, 400);
    update.showcase_order = order;
  }

  if (Object.keys(update).length === 0)
    return json({ error: 'Nothing to update.' }, 400);

  // Pin any game-referencing field to the canonical row. The showcase/favorite
  // picker UI already filters to canonical rows, but a stale open tab could
  // still submit an edition id — write the canonical so profile reads align
  // with /games/[slug] (which 301s editions to canonical) and so the
  // "showcase" of a GOTY and the user's canonical review of the same game
  // don't appear to be on two different "games".
  if ('favorite_game_id' in update && typeof update.favorite_game_id === 'string') {
    update.favorite_game_id = await resolveCanonicalGameId(db, update.favorite_game_id);
  }
  // showcase_games must be an array of game-id strings. A past client-side bug
  // posted a mix of strings and {id, title, ...} objects, which the old
  // "filter to strings" path silently dropped — slowly wiping the showcase
  // after a few edits. Reject the whole write loudly instead so the client
  // sees a clear error and no partial data corruption lands.
  if ('showcase_games' in update) {
    if (!Array.isArray(update.showcase_games)) {
      return json({ error: 'showcase_games must be an array of game IDs.' }, 400);
    }
    const items = update.showcase_games as unknown[];
    if (!items.every((v) => typeof v === 'string')) {
      return json({ error: 'showcase_games must contain only game ID strings.' }, 400);
    }
    const resolved = await Promise.all((items as string[]).map((id) => resolveCanonicalGameId(db, id)));
    update.showcase_games = [...new Set(resolved)];
  }

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
