// Newest upload on a YouTube channel, for the profile video showcase.
//
// With YOUTUBE_API_KEY set it uses the Data API (channels.list → the channel's
// uploads playlist → playlistItems.list, 2 quota units). Without a key, or if
// the API fails, it reads the channel's public /videos tab, which lists uploads
// newest first. (The channel RSS feed would be simpler but returns 404s.)

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TIMEOUT_MS = 5000;

export interface LatestUpload {
  id: string;
  title: string | null;
}

/** The channel part of a validated profile YouTube link: { kind, value }. */
export function parseChannelUrl(url: string | null | undefined): { kind: 'handle' | 'channel' | 'c' | 'user'; value: string } | null {
  const m = (url ?? '').trim().match(/^https:\/\/(?:www\.)?youtube\.com\/(@|channel\/|c\/|user\/)([^/?#]+)\/?$/i);
  if (!m) return null;
  const kind = m[1] === '@' ? 'handle' : (m[1].replace('/', '').toLowerCase() as 'channel' | 'c' | 'user');
  return { kind, value: decodeURIComponent(m[2]) };
}

/** First video on a channel's /videos tab. Returns null if the layout isn't recognised. */
export function parseLatestFromVideosPage(html: string): LatestUpload | null {
  const start = html.search(/"richItemRenderer":\{"content":\{"lockupViewModel":\{/);
  if (start === -1) return null;
  // Each lockup is ~12 KB; the next item's start bounds this one.
  const rest = html.slice(start + 1);
  const next = rest.search(/"richItemRenderer":\{/);
  const item = next === -1 ? rest.slice(0, 20000) : rest.slice(0, next);

  const id = item.match(/"contentId":"([A-Za-z0-9_-]{11})"/)?.[1] ?? item.match(/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\//)?.[1];
  if (!id || !VIDEO_ID.test(id)) return null;
  let title: string | null = null;
  const raw = item.match(/"title":\{"content":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (raw) {
    try { title = JSON.parse(`"${raw}"`); } catch { title = null; }
  }
  return { id, title };
}

async function fromDataApi(channel: NonNullable<ReturnType<typeof parseChannelUrl>>, key: string): Promise<LatestUpload | null> {
  const k = encodeURIComponent(key);
  const filter =
    channel.kind === 'handle' ? `forHandle=${encodeURIComponent('@' + channel.value)}`
    : channel.kind === 'channel' ? `id=${encodeURIComponent(channel.value)}`
    : channel.kind === 'user' ? `forUsername=${encodeURIComponent(channel.value)}`
    : null; // legacy /c/ names have no API lookup
  if (!filter) return null;

  const chRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails&${filter}&key=${k}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!chRes.ok) {
    console.error('[youtubeChannel] channels.list error:', chRes.status, await chRes.text().catch(() => ''));
    return null;
  }
  const uploads = (await chRes.json())?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return null;

  const plRes = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=1&playlistId=${encodeURIComponent(uploads)}&key=${k}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!plRes.ok) {
    console.error('[youtubeChannel] playlistItems.list error:', plRes.status, await plRes.text().catch(() => ''));
    return null;
  }
  const snippet = (await plRes.json())?.items?.[0]?.snippet;
  const id = snippet?.resourceId?.videoId;
  return id && VIDEO_ID.test(id) ? { id, title: snippet?.title ?? null } : null;
}

async function fromVideosPage(channelUrl: string): Promise<LatestUpload | null> {
  const res = await fetch(channelUrl.replace(/\/$/, '') + '/videos?hl=en', {
    headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; ChekpointBot/1.0; +https://chekpoint.gg)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return parseLatestFromVideosPage(await res.text());
}

/** Newest upload for a profile's YouTube link, or null (no link, no uploads, YouTube unreachable). */
export async function fetchLatestUpload(channelUrl: string | null | undefined, apiKey?: string): Promise<LatestUpload | null> {
  const channel = parseChannelUrl(channelUrl);
  if (!channel || !channelUrl) return null;
  if (apiKey) {
    const viaApi = await fromDataApi(channel, apiKey).catch((e) => { console.error('[youtubeChannel] data api error:', e); return null; });
    if (viaApi) return viaApi;
  }
  return fromVideosPage(channelUrl.trim()).catch((e) => { console.error('[youtubeChannel] videos page error:', e); return null; });
}
