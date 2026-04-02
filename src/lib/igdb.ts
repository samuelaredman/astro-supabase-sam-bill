export async function getIGDBToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${import.meta.env.IGDB_CLIENT_ID}&client_secret=${import.meta.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' }
  )
  const data = await res.json()
  return data.access_token
}

export async function fetchFromIGDB(endpoint: string, body: string) {
  const token = await getIGDBToken()

  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': import.meta.env.IGDB_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain'
    },
    body
  })

  return res.json()
}
