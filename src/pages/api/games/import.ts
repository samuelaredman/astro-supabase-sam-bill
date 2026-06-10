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
  const db = getSupabaseAdmin();

  // Check if already imported
  const { data: existing } = await db
    .from('games')
    .select('id, title, slug, cover_img_url, date_released')
    .eq('igdb_id', igdb_id)
    .maybeSingle();

  if (existing) {
    // Game row already exists — check whether platforms/genres were linked.
    // If not (e.g. imported before this fix), sync them now and return.
    const [{ count: platformCount }, { count: genreCount }] = await Promise.all([
      db.from('game_platforms').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
      db.from('game_genres').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
    ]);

    if ((platformCount ?? 0) === 0 || (genreCount ?? 0) === 0) {
      // Re-fetch from IGDB to get platform/genre data and link it
      const refresh = await igdbFetch("games", `
        fields genres.id, genres.name, genres.slug,
               platforms.id, platforms.name, platforms.slug;
        where id = ${igdb_id};
        limit 1;
      `);
      const g = refresh?.[0];
      if (g) {
        for (const genre of g.genres ?? []) {
          await db.from('genres').upsert({ igdb_id: genre.id, name: genre.name, slug: genre.slug }, { onConflict: 'igdb_id' });
          const { data: gr } = await db.from('genres').select('id').eq('igdb_id', genre.id).single();
          if (gr) await db.from('game_genres').upsert({ game_id: existing.id, genre_id: gr.id }, { onConflict: 'game_id,genre_id' });
        }
        for (const platform of g.platforms ?? []) {
          await db.from('platforms').upsert({ igdb_id: platform.id, name: platform.name, slug: platform.slug }, { onConflict: 'igdb_id' });
          const { data: pr } = await db.from('platforms').select('id').eq('igdb_id', platform.id).single();
          if (pr) await db.from('game_platforms').upsert({ game_id: existing.id, platform_id: pr.id }, { onConflict: 'game_id,platform_id' });
        }
      }
    }

    return json(existing);
  }

  // Fetch full game data from IGDB — include platforms and genres so we can
  // populate the junction tables (game_platforms, game_genres) on import
  const games = await igdbFetch("games", `
    fields name, slug, summary, first_release_date, cover.url,
           genres.id, genres.name, genres.slug,
           platforms.id, platforms.name, platforms.slug;
    where id = ${igdb_id};
    limit 1;
  `);

  if (!games || games.length === 0) return json({ error: 'Game not found on IGDB' }, 404);

  const game = games[0];
  const coverUrl = game.cover?.url
    ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}`
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

  // Populate genres — upsert genre rows then link via game_genres
  for (const genre of game.genres ?? []) {
    await db.from('genres').upsert(
      { igdb_id: genre.id, name: genre.name, slug: genre.slug },
      { onConflict: 'igdb_id' }
    );
    const { data: genreRow } = await db.from('genres').select('id').eq('igdb_id', genre.id).single();
    if (genreRow) {
      await db.from('game_genres').upsert(
        { game_id: inserted.id, genre_id: genreRow.id },
        { onConflict: 'game_id,genre_id' }
      );
    }
  }

  // Populate platforms — upsert platform rows then link via game_platforms
  for (const platform of game.platforms ?? []) {
    await db.from('platforms').upsert(
      { igdb_id: platform.id, name: platform.name, slug: platform.slug },
      { onConflict: 'igdb_id' }
    );
    const { data: platformRow } = await db.from('platforms').select('id').eq('igdb_id', platform.id).single();
    if (platformRow) {
      await db.from('game_platforms').upsert(
        { game_id: inserted.id, platform_id: platformRow.id },
        { onConflict: 'game_id,platform_id' }
      );
    }
  }

  return json(inserted);
};
