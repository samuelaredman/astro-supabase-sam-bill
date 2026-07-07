import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../utils/database";
import { igdbImage } from "../../../../utils/format";
import { renderOgPng, fetchImageDataUri } from "../../../../utils/og";
import { buildReviewOgTree } from "../../../../utils/ogReview";

export const prerender = false;

const IMAGE_FETCH_TIMEOUT_MS = 4000;

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return new Response(null, { status: 404 });

  const db = getSupabaseAdmin() as any;

  const { data: review } = await db
    .from("reviews")
    .select(`
      score, title, status,
      games ( title, cover_img_url ),
      profiles ( username, avatar_url )
    `)
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();

  // Drafts (and anything not found) never get a public preview image — the
  // requester here is an unauthenticated bot (Discord/Reddit's link-preview
  // crawler), never the review's own author.
  if (!review) return new Response(null, { status: 404 });

  const coverUrl = igdbImage(review.games?.cover_img_url, "t_cover_big");

  const [coverDataUri, reviewerAvatarDataUri] = await Promise.all([
    coverUrl ? fetchImageDataUri(coverUrl, IMAGE_FETCH_TIMEOUT_MS) : Promise.resolve(null),
    review.profiles?.avatar_url ? fetchImageDataUri(review.profiles.avatar_url, IMAGE_FETCH_TIMEOUT_MS) : Promise.resolve(null),
  ]);

  const tree = buildReviewOgTree({
    gameTitle: review.games?.title ?? "Unknown game",
    coverDataUri,
    score: review.score,
    reviewTitle: review.title ?? null,
    reviewerUsername: review.profiles?.username ?? "unknown",
    reviewerAvatarDataUri,
  });

  const png = await renderOgPng(tree, 1200, 630);

  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
      "Netlify-CDN-Cache-Control": "public, max-age=1800, stale-while-revalidate=86400",
    },
  });
};
