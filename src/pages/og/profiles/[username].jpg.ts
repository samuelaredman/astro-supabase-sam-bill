import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { renderOgImage, fetchImageDataUri, fetchAndCropCover } from "../../../utils/og";
import { buildProfileOgTree } from "../../../utils/ogProfile";

export const prerender = false;

const IMAGE_FETCH_TIMEOUT_MS = 4000;

export const GET: APIRoute = async ({ params }) => {
  const { username } = params;
  if (!username) return new Response(null, { status: 404 });

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from("profiles")
    .select("id, username, avatar_url, banner_url, banner_position, is_active")
    .eq("username", username)
    .maybeSingle();

  // Deactivated (and any not-found) profiles never get a public preview image —
  // the requester here is an unauthenticated bot (Discord/Reddit's link-preview
  // crawler), never the profile's own owner.
  if (!profile || !profile.is_active) return new Response(null, { status: 404 });

  const { data: reviews } = await db
    .from("reviews")
    .select("score, games ( game_genres ( genres ( name ) ) )")
    .eq("profile_id", profile.id)
    .eq("status", "published");

  const reviewRows = (reviews ?? []) as any[];
  const reviewCount = reviewRows.length;
  const avgScore = reviewCount > 0
    ? reviewRows.reduce((sum, r) => sum + r.score, 0) / reviewCount
    : null;

  const genreCounts: Record<string, number> = {};
  for (const r of reviewRows) {
    const gameGenres = r.games?.game_genres ?? [];
    for (const gg of gameGenres) {
      const name = gg.genres?.name;
      if (name) genreCounts[name] = (genreCounts[name] ?? 0) + 1;
    }
  }
  const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const [avatarDataUri, bannerDataUri] = await Promise.all([
    profile.avatar_url ? fetchImageDataUri(profile.avatar_url, IMAGE_FETCH_TIMEOUT_MS) : Promise.resolve(null),
    // Cropped server-side to exactly the card's canvas size — see
    // fetchAndCropCover's doc comment in utils/og.ts for why.
    profile.banner_url
      ? fetchAndCropCover(profile.banner_url, 1200, 500, profile.banner_position ?? null, IMAGE_FETCH_TIMEOUT_MS)
      : Promise.resolve(null),
  ]);

  const tree = buildProfileOgTree({
    username: profile.username,
    avatarDataUri,
    bannerDataUri,
    reviewCount,
    avgScore,
    topGenre,
  });

  const image = await renderOgImage(tree, 1200, 500);

  return new Response(new Uint8Array(image), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      // See home.png.ts for why this is set.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
      "Netlify-CDN-Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
};
