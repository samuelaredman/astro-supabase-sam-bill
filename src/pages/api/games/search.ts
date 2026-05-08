import type { APIRoute } from "astro";
import { getSupabase } from "../../../utils/database";
import { igdbFetch } from "../../../utils/igdb";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = getSupabase();
  const { data, error } = await (supabase as any)
    .from("games")
    .select("id, title, slug, cover_img_url, date_released")
    .ilike("title", `%${q}%`)
    .limit(8);

  if (!error && data && data.length > 0) {
    return new Response(JSON.stringify(data.map((g: any) => ({
      id: g.id,
      title: g.title,
      slug: g.slug,
      cover_img_url: g.cover_img_url ?? null,
      date_released: g.date_released ?? null,
      source: 'db',
    }))), { headers: { "Content-Type": "application/json" } });
  }

  // DB miss — fall back to IGDB
  try {
    const igdbResults = await igdbFetch("games", `
      fields name, slug, summary, first_release_date, cover.url;
      search "${q}";
      limit 8;
    `);

    if (!igdbResults || igdbResults.length === 0) {
      return new Response(JSON.stringify([]), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const results = igdbResults.map((g: any) => ({
      id: String(g.id),
      title: g.name,
      slug: g.slug,
      cover_img_url: g.cover?.url
        ? `https:${g.cover.url.replace('t_thumb', 't_cover_big')}`
        : null,
      date_released: g.first_release_date
        ? new Date(g.first_release_date * 1000).toISOString().split('T')[0]
        : null,
      igdb_id: g.id,
      source: 'igdb',
    }));

    return new Response(JSON.stringify(results), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }
};
