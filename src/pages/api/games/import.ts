import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";
import { igdbFetch } from "../../../utils/igdb";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function makeSlug(title: string, igdbSlug?: string): string {
  if (igdbSlug) return igdbSlug;
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const POST: APIRoute = async (context) => {
  // Auth check — use the user client to verify they're logged in
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { igdb_id } = await context.request.json();
  if (!igdb_id) return json({ error: 'Missing igdb_id' }, 400);

  // All DB operations use the admin client to bypass RLS on the games table
  const db = getSupabaseAdmin() as any;

  // Check if already imported
  const { data: existing } = await db
    .from('games')
    .select('id, title, slug, cover_img_url, date_released')
    .eq('igdb_id', igdb_id)
    .maybeSingle();

  if (existing) return json(existing);

  // Fetch full game data from IGDB
  const [games, covers] = await Promise.all([
    igdbFetch("games", `
      fields name, slug, summary, first_release_date;
      where id = ${igdb_id};
      limit 1;
    `),
    igdbFetch("covers", `
      fields url;
      where game = ${igdb_id};
      limit 1;
    `),
  ]);

  if (!games || games.length === 0) return json({ error: 'Game not found on IGDB' }, 404);

  const game = games[0];
  const coverUrl = covers?.[0]?.url
    ? `https:${covers[0].url.replace('t_thumb', 't_cover_big')}`
    : null;

  const slug = makeSlug(game.name, game.slug);

  // Ensure slug is unique
  const { data: slugConflict } = await db
    .from('games')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  const finalSlug = slugConflict ? `${slug}-${igdb_id}` : slug;

  const { data: inserted, error: insertError } = await db
    .from('games')
    .insert({
      title: game.name,
      slug: finalSlug,
      game_description: game.summary ?? null,
      cover_img_url: coverUrl,
      date_released: game.first_release_date
        ? new Date(game.first_release_date * 1000).toISOString().split('T')[0]
        : null,
      igdb_id: game.id,
    })
    .select('id, title, slug, cover_img_url, date_released')
    .single();

  if (insertError) {
    console.error('[import] DB insert error:', insertError);
    return json({ error: `Failed to import game: ${insertError.message}` }, 500);
  }

  return json(inserted);
};
