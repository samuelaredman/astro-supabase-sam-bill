// Newest upload on a YouTube channel + channel metadata (name, bio, subscriber
// count, avatar), for the profile video showcase and the home-page Chekpoint
// Creators strip.
//
// Data API path (requires YOUTUBE_API_KEY, ~3 quota units/creator): one
// channels.list call pulls snippet + statistics + uploads playlist id, one
// playlistItems.list gets the newest video, one videos.list fills in view
// count + duration.
//
// Fallback scrape path (no key): reads the channel's /videos tab. Only yields
// the latest video's id and title — channel info and video stats stay null.
// (RSS would be simpler but YouTube now serves 404s on it.)

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TIMEOUT_MS = 5000;

export interface LatestUpload {
  id: string;
  title: string | null;
  description: string | null;
  publishedAt: string | null;      // ISO 8601
  viewCount: number | null;
  durationSeconds: number | null;
}

export interface ChannelInfo {
  name: string | null;
  handle: string | null;           // includes leading @
  bio: string | null;
  avatarUrl: string | null;
  subscriberCount: number | null;
}

export interface CreatorContent {
  video: LatestUpload | null;
  channel: ChannelInfo | null;
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
  return { id, title, description: null, publishedAt: null, viewCount: null, durationSeconds: null };
}

// PT1H2M3S → 3723. Returns null on anything that doesn't parse.
export function parseIsoDuration(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const h = parseInt(m[1] ?? '0', 10);
  const mn = parseInt(m[2] ?? '0', 10);
  const s = parseInt(m[3] ?? '0', 10);
  return h * 3600 + mn * 60 + s;
}

async function fromDataApi(channel: NonNullable<ReturnType<typeof parseChannelUrl>>, key: string): Promise<CreatorContent> {
  const k = encodeURIComponent(key);
  const filter =
    channel.kind === 'handle' ? `forHandle=${encodeURIComponent('@' + channel.value)}`
    : channel.kind === 'channel' ? `id=${encodeURIComponent(channel.value)}`
    : channel.kind === 'user' ? `forUsername=${encodeURIComponent(channel.value)}`
    : null; // legacy /c/ names have no API lookup
  if (!filter) return { video: null, channel: null };

  // One channels.list for everything we need about the channel.
  const chRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=contentDetails,snippet,statistics&${filter}&key=${k}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!chRes.ok) {
    console.error('[youtubeChannel] channels.list error:', chRes.status, await chRes.text().catch(() => ''));
    return { video: null, channel: null };
  }
  const chItem = (await chRes.json())?.items?.[0];
  const uploads = chItem?.contentDetails?.relatedPlaylists?.uploads;

  const avatarRaw = chItem?.snippet?.thumbnails?.medium?.url
    ?? chItem?.snippet?.thumbnails?.high?.url
    ?? chItem?.snippet?.thumbnails?.default?.url
    ?? null;
  const customUrl = typeof chItem?.snippet?.customUrl === 'string' ? chItem.snippet.customUrl : null;
  const channelInfo: ChannelInfo = {
    name: chItem?.snippet?.title ?? null,
    handle: customUrl ? (customUrl.startsWith('@') ? customUrl : '@' + customUrl) : null,
    bio: typeof chItem?.snippet?.description === 'string' ? chItem.snippet.description : null,
    avatarUrl: avatarRaw,
    subscriberCount: chItem?.statistics?.subscriberCount != null && !chItem.statistics.hiddenSubscriberCount
      ? Number(chItem.statistics.subscriberCount)
      : null,
  };

  if (!uploads) return { video: null, channel: channelInfo };

  // YouTube maintains parallel "all uploads" and "long-form only" playlists
  // for every channel. Normal uploads = UU<...>, long-form only = UULF<...>,
  // Shorts only = UUSH<...>. Swap the prefix so Shorts don't surface as the
  // "latest video" in our strip — a creator who posts a Short every day
  // between full videos would otherwise show the Short.
  const longFormPlaylist = uploads.replace(/^UU/, 'UULF');

  async function fetchFirstVideo(playlistId: string) {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=1&playlistId=${encodeURIComponent(playlistId)}&key=${k}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return null;
    return (await r.json())?.items?.[0]?.snippet ?? null;
  }

  // Try long-form first; fall back to any upload if the creator has none
  // (new channels, Shorts-only channels, etc.).
  let snippet = longFormPlaylist !== uploads ? await fetchFirstVideo(longFormPlaylist).catch(() => null) : null;
  if (!snippet) snippet = await fetchFirstVideo(uploads).catch(() => null);
  const vid = snippet?.resourceId?.videoId;
  if (!vid || !VIDEO_ID.test(vid)) return { video: null, channel: channelInfo };

  // Fill in view count + duration via videos.list. If this errors, we still
  // return what we have from the playlistItems snippet.
  let viewCount: number | null = null;
  let durationSeconds: number | null = null;
  try {
    const vRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${encodeURIComponent(vid)}&key=${k}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (vRes.ok) {
      const v = (await vRes.json())?.items?.[0];
      if (v?.statistics?.viewCount != null) viewCount = Number(v.statistics.viewCount);
      durationSeconds = parseIsoDuration(v?.contentDetails?.duration);
    }
  } catch (e) {
    console.error('[youtubeChannel] videos.list error:', e);
  }

  const video: LatestUpload = {
    id: vid,
    title: snippet?.title ?? null,
    description: typeof snippet?.description === 'string' ? snippet.description : null,
    publishedAt: typeof snippet?.publishedAt === 'string' ? snippet.publishedAt : null,
    viewCount,
    durationSeconds,
  };
  return { video, channel: channelInfo };
}

async function fromVideosPage(channelUrl: string): Promise<LatestUpload | null> {
  const res = await fetch(channelUrl.replace(/\/$/, '') + '/videos?hl=en', {
    headers: { 'Accept-Language': 'en-US,en;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; ChekpointBot/1.0; +https://chekpoint.gg)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return parseLatestFromVideosPage(await res.text());
}

/** Combined channel + latest-upload bundle. API path when key is set, scrape
 *  fallback fills in just the video. Returns `{ video: null, channel: null }`
 *  when nothing could be fetched. */
export async function fetchCreatorContent(channelUrl: string | null | undefined, apiKey?: string): Promise<CreatorContent> {
  const channel = parseChannelUrl(channelUrl);
  if (!channel || !channelUrl) return { video: null, channel: null };
  if (apiKey) {
    const viaApi = await fromDataApi(channel, apiKey).catch((e) => { console.error('[youtubeChannel] data api error:', e); return { video: null, channel: null } as CreatorContent; });
    if (viaApi.video || viaApi.channel) return viaApi;
  }
  const video = await fromVideosPage(channelUrl.trim()).catch((e) => { console.error('[youtubeChannel] videos page error:', e); return null; });
  return { video, channel: null };
}

/** Newest upload only — kept for the profile video showcase that doesn't
 *  need channel info. Thin wrapper over fetchCreatorContent. */
export async function fetchLatestUpload(channelUrl: string | null | undefined, apiKey?: string): Promise<LatestUpload | null> {
  const { video } = await fetchCreatorContent(channelUrl, apiKey);
  return video;
}
