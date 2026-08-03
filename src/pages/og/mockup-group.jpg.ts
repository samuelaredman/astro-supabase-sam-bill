import type { APIRoute } from "astro";
import { renderOgImage, fetchImageDataUri } from "../../utils/og";
import { buildGroupOgTree } from "../../utils/ogGroup";
import { resolveGameCover } from "./_mockupShared";

export const prerender = false;

const IMAGE_FETCH_TIMEOUT_MS = 4000;

const USAGE =
  "Outreach mockup tool — dev only.\n\n" +
  "Renders a real Chekpoint group card for arbitrary text, with no DB row " +
  "behind it, so a creator can see what their community page would look " +
  "like before ever creating one.\n\n" +
  "GET /og/mockup-group.jpg\n" +
  "  ?name=<group name, required>\n" +
  "  &members=<member count, required>\n" +
  "  &games=<comma-separated game titles/slugs for the cover mosaic, optional>\n" +
  "  &avgScore=<optional 1-10, shown as the community's avg score>\n" +
  "  &reviews=<optional review count>\n" +
  "  &avatar=<optional URL to the group's avatar>\n\n" +
  "Example:\n" +
  "  /og/mockup-group.jpg?name=SomeReviewer's Community&members=340" +
  "&games=Baldur's+Gate+3,Hades+II,Elden+Ring&avgScore=8.2&reviews=52";

export const GET: APIRoute = async ({ url }) => {
  // Lets ANY text be rendered onto a branded Chekpoint card with no real
  // group behind it — an impersonation / fake-social-proof risk if this
  // were reachable in production. Dev-only, same gate as middleware.ts.
  if (!import.meta.env.DEV) return new Response(null, { status: 404 });

  const params = url.searchParams;
  const name = params.get("name");
  const membersStr = params.get("members");
  if (!name || !membersStr) {
    return new Response(USAGE, { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const memberCount = Math.max(0, Math.round(Number(membersStr)) || 0);
  const reviewsStr = params.get("reviews");
  const totalReviews = reviewsStr ? Math.max(0, Math.round(Number(reviewsStr)) || 0) : 0;
  const avgScoreStr = params.get("avgScore");
  const avgScore = avgScoreStr ? Math.max(1, Math.min(10, Number(avgScoreStr))) : null;
  const avatarUrl = params.get("avatar");
  const gamesParam = params.get("games");

  const gameQueries = (gamesParam ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 18);

  const resolvedCovers = await Promise.all(
    gameQueries.map((g) => resolveGameCover(g, null))
  );
  const coverUrls = resolvedCovers.map((r) => r.coverUrl).filter((u): u is string => !!u);

  const [coverDataUris, avatarDataUri] = await Promise.all([
    Promise.all(coverUrls.map((u) => fetchImageDataUri(u, IMAGE_FETCH_TIMEOUT_MS))).then((arr) =>
      arr.filter((u): u is string => !!u)
    ),
    avatarUrl ? fetchImageDataUri(avatarUrl, IMAGE_FETCH_TIMEOUT_MS) : Promise.resolve(null),
  ]);

  const tree = buildGroupOgTree({
    name,
    avatarDataUri,
    memberCount,
    totalReviews,
    avgScore,
    coverDataUris,
  });

  const image = await renderOgImage(tree, 1200, 630);

  return new Response(new Uint8Array(image), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
};
