import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.PUBLIC_SUPABASE_URL!,
  process.env.PUBLIC_SUPABASE_ANON_KEY!
)

async function getToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' }
  )
  const data = await res.json()
  return data.access_token
}

async function fetchGames(token: string, offset: number) {
  const res = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': process.env.IGDB_CLIENT_ID!,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain'
    },
    body: `
      fields id, name, slug, summary, cover.url, 
             first_release_date, platforms.name,
             genres.id, genres.name,
             involved_companies.company.name;
      where rating_count > 10;
      sort rating_count desc;
      limit 500;
      offset ${offset};
    `
  })
  return res.json()
}

async function importGames() {
  const token = await getToken()
  let offset = 0
  let total = 0

  while (true) {
    console.log(`Fetching games ${offset} to ${offset + 500}...`)
    const games = await fetchGames(token, offset)

    if (!games.length) break

    for (const game of games) {
      // insert game
      const { data: newGame } = await supabase
        .from('games')
        .upsert({
          igdb_id: game.id,
          title: game.name,
          slug: game.slug,
          description: game.summary,
          cover_image: game.cover?.url,
          developer: game.involved_companies?.[0]?.company?.name ?? null,
          platform: game.platforms?.map((p: any) => p.name).join(', ') ?? null,
          release_date: game.first_release_date
            ? new Date(game.first_release_date * 1000).toISOString()
            : null,
        }, { onConflict: 'igdb_id' })
        .select()
        .single()

      // insert genres
      for (const genre of game.genres ?? []) {
        const { data: g } = await supabase
          .from('genres')
          .upsert({ igdb_id: genre.id, name: genre.name }, { onConflict: 'igdb_id' })
          .select()
          .single()

        await supabase
          .from('game_genres')
          .upsert({ game_id: newGame.id, genre_id: g.id }, { onConflict: 'game_id,genre_id' })
      }

      total++
    }

    console.log(`Imported ${total} games so far...`)
    offset += 500

    // IGDB rate limit — 4 requests per second
    await new Promise(r => setTimeout(r, 250))
  }

  console.log(`Done! Imported ${total} games total.`)
}

importGames()
