import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../../utils/database";
import { igdbImage } from "../../../utils/format";
import { renderOgImage, fetchImageDataUri } from "../../../utils/og";
import { buildListGridTree } from "../../../utils/ogListGrid";

export const prerender = false;

const IMAGE_FETCH_TIMEOUT_MS = 4000;

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id) return new Response(null, { status: 404 });

  const db = getSupabaseAdmin() as any;

  const { data: list } = await db
    .from("lists")
    .select("id, title, is_ranked, visibility")
    .eq("id", id)
    .maybeSingle();

  if (!list || list.visibility === "private") {
    return new Response(null, { status: 404 });
  }

  const { data: entries } = await db
    .from("list_entries")
    .select("position, games ( cover_img_url )")
    .eq("list_id", id)
    .order("position", { ascending: true, nullsFirst: false })
    .order("added_at", { ascending: true })
    .limit(20);

  const entryList = (entries ?? []) as any[];

  const coverDataUris = await Promise.all(
    entryList.map(async (e, i) => {
      const url = igdbImage(e.games?.cover_img_url, "t_cover_big");
      return {
        coverDataUri: url ? await fetchImageDataUri(url, IMAGE_FETCH_TIMEOUT_MS) : null,
        rank: e.position ?? i + 1,
      };
    })
  );

  const { tree, height } = buildListGridTree({
    title: list.title,
    isRanked: !!list.is_ranked,
    entries: coverDataUris,
  });

  const image = await renderOgImage(tree, 1000, height);

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
