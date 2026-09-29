import type { APIRoute } from "astro";
import { json } from "../../../utils/api";
import { cdnCacheHeaders } from "../../../utils/cache";
import { formatYouTubeDuration, formatViewCount, parseWatchPage, cleanDescription } from "../../../utils/youtube";

// Title / channel / description for a review's attached video, shown beside its
// thumbnail on review cards. Public and CDN-cached for a day per video id, so
// YouTube is hit roughly once per video per day however many cards render it.
//
// With YOUTUBE_API_KEY set it uses the YouTube Data API v3 (videos.list = 1
// quota unit). Without a key it combines YouTube's keyless oEmbed endpoint
// (title, channel — stable) with the watch page's public metadata (description,
// upload date, duration, views, category). If the watch page can't be read, the
// card still gets title + channel and simply omits the rest.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function apiKey(): string | undefined {
  return import.meta.env.YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY;
}

interface VideoMeta {
  title: string;
  channel: string | null;
  description: string | null;
  duration: string | null;
  views: string | null;
  /** ISO timestamp of when the video was published. */
  published: string | null;
  /** YouTube category, e.g. "Gaming". */
  category: string | null;
}

const EMPTY: Omit<VideoMeta, "title"> = {
  channel: null, description: null, duration: null, views: null, published: null, category: null,
};
const TIMEOUT_MS = 5000;

async function fromDataApi(id: string, key: string): Promise<VideoMeta | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${id}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    console.error("[youtube/meta] data api error:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const item = (await res.json())?.items?.[0];
  if (!item) return null;
  return {
    title: item.snippet?.title ?? "",
    channel: item.snippet?.channelTitle ?? null,
    description: cleanDescription(item.snippet?.description),
    duration: formatYouTubeDuration(item.contentDetails?.duration),
    views: formatViewCount(item.statistics?.viewCount),
    published: item.snippet?.publishedAt ?? null,
    category: null, // snippet only has a numeric categoryId; not worth a second call
  };
}

async function fromOEmbed(id: string): Promise<VideoMeta | null> {
  const target = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
  const res = await fetch(`https://www.youtube.com/oembed?url=${target}&format=json`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const data = await res.json();
  return { ...EMPTY, title: data.title ?? "", channel: data.author_name ?? null };
}

/** Public metadata from the watch page — the fields oEmbed doesn't provide. */
async function fromWatchPage(id: string) {
  const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    headers: { "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 (compatible; ChekpointBot/1.0; +https://chekpoint.gg)" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  return parseWatchPage(await res.text());
}

async function keyless(id: string): Promise<VideoMeta | null> {
  const [oembed, page] = await Promise.all([
    fromOEmbed(id).catch((e) => { console.error("[youtube/meta] oembed error:", e); return null; }),
    fromWatchPage(id).catch((e) => { console.error("[youtube/meta] watch page error:", e); return null; }),
  ]);
  if (!oembed) return null; // private / removed / not embeddable
  return { ...oembed, ...(page ?? {}) };
}

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get("id") ?? "";
  if (!VIDEO_ID.test(id)) return json({ error: "Invalid video id." }, 400);

  let meta: VideoMeta | null = null;
  try {
    const key = apiKey();
    meta = (key ? await fromDataApi(id, key) : null) ?? await keyless(id);
  } catch (e) {
    console.error("[youtube/meta] fetch error:", e);
  }

  if (!meta?.title) {
    // Private/removed video or YouTube hiccup: cache briefly so it can recover.
    return new Response(JSON.stringify({ error: "Video not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...cdnCacheHeaders(600, 600), "Cache-Control": "no-store" },
    });
  }

  return new Response(JSON.stringify(meta), {
    status: 200,
    headers: { "Content-Type": "application/json", ...cdnCacheHeaders(86400, 604800), "Cache-Control": "no-store" },
  });
};
