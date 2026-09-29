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

export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function youTubeThumbUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

export function youTubeEmbedUrl(id: string): string {
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
}
