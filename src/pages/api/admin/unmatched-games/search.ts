import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";
import { igdbFetch } from "../../../../utils/igdb";
import { GAME_CATEGORIES } from "../../../../utils/games";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;

  const { title } = await context.request.json();
  if (!title?.trim()) return json({ error: "Missing title." }, 400);

  const results = await igdbFetch("games", `
    fields name, slug, cover.url, first_release_date, game_type;
    search "${title.trim().replace(/"/g, '')}";
    limit 10;
  `).catch(() => []);

  const candidates = (results ?? []).map((g: any) => ({
    igdb_id: g.id,
    title: g.name,
    slug: g.slug,
    cover_img_url: g.cover?.url ? `https:${g.cover.url.replace('t_thumb', 't_cover_big')}` : null,
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
    category: g.game_type ?? null,
    category_label: g.game_type != null ? (GAME_CATEGORIES[g.game_type] ?? 'unknown') : 'unknown',
  }));

  return json(candidates);
};
