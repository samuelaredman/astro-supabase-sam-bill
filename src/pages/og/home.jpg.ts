import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../utils/database";
import { igdbImage } from "../../utils/format";
import { GAME_CATEGORY_OR_FILTER } from "../../utils/games";
import { renderOgImage, fetchImageDataUri } from "../../utils/og";
import { buildHomeOgTree } from "../../utils/ogHome";

export const prerender = false;

const IMAGE_FETCH_TIMEOUT_MS = 4000;

export const GET: APIRoute = async () => {
  const db = getSupabaseAdmin() as any;

  const [{ data: recentReviews }, { count: reviewCount }, { count: gameCount }, { count: profileCount }] =
    await Promise.all([
      db.from("reviews")
        .select("games ( cover_img_url )")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(60),
      db.from("reviews").select("*", { count: "exact", head: true }).eq("status", "published"),
      db.from("games").select("*", { count: "exact", head: true }).or(GAME_CATEGORY_OR_FILTER),
      db.from("profiles").select("*", { count: "exact", head: true }),
    ]);

  // Dedupe covers from the most recent reviews so the grid isn't dominated by
  // one popular game with several reviews in a row.
  const seen = new Set<string>();
  const rawCoverUrls: string[] = [];
  for (const row of (recentReviews ?? []) as any[]) {
    const raw = row.games?.cover_img_url;
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      rawCoverUrls.push(raw);
    }
    if (rawCoverUrls.length >= 12) break;
  }

  // Same size tiering as the list OG card: only ask IGDB for full 1080p
  // covers when there are few enough to render at near-full-cell size (1-4,
  // one full-height row). The homepage grid almost always fills out to 8-12
  // covers, whose cells are a few hundred px wide at most — t_1080p there
  // was fetching/embedding images several times larger than the cell needs,
  // which was the dominant cost in generating this card.
  const coverSize = rawCoverUrls.length <= 4 ? "t_1080p" : "t_cover_big";
  const coverUrls = rawCoverUrls.map((u) => igdbImage(u, coverSize) ?? u);

  const coverDataUris = (
    await Promise.all(coverUrls.map((u) => fetchImageDataUri(u, IMAGE_FETCH_TIMEOUT_MS)))
  ).filter((u): u is string => !!u);

  const tree = buildHomeOgTree({
    reviewCount: reviewCount ?? 0,
    gameCount: gameCount ?? 0,
    profileCount: profileCount ?? 0,
    coverDataUris,
  });

  const image = await renderOgImage(tree, 1200, 630);

  return new Response(new Uint8Array(image), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      // Link-preview compose UIs (Reddit's included) may load this image
      // client-side in the sharer's own browser — e.g. to run an image-safety
      // check via canvas before accepting it into the post — which needs CORS
      // to read pixel data cross-origin. Without this header that read throws,
      // and the safest failure mode for those UIs is to silently drop the
      // thumbnail rather than show an unscanned image, which looks exactly
      // like "the preview flashed and then disappeared."
      "Access-Control-Allow-Origin": "*",
      // Homepage content (stat counts, recent covers) moves much more slowly
      // than a single profile/review, so cache far longer than those cards.
      "Cache-Control": "public, max-age=1800",
      "Netlify-CDN-Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
};
