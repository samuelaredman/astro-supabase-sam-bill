import type { APIRoute } from "astro";
import { getSupabase } from "../../../utils/database";
import { igdbFetch, escapeIgdbString } from "../../../utils/igdb";
import { ALLOWED_GAME_CATEGORIES, GAME_CATEGORY_OR_FILTER, foldDiacritics } from "../../../utils/games";

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = getSupabase();
  const escapedQ = escapeIgdbString(q);

  // Run fuzzy DB search and IGDB fetch in parallel.
  // IGDB query filters to allowed categories so live suggestions are clean.
  // Two IGDB queries, merged below: IGDB's own `search` operator ranks by
  // relevance, which can bury an obscure exact title under more "popular"
  // loose substring matches (e.g. "Öoo" ranked below several unrelated
  // "Adventure Time"/"Kamen Rider" games that merely contain "ooo") — the
  // `where name ~ *"..."*;` query guarantees a literal substring match on
  // the name always surfaces regardless of that ranking.
  const [rpcRes, igdbSearchRes, igdbNameRes] = await Promise.all([
    supabase.rpc('search_games', { search_query: q, result_limit: 8 }),
    igdbFetch("games", `
      fields name, slug, cover.url, first_release_date;
      search "${escapedQ}";
      where game_type = (${ALLOWED_GAME_CATEGORIES.join(',')});
      limit 6;
    `).catch(() => []),
    igdbFetch("games", `
      fields name, slug, cover.url, first_release_date;
      where name ~ *"${escapedQ}"* & game_type = (${ALLOWED_GAME_CATEGORIES.join(',')});
      limit 6;
    `).catch(() => []),
  ]);

  const seenIgdbIds = new Set<string>();
  const igdbRes = [...(igdbSearchRes ?? []), ...(igdbNameRes ?? [])].filter((g: any) => {
    const id = String(g.id);
    if (seenIgdbIds.has(id)) return false;
    seenIgdbIds.add(id);
    return true;
  });

  const rpcIds: string[] = (rpcRes.data ?? []).map((g: any) => g.id);

  let dbGames: any[] = [];
  if (rpcIds.length > 0) {
    const { data } = await supabase
      .from("games")
      .select("id, title, slug, cover_img_url, date_released")
      .in("id", rpcIds)
      .or(GAME_CATEGORY_OR_FILTER);
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
      .or(GAME_CATEGORY_OR_FILTER)
      .limit(8);
    dbGames = data ?? [];
  }

  const dbIdSet = new Set(dbGames.map((g: any) => g.id));
  // Folded (accent-stripped) so a query typed without diacritics — e.g. "ooo"
  // for a title actually spelled "Öoo" — still matches as a substring below.
  const qLowerFolded = foldDiacritics(q.toLowerCase());

  const igdbExtra = (igdbRes ?? [])
    .filter((g: any) => !dbIdSet.has(String(g.id)))
    // IGDB's own fuzzy search returns loosely-related matches (e.g. "bioshock"
    // pulling up "Bio Fault") — require the query as an actual substring.
    .filter((g: any) => typeof g.name === "string" && foldDiacritics(g.name.toLowerCase()).includes(qLowerFolded))
    .slice(0, Math.max(0, 8 - dbGames.length))
    .map((g: any) => ({
      id: String(g.id),
      title: g.name,
      slug: g.slug,
      cover_img_url: g.cover?.url
        ? `https:${g.cover.url.replace("t_thumb", "t_cover_big")}`
        : null,
      year: g.first_release_date
        ? new Date(g.first_release_date * 1000).getFullYear()
        : null,
      igdb_id: g.id,
      source: "igdb",
    }));

  const results = [
    ...dbGames.map((g: any) => ({
      ...g,
      year: g.date_released ? new Date(g.date_released).getFullYear() : null,
      source: "db",
    })),
    ...igdbExtra,
  ];

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
};
