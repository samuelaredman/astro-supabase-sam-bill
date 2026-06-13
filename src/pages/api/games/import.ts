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

async function upsertJunction(
  db: any,
  gameId: string,
  items: Array<{ id: number; name: string; slug?: string }> | null | undefined,
  refTable: string,
  junctionTable: string,
  junctionCol: string
): Promise<void> {
  for (const item of items ?? []) {
    await db.from(refTable).upsert(
      { igdb_id: item.id, name: item.name, slug: item.slug ?? null },
      { onConflict: 'igdb_id' }
    );
    const { data: row } = await db.from(refTable).select('id').eq('igdb_id', item.id).single();
    if (row) {
      await db.from(junctionTable).upsert(
        { game_id: gameId, [junctionCol]: row.id },
        { onConflict: `game_id,${junctionCol}` }
      );
    }
  }
}

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { igdb_id } = await context.request.json();
  if (!igdb_id) return json({ error: 'Missing igdb_id' }, 400);

  const db = getSupabaseAdmin();

  const { data: existing } = await db
    .from('games')
    .select('id, title, slug, cover_img_url, date_released')
    .eq('igdb_id', igdb_id)
    .maybeSingle();

  if (existing) {
    // Check if any junction data is missing and refresh if so
    const [
      { count: platformCount },
      { count: genreCount },
      { count: themeCount },
      { count: modeCount },
    ] = await Promise.all([
      db.from('game_platforms').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
      db.from('game_genres').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
      db.from('game_themes').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
      db.from('game_game_modes').select('*', { count: 'exact', head: true }).eq('game_id', existing.id),
    ]);

    // Franchises and collections can legitimately be empty, so only check
    // platforms/genres/themes/modes — all games should have at least one of each
    const needsRefresh =
      (platformCount ?? 0) === 0 ||
      (genreCount ?? 0) === 0 ||
      (themeCount ?? 0) === 0 ||
      (modeCount ?? 0) === 0;

    if (needsRefresh) {
      const refresh = await igdbFetch("games", `
        fields genres.id, genres.name, genres.slug,
               platforms.id, platforms.name, platforms.slug,
               themes.id, themes.name, themes.slug,
               game_modes.id, game_modes.name, game_modes.slug,
               franchises.id, franchises.name, franchises.slug,
               collections.id, collections.name, collections.slug;
        where id = ${igdb_id};
        limit 1;
      `);
      const g = refresh?.[0];
      if (g) {
        await Promise.all([
          upsertJunction(db, existing.id, g.genres,     'genres',     'game_genres',     'genre_id'),
          upsertJunction(db, existing.id, g.platforms,  'platforms',  'game_platforms',  'platform_id'),
          upsertJunction(db, existing.id, g.themes,     'themes',     'game_themes',     'theme_id'),
          upsertJunction(db, existing.id, g.game_modes, 'game_modes', 'game_game_modes', 'game_mode_id'),
          upsertJunction(db, existing.id, g.franchises, 'franchises', 'game_franchises', 'franchise_id'),
          upsertJunction(db, existing.id, g.collections,'collections','game_collections','collection_id'),
        ]);
      }
    }

    return json(existing);
  }

  // Fetch full game data from IGDB
  const games = await igdbFetch("games", `
    fields name, slug, summary, storyline, category, status,
           first_release_date, cover.url,
           genres.id, genres.name, genres.slug,
           platforms.id, platforms.name, platforms.slug,
           themes.id, themes.name, themes.slug,
           game_modes.id, game_modes.name, game_modes.slug,
           franchises.id, franchises.name, franchises.slug,
           collections.id, collections.name, collections.slug;
    where id = ${igdb_id};
    limit 1;
  `);

  if (!games || games.length === 0) return json({ error: 'Game not found on IGDB' }, 404);

  const game = games[0];
  const coverUrl = game.cover?.url
    ? `https:${game.cover.url.replace('t_thumb', 't_cover_big')}`
    : null;

  const slug = makeSlug(game.name, game.slug);

  const { data: slugConflict } = await db
    .from('games')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  const finalSlug = slugConflict ? `${slug}-${igdb_id}` : slug;

  const { data: inserted, error: insertError } = await db
    .from('games')
    .insert({
      title:            game.name,
      slug:             finalSlug,
      game_description: game.summary   ?? null,
      storyline:        game.storyline ?? null,
      igdb_category:    game.category  ?? null,
      igdb_status:      game.status    ?? null,
      cover_img_url:    coverUrl,
      date_released:    game.first_release_date
        ? new Date(game.first_release_date * 1000).toISOString().split('T')[0]
        : null,
      igdb_id: game.id,
    })
    .select('id, title, slug, cover_img_url, date_released')
    .single();

  if (insertError) {
    console.error('[import] DB insert error:', JSON.stringify(insertError));
    return json({ error: `Failed to import game: ${insertError.message}` }, 500);
  }

  await Promise.all([
    upsertJunction(db, inserted.id, game.genres,     'genres',     'game_genres',     'genre_id'),
    upsertJunction(db, inserted.id, game.platforms,  'platforms',  'game_platforms',  'platform_id'),
    upsertJunction(db, inserted.id, game.themes,     'themes',     'game_themes',     'theme_id'),
    upsertJunction(db, inserted.id, game.game_modes, 'game_modes', 'game_game_modes', 'game_mode_id'),
    upsertJunction(db, inserted.id, game.franchises, 'franchises', 'game_franchises', 'franchise_id'),
    upsertJunction(db, inserted.id, game.collections,'collections','game_collections','collection_id'),
  ]);

  return json(inserted);
};
