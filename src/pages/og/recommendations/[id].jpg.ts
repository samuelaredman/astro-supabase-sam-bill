import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { igdbImage } from "../../../utils/format";
import { renderOgImage, fetchAndCropCover, fetchImageDataUri } from "../../../utils/og";
import { buildRecOgTree } from "../../../utils/ogRecommendation";

export const prerender = false;

const COVER_W = 200;
const COVER_H = 267;
const TIMEOUT_MS = 4500;

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return new Response(null, { status: 404 });

  const db = getSupabaseAdmin() as any;

  const { data: rec } = await db
    .from("recommendations")
    .select(`
      id, body,
      source_game:games!source_game_id ( title, cover_img_url ),
      target_game:games!target_game_id ( title, cover_img_url ),
      profiles ( username, avatar_url )
    `)
    .eq("id", id)
    .eq("status", "published")
    .maybeSingle();

  if (!rec) return new Response(null, { status: 404 });

  const sourceUrl = igdbImage(rec.source_game?.cover_img_url, "t_cover_big");
  const targetUrl = igdbImage(rec.target_game?.cover_img_url, "t_cover_big");
  const avatarUrl = rec.profiles?.avatar_url ?? null;

  const [sourceGameCoverUri, targetGameCoverUri, ownerAvatarUri] = await Promise.all([
    sourceUrl ? fetchAndCropCover(sourceUrl, COVER_W, COVER_H, "center", TIMEOUT_MS) : Promise.resolve(null),
    targetUrl ? fetchAndCropCover(targetUrl, COVER_W, COVER_H, "center", TIMEOUT_MS) : Promise.resolve(null),
    avatarUrl ? fetchImageDataUri(avatarUrl, TIMEOUT_MS) : Promise.resolve(null),
  ]);

  const tree = buildRecOgTree({
    sourceGameTitle: rec.source_game?.title ?? "a game",
    sourceGameCoverUri,
    targetGameTitle: rec.target_game?.title ?? "another game",
    targetGameCoverUri,
    body: rec.body ?? "",
    ownerUsername: rec.profiles?.username ?? "unknown",
    ownerAvatarUri,
  });

  const image = await renderOgImage(tree, 1200, 630);

  return new Response(new Uint8Array(image), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "Netlify-CDN-Cache-Control": "public, max-age=1800, stale-while-revalidate=86400",
    },
  });
};
