import type { APIRoute } from "astro";
import { json } from "../../../utils/api";
import { cdnCacheHeaders } from "../../../utils/cache";
import { formatYouTubeDuration, formatViewCount } from "../../../utils/youtube";

// Title / channel / description for a review's attached video, shown beside its
// thumbnail on review cards. Public and CDN-cached for a day per video id, so
// YouTube is hit roughly once per video per day however many cards render it.
//
// With YOUTUBE_API_KEY set (YouTube Data API v3, videos.list = 1 quota unit)
// it returns description, duration and views too. Without it, YouTube's keyless
// oEmbed endpoint still gives title + channel; the card just omits the rest.

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
}

async function fromDataApi(id: string, key: string): Promise<VideoMeta | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=${id}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("[youtube/meta] data api error:", res.status, await res.text().catch(() => ""));
    return null;
  }
  const item = (await res.json())?.items?.[0];
  if (!item) return null;
  const description = (item.snippet?.description ?? "").trim();
  return {
    title: item.snippet?.title ?? "",
    channel: item.snippet?.channelTitle ?? null,
    description: description ? description.slice(0, 300) : null,
    duration: formatYouTubeDuration(item.contentDetails?.duration),
    views: formatViewCount(item.statistics?.viewCount),
  };
}

async function fromOEmbed(id: string): Promise<VideoMeta | null> {
  const target = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
  const res = await fetch(`https://www.youtube.com/oembed?url=${target}&format=json`);
  if (!res.ok) return null;
  const data = await res.json();
  return { title: data.title ?? "", channel: data.author_name ?? null, description: null, duration: null, views: null };
}

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get("id") ?? "";
  if (!VIDEO_ID.test(id)) return json({ error: "Invalid video id." }, 400);

  let meta: VideoMeta | null = null;
  try {
    const key = apiKey();
    meta = (key ? await fromDataApi(id, key) : null) ?? await fromOEmbed(id);
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
