import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { igdbImage } from "../../../utils/format";
import { renderOgImage, fetchImageDataUri } from "../../../utils/og";
import { buildGroupOgTree } from "../../../utils/ogGroup";

export const prerender = false;

const IMAGE_FETCH_TIMEOUT_MS = 4000;

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return new Response(null, { status: 404 });

  const db = getSupabaseAdmin() as any;

  const { data: group } = await db
    .from("groups")
    .select("id, name, avatar_url, visibility")
    .eq("id", id)
    .maybeSingle();

  // Private groups never get a public preview image — the requester here is an
  // unauthenticated bot (Discord/Reddit's link-preview crawler), never a member.
  if (!group || group.visibility === "private") {
    return new Response(null, { status: 404 });
  }

  const { data: members } = await db
    .from("group_members")
    .select("profile_id")
    .eq("group_id", id);

  const memberProfileIds = ((members ?? []) as any[]).map((m) => m.profile_id);

  const { data: allReviews } = memberProfileIds.length > 0
    ? await db
        .from("reviews")
        .select("game_id, score, games ( id, cover_img_url )")
        .in("profile_id", memberProfileIds)
        .eq("status", "published")
        .limit(1000)
    : { data: [] as any[] };

  // Same aggregation as groups/[id]/top-rated.astro: every member's published
  // reviews, grouped by game, ranked by that game's avg score within the group.
  const gameStats: Record<string, { cover: string | null; count: number; scores: number[] }> = {};
  const allScores: number[] = [];
  for (const r of (allReviews ?? []) as any[]) {
    allScores.push(r.score);
    const gid = r.games?.id;
    if (!gid) continue;
    if (!gameStats[gid]) gameStats[gid] = { cover: r.games?.cover_img_url ?? null, count: 0, scores: [] };
    gameStats[gid].count++;
    gameStats[gid].scores.push(r.score);
  }

  const topGameCoverUrls = Object.values(gameStats)
    .map((g) => ({
      cover: g.cover,
      avgScore: g.scores.reduce((a, b) => a + b, 0) / g.scores.length,
      count: g.count,
    }))
    .sort((a, b) => b.avgScore - a.avgScore || b.count - a.count)
    .slice(0, 18)
    .map((g) => igdbImage(g.cover, "t_cover_big"))
    .filter(Boolean) as string[];

  const avgScore = allScores.length > 0
    ? allScores.reduce((a, b) => a + b, 0) / allScores.length
    : null;

  const [coverDataUris, avatarDataUri] = await Promise.all([
    Promise.all(topGameCoverUrls.map((u) => fetchImageDataUri(u, IMAGE_FETCH_TIMEOUT_MS))).then((arr) =>
      arr.filter((u): u is string => !!u)
    ),
    group.avatar_url ? fetchImageDataUri(group.avatar_url, IMAGE_FETCH_TIMEOUT_MS) : Promise.resolve(null),
  ]);

  const tree = buildGroupOgTree({
    name: group.name,
    avatarDataUri,
    memberCount: memberProfileIds.length,
    totalReviews: allScores.length,
    avgScore,
    coverDataUris,
  });

  const image = await renderOgImage(tree, 1200, 630);

  return new Response(new Uint8Array(image), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      // See home.png.ts for why this is set.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "Netlify-CDN-Cache-Control": "public, max-age=1800, stale-while-revalidate=86400",
    },
  });
};
