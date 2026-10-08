export const prerender = false;
import type { APIRoute } from 'astro';
import { json } from '../../../utils/api';
import { cdnCacheHeaders } from '../../../utils/cache';
import { getSupabaseAdmin } from '../../../utils/database';
import { groupOwnerYouTube } from '../../../utils/groupShowcases';
import { fetchLatestUpload } from '../../../utils/youtubeChannel';

// Newest upload on the group owner's YouTube channel, for a group Overview's
// "latest video" showcase — the group counterpart of /api/profile/latest-video.
// Public and CDN-cached per group for an hour. Keyed by group id (not a channel
// URL) so it can't be used as a general YouTube proxy, and only answers for a
// group whose video is set to 'latest'.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function apiKey(): string | undefined {
  return import.meta.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
}

function respond(body: unknown, status: number, maxAge: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cdnCacheHeaders(maxAge, maxAge * 24), 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const groupId = (url.searchParams.get('g') ?? '').trim();
  if (!UUID.test(groupId)) return json({ error: 'Missing group.' }, 400);

  const db = getSupabaseAdmin();
  const { data: group, error } = await db
    .from('groups')
    .select('showcase_video_mode')
    .eq('id', groupId)
    .maybeSingle();
  if (error) {
    console.error('[groups/latest-video] lookup error:', JSON.stringify(error));
    return json({ error: 'Lookup failed.' }, 500);
  }
  if (group?.showcase_video_mode !== 'latest') return respond({ video: null }, 200, 300);

  const owner = await groupOwnerYouTube(db, groupId);
  if (!owner?.youtubeUrl) return respond({ video: null }, 200, 300);

  const video = await fetchLatestUpload(owner.youtubeUrl, apiKey());
  // A miss is often a YouTube hiccup — cache it briefly so it can recover.
  return video ? respond({ video }, 200, 3600) : respond({ video: null }, 200, 600);
};
