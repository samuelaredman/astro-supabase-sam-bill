// Follow-up probe — verify batch IN syntax works with external_game_source.
// Run: npx tsx scripts/probe-igdb-external-games-v2.ts
import 'dotenv/config';
const IGDB_URL = 'https://api.igdb.com/v4';

async function getToken() {
  const r = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' },
  );
  return ((await r.json()) as any).access_token;
}

async function q(token: string, body: string) {
  const r = await fetch(`${IGDB_URL}/external_games`, {
    method: 'POST',
    headers: {
      'Client-ID': process.env.IGDB_CLIENT_ID!,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body,
  });
  return r.ok ? await r.json() : { _error: r.status, body: await r.text() };
}

const token = await getToken();
console.log(
  'IN parens list:',
  await q(
    token,
    `fields game, uid; where external_game_source = 1 & uid = ("220","440","730","570","292030"); limit 10;`,
  ),
);
console.log(
  '\nOR chain:',
  await q(
    token,
    `fields game, uid; where external_game_source = 1 & (uid = "220" | uid = "440" | uid = "730"); limit 10;`,
  ),
);
