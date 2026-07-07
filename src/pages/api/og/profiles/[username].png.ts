import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../utils/database";
import { renderOgPng, fetchImageDataUri } from "../../../../utils/og";
import { buildProfileOgTree } from "../../../../utils/ogProfile";

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
    profile.banner_url ? fetchImageDataUri(profile.banner_url, IMAGE_FETCH_TIMEOUT_MS) : Promise.resolve(null),
  ]);

  const tree = buildProfileOgTree({
    username: profile.username,
    avatarDataUri,
    bannerDataUri,
    bannerPosition: profile.banner_position ?? null,
    reviewCount,
    avgScore,
    topGenre,
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
