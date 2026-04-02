import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config() // loads .env file

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
             first_release_date,
             genres.id, genres.name,
             involved_companies.company.id,
             involved_companies.company.name,
             involved_companies.developer,
             involved_companies.publisher;
      where rating_count > 100;
      sort rating_count desc;
      limit 500;
      offset ${offset};
    `
  })
  return res.json()
}

async function upsertCompany(igdbId: number, name: string) {
  const { data } = await supabase
    .from('companies')
    .upsert({ igdb_id: igdbId, name }, { onConflict: 'igdb_id' })
    .select()
    .single()
  return data
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
          game_description: game.summary ?? null,
          cover_img_url: game.cover?.url ?? null,
          date_released: game.first_release_date
            ? new Date(game.first_release_date * 1000).toISOString()
            : null,
        }, { onConflict: 'igdb_id' })
        .select()
        .single()

      if (!newGame) continue

      // insert genres
      for (const genre of game.genres ?? []) {
        const { data: g } = await supabase
          .from('genres')
          .upsert({ igdb_id: genre.id, name: genre.name }, { onConflict: 'igdb_id' })
          .select()
          .single()

        if (g) {
          await supabase
            .from('game_genres')
            .upsert({ game_id: newGame.id, genre_id: g.id }, { onConflict: 'game_id,genre_id' })
        }
      }

      // insert developers and publishers
      for (const ic of game.involved_companies ?? []) {
        if (!ic.company) continue

        const company = await upsertCompany(ic.company.id, ic.company.name)
        if (!company) continue

        if (ic.developer) {
          await supabase
            .from('game_developers')
            .upsert({ game_id: newGame.id, company_id: company.id }, { onConflict: 'game_id,company_id' })
        }

        if (ic.publisher) {
          await supabase
            .from('game_publishers')
            .upsert({ game_id: newGame.id, company_id: company.id }, { onConflict: 'game_id,company_id' })
        }
      }

      total++
      console.log(`Imported: ${game.name}`)
    }

    console.log(`Total imported: ${total}`)
    offset += 500

    // respect IGDB rate limit
    await new Promise(r => setTimeout(r, 250))
  }

  console.log(`Done! Imported ${total} games total.`)
}

importGames()
