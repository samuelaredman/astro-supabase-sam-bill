import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { igdbImage } from "../../../utils/format";
import { renderOgImage, fetchImageDataUri, fetchAndCropCover } from "../../../utils/og";
import { buildListGridTree, getGridDimensions, CANVAS_W } from "../../../utils/ogListGrid";

export const prerender = false;

const TIMEOUT_MS = 4500;

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return new Response(null, { status: 404 });

  const db = getSupabaseAdmin() as any;

  const { data: list } = await db
    .from("lists")
    .select("id, title, is_ranked, visibility, profiles ( id, username, avatar_url )")
    .eq("id", id)
    .maybeSingle();

  if (!list || list.visibility === "private") {
    return new Response(null, { status: 404 });
  }

  const { data: entries } = await db
    .from("list_entries")
    .select("position, games ( id, title, cover_img_url )")
    .eq("list_id", id)
    .order("position", { ascending: true, nullsFirst: false })
    .order("added_at", { ascending: true })
    .limit(100);

  const entryList = (entries ?? []) as any[];
  const gameIds = entryList.map((e) => e.games?.id).filter(Boolean);

  // Compute layout dimensions based on actual entry count — needed for cropping
  const { CELL_W, COVER_H } = getGridDimensions(entryList.length);

  // Fetch owner reviews for score + hours
  let reviewMap: Record<string, { score: number; hoursPlayed: number | null }> = {};
  if (gameIds.length > 0 && list.profiles?.id) {
    const { data: reviews } = await db
      .from("reviews")
      .select("game_id, score, play_time_hours")
      .eq("profile_id", list.profiles.id)
      .eq("status", "published")
      .in("game_id", gameIds);

    for (const r of (reviews ?? []) as any[]) {
      reviewMap[r.game_id] = { score: r.score, hoursPlayed: r.play_time_hours ?? null };
    }
  }

  const reviewScores = Object.values(reviewMap).map((r) => r.score);
  const avgScore = reviewScores.length > 0
    ? reviewScores.reduce((s, v) => s + v, 0) / reviewScores.length
    : null;

  const [processedEntries, ownerAvatarDataUri] = await Promise.all([
    Promise.all(
      entryList.map(async (e, i) => {
        const url = igdbImage(e.games?.cover_img_url, "t_cover_big");
        const coverDataUri = url
          ? await fetchAndCropCover(url, CELL_W, COVER_H, "center", TIMEOUT_MS)
          : null;
        const review = reviewMap[e.games?.id] ?? null;
        return {
          coverDataUri,
          rank: e.position ?? i + 1,
          gameTitle: e.games?.title ?? "",
          score: review?.score ?? null,
          hoursPlayed: review?.hoursPlayed ?? null,
        };
      })
    ),
    list.profiles?.avatar_url
      ? fetchImageDataUri(list.profiles.avatar_url, TIMEOUT_MS)
      : Promise.resolve(null),
  ]);

  const { tree, height } = buildListGridTree({
    title: list.title,
    ownerUsername: list.profiles?.username ?? "unknown",
    ownerAvatarDataUri,
    isRanked: !!list.is_ranked,
    totalGames: entryList.length,
    avgScore,
    entries: processedEntries,
  });

  const image = await renderOgImage(tree, CANVAS_W, height);

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
