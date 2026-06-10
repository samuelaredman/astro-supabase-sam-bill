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

  // Run fuzzy DB search and IGDB fetch in parallel
  const [rpcRes, igdbRes] = await Promise.all([
    supabase.rpc('search_games', { search_query: q, result_limit: 8 }),
    igdbFetch("games", `fields name, slug, cover.url; search "${q}"; limit 6;`).catch(() => []),
  ]);

  const rpcIds: string[] = (rpcRes.data ?? []).map((g: any) => g.id);

  let dbGames: any[] = [];
  if (rpcIds.length > 0) {
    const { data } = await supabase
      .from("games")
      .select("id, title, slug, cover_img_url, date_released")
      .in("id", rpcIds);
    const orderMap = new Map(rpcIds.map((id, i) => [id, i]));
    dbGames = (data ?? []).sort(
      (a: any, b: any) => (orderMap.get(a.id) ?? 99) - (orderMap.get(b.id) ?? 99)
    );
  } else {
    // RPC found nothing — fall back to ilike so partial-word queries still work
    const { data } = await supabase
      .from("games")
      .select("id, title, slug, cover_img_url, date_released")
      .ilike("title", `%${q}%`)
      .limit(8);
    dbGames = data ?? [];
  }

  const dbIdSet = new Set(dbGames.map((g: any) => g.id));

  const igdbExtra = (igdbRes ?? [])
    .filter((g: any) => !dbIdSet.has(String(g.id)))
    .slice(0, Math.max(0, 8 - dbGames.length))
    .map((g: any) => ({
      id: String(g.id),
      title: g.name,
      slug: g.slug,
      cover_img_url: g.cover?.url
        ? `https:${g.cover.url.replace("t_thumb", "t_cover_big")}`
        : null,
      igdb_id: g.id,
      source: "igdb",
    }));

  const results = [
    ...dbGames.map((g: any) => ({ ...g, source: "db" })),
    ...igdbExtra,
  ];

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
};
