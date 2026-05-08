import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";
import { igdbFetch } from "../../../utils/igdb";

function makeSlug(title: string, igdbSlug?: string): string {
  if (igdbSlug) return igdbSlug;
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const { igdb_id } = await context.request.json();
  if (!igdb_id) {
    return new Response(JSON.stringify({ error: 'Missing igdb_id' }), { status: 400 });
  }

  // Check if already imported by another user in the meantime
  const { data: existing } = await (supabase as any)
    .from('games')
    .select('id, title, slug, cover_img_url, date_released')
    .eq('igdb_id', igdb_id)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify(existing), {
      headers: { "Content-Type": "application/json" },
    });
  }

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

  if (!games || games.length === 0) {
    return new Response(JSON.stringify({ error: 'Game not found on IGDB' }), { status: 404 });
  }

  const game = games[0];
  const coverUrl = covers?.[0]?.url
    ? `https:${covers[0].url.replace('t_thumb', 't_cover_big')}`
    : null;

  const slug = makeSlug(game.name, game.slug);

  // Ensure slug is unique
  const { data: slugConflict } = await (supabase as any)
    .from('games')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  const finalSlug = slugConflict ? `${slug}-${igdb_id}` : slug;

  const { data: inserted, error: insertError } = await (supabase as any)
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
    return new Response(JSON.stringify({ error: 'Failed to import game' }), { status: 500 });
  }

  return new Response(JSON.stringify(inserted), {
    headers: { "Content-Type": "application/json" },
  });
};
