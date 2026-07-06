import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../../utils/database";
import { igdbImage } from "../../../../utils/format";
import { renderOgPng, fetchImageDataUri } from "../../../../utils/og";
import { buildListOgTree } from "../../../../utils/ogList";

export const prerender = false;

const IMAGE_FETCH_TIMEOUT_MS = 4000;

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return new Response(null, { status: 404 });

  const db = getSupabaseAdmin() as any;

  const { data: list } = await db
    .from("lists")
    .select("id, title, is_ranked, visibility, profiles ( id, username, avatar_url )")
    .eq("id", id)
    .maybeSingle();

  // Private lists never get a public preview image — the requester here is an
  // unauthenticated bot (Discord/Reddit's link-preview crawler), never the owner.
  if (!list || list.visibility === "private") {
    return new Response(null, { status: 404 });
  }

  const [{ count: entryCountTotal }, { data: topEntries }, { data: allEntryGameIds }] = await Promise.all([
    db.from("list_entries").select("*", { count: "exact", head: true }).eq("list_id", id),
    db.from("list_entries")
      .select("games ( cover_img_url )")
      .eq("list_id", id)
      .order("position", { ascending: true, nullsFirst: false })
      .order("added_at", { ascending: true })
      .limit(18),
    db.from("list_entries").select("games ( id )").eq("list_id", id).limit(300),
  ]);

  let avgScore: number | null = null;
  const gameIds = ((allEntryGameIds ?? []) as any[]).map((e) => e.games?.id).filter(Boolean);
  if (gameIds.length > 0 && list.profiles?.id) {
    const { data: reviewRows } = await db
      .from("reviews")
      .select("score")
      .eq("profile_id", list.profiles.id)
      .eq("status", "published")
      .in("game_id", gameIds);
    if (reviewRows && reviewRows.length > 0) {
      avgScore = reviewRows.reduce((sum: number, r: any) => sum + r.score, 0) / reviewRows.length;
    }
  }

  const coverUrls = ((topEntries ?? []) as any[])
    // Full resolution — a small list stretches 1-4 covers across large grid cells,
    // and t_cover_big (264x374) upscales visibly soft at that size.
    .map((e) => igdbImage(e.games?.cover_img_url, "t_original"))
    .filter(Boolean) as string[];

  const [coverDataUris, ownerAvatarDataUri] = await Promise.all([
    Promise.all(coverUrls.map((u) => fetchImageDataUri(u, IMAGE_FETCH_TIMEOUT_MS))).then((arr) =>
      arr.filter((u): u is string => !!u)
    ),
    list.profiles?.avatar_url ? fetchImageDataUri(list.profiles.avatar_url, IMAGE_FETCH_TIMEOUT_MS) : Promise.resolve(null),
  ]);

  const tree = buildListOgTree({
    title: list.title,
    ownerUsername: list.profiles?.username ?? "unknown",
    ownerAvatarDataUri,
    entryCountTotal: entryCountTotal ?? 0,
    isRanked: !!list.is_ranked,
    avgScore,
    coverDataUris,
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
