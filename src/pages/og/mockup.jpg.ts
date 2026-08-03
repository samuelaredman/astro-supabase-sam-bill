
import type { APIRoute } from "astro";
import { renderOgImage, fetchImageDataUri } from "../../utils/og";
import { buildReviewOgTree } from "../../utils/ogReview";
import { resolveGameCover } from "./_mockupShared";

export const prerender = false;

const IMAGE_FETCH_TIMEOUT_MS = 4000;

const USAGE =
  "Outreach mockup tool — dev only.\n\n" +
  "Renders a real Chekpoint review card for arbitrary text, with no DB row " +
  "behind it, so a creator can see what their share card would look like " +
  "before ever signing up.\n\n" +
  "GET /og/mockup.jpg\n" +
  "  ?game=<title or slug, required>    matched against the games table\n" +
  "  &score=<1-10, required>\n" +
  "  &username=<display name, required>\n" +
  "  &title=<optional review headline/pull-quote>\n" +
  "  &avatar=<optional URL to the creator's avatar>\n" +
  "  &cover=<optional cover image URL — overrides the games-table lookup, " +
  "for a game not yet in our catalog>\n\n" +
  "Example:\n" +
  "  /og/mockup.jpg?game=Baldur's+Gate+3&score=9&username=SomeReviewer" +
  "&title=A+near-perfect+RPG";

export const GET: APIRoute = async ({ url }) => {
  // Lets ANY text be rendered onto a branded Chekpoint card with no real
  // review behind it — an impersonation / fake-social-proof risk if this
  // were reachable in production. Dev-only, same gate as middleware.ts.
  if (!import.meta.env.DEV) return new Response(null, { status: 404 });

  const params = url.searchParams;
  const game = params.get("game");
  const scoreStr = params.get("score");
  const username = params.get("username");
  if (!game || !scoreStr || !username) {
    return new Response(USAGE, { status: 400, headers: { "Content-Type": "text/plain" } });
  }

  const scoreNum = Math.round(Number(scoreStr));
  if (!Number.isFinite(scoreNum)) {
    return new Response("score must be a number 1-10", { status: 400, headers: { "Content-Type": "text/plain" } });
  }
  const score = Math.max(1, Math.min(10, scoreNum));
  const reviewTitle = params.get("title");
  const avatarUrl = params.get("avatar");
  const coverOverrideUrl = params.get("cover");

  const { title: gameTitle, coverUrl } = await resolveGameCover(game, coverOverrideUrl);

  const [coverDataUri, reviewerAvatarDataUri] = await Promise.all([
    coverUrl ? fetchImageDataUri(coverUrl, IMAGE_FETCH_TIMEOUT_MS) : Promise.resolve(null),
    avatarUrl ? fetchImageDataUri(avatarUrl, IMAGE_FETCH_TIMEOUT_MS) : Promise.resolve(null),
  ]);

  const tree = buildReviewOgTree({
    gameTitle,
    coverDataUri,
    score,
    reviewTitle,
    reviewerUsername: username,
    reviewerAvatarDataUri,
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
