export const prerender = false;
import type { APIRoute } from 'astro';
import { json } from '../../../utils/api';
import { cdnCacheHeaders } from '../../../utils/cache';
import { getSupabaseAdmin } from '../../../utils/database';
import { fetchLatestUpload } from '../../../utils/youtubeChannel';

// Newest upload on a profile's linked YouTube channel, for the "latest video"
// showcase. Public and CDN-cached per username for an hour, so YouTube is hit
// about once an hour per profile however many people view it. Keyed by
// username (not a channel URL) so it can't be used as a general YouTube proxy.

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
  const username = (url.searchParams.get('u') ?? '').trim();
  if (!username || username.length > 50) return json({ error: 'Missing username.' }, 400);

  const db = getSupabaseAdmin();
  const { data: profile, error } = await db
    .from('profiles')
    .select('youtube_url, showcase_video_mode')
    .eq('username', username)
    .maybeSingle();
  if (error) {
    console.error('[profile/latest-video] lookup error:', JSON.stringify(error));
    return json({ error: 'Lookup failed.' }, 500);
  }
  if (!profile?.youtube_url || profile.showcase_video_mode !== 'latest') {
    return respond({ video: null }, 200, 300);
  }

  const video = await fetchLatestUpload(profile.youtube_url, apiKey());
  // A miss is often a YouTube hiccup — cache it briefly so it can recover.
  return video ? respond({ video }, 200, 3600) : respond({ video: null }, 200, 600);
};
