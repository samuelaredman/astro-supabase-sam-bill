// YouTube links attached to reviews. Only the 11-character video id is stored;
// embed and thumbnail URLs are always rebuilt from it, never from user input.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be',
]);

/**
 * Extracts the video id from a YouTube link: watch?v=, youtu.be/, shorts/, embed/, live/, v/.
 * A bare 11-character id is accepted too. Returns null for anything else.
 */
export function parseYouTubeId(input: string | null | undefined): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  if (VIDEO_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  let id: string | null = null;
  if (url.hostname.toLowerCase() === 'youtu.be') {
    id = url.pathname.split('/')[1] ?? null;
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v');
  } else {
    const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
    id = m?.[1] ?? null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Result of reading the optional `youtube_url` field from a review request body. */
export type YouTubeField =
  | { present: false }
  | { present: true; id: string | null }
  | { present: true; error: string };

/**
 * Reads `youtube_url` from a request body. Absent key → leave the column alone
 * (older clients don't send it); empty string/null → clear it; otherwise it must parse.
 */
export function readYouTubeField(body: Record<string, unknown>): YouTubeField {
  if (!('youtube_url' in body)) return { present: false };
  const value = body.youtube_url;
  if (value == null || (typeof value === 'string' && !value.trim())) return { present: true, id: null };
  if (typeof value !== 'string') return { present: true, error: 'Invalid YouTube link.' };
  const id = parseYouTubeId(value);
  return id ? { present: true, id } : { present: true, error: "That doesn't look like a YouTube video link." };
}

/** ISO 8601 duration from the Data API ("PT1H2M3S") → "1:02:03" / "4:05". */
export function formatYouTubeDuration(iso: string | null | undefined): string | null {
  const m = (iso ?? '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m || iso === 'P0D') return null;
  const [d, h, min, s] = m.slice(1).map((v) => parseInt(v ?? '0', 10));
  const hours = d * 24 + h;
  if (hours + min + s === 0) return null; // live streams report P0D / PT0S
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

/** "1234567" → "1.2M views". */
export function formatViewCount(raw: string | number | null | undefined): string | null {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : raw ?? NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  const fmt = (v: number, unit: string) => `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10}${unit}`;
  const label = n >= 1e9 ? fmt(n / 1e9, 'B') : n >= 1e6 ? fmt(n / 1e6, 'M') : n >= 1e3 ? fmt(n / 1e3, 'K') : String(n);
  return `${label} ${n === 1 ? 'view' : 'views'}`;
}

export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function youTubeThumbUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

export function youTubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
}
