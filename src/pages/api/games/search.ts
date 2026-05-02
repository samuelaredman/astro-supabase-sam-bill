import type { APIRoute } from "astro";
import { getSupabase } from "../../../utils/database";

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

  if (error) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const results = (data ?? []).map((g: any) => ({
    id: g.id,
    title: g.title,
    slug: g.slug,
    cover_img_url: g.cover_img_url ?? null,
    date_released: g.date_released ?? null,
  }));

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
};
