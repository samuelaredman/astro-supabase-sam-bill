import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { igdbImage } from "../../../utils/format";
import { GAME_CATEGORY_OR_FILTER } from "../../../utils/games";
import { renderOgPng, fetchImageDataUri } from "../../../utils/og";
import { buildHomeOgTree } from "../../../utils/ogHome";

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
  const coverUrls: string[] = [];
  for (const row of (recentReviews ?? []) as any[]) {
    const raw = row.games?.cover_img_url;
    if (raw && !seen.has(raw)) {
      seen.add(raw);
      coverUrls.push(igdbImage(raw, "t_1080p") ?? raw);
    }
    if (coverUrls.length >= 12) break;
  }

  const coverDataUris = (
    await Promise.all(coverUrls.map((u) => fetchImageDataUri(u, IMAGE_FETCH_TIMEOUT_MS)))
  ).filter((u): u is string => !!u);

  const tree = buildHomeOgTree({
    reviewCount: reviewCount ?? 0,
    gameCount: gameCount ?? 0,
    profileCount: profileCount ?? 0,
    coverDataUris,
  });

  const png = await renderOgPng(tree, 1200, 630);

  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      // Homepage content (stat counts, recent covers) moves much more slowly
      // than a single profile/review, so cache far longer than those cards.
      "Cache-Control": "public, max-age=1800",
      "Netlify-CDN-Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
};
