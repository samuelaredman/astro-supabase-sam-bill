/**
 * Probe the IGDB external_games endpoint with a few known Steam appids to
 * figure out why PR #110's bulk query returned nothing. Tries each candidate
 * field name and query shape; prints the response so we can pick the shape
 * that works and codify it in sync.
 *
 * Run: npx tsx scripts/probe-igdb-external-games.ts
 * Requires IGDB_CLIENT_ID + IGDB_CLIENT_SECRET in .env.
 * Makes no writes.
 */

import 'dotenv/config';

const IGDB_URL = 'https://api.igdb.com/v4';

// Known Steam appids for very popular games. If IGDB has Steam coverage at
// all, these should resolve.
const PROBE_APPIDS = [
  220,    // Half-Life 2
  440,    // Team Fortress 2
  730,    // CS:GO / CS2
  570,    // Dota 2
  292030, // The Witcher 3
];

async function getToken(): Promise<string> {
  console.log('[probe] IGDB_CLIENT_ID present:', !!process.env.IGDB_CLIENT_ID);
  console.log('[probe] IGDB_CLIENT_SECRET present:', !!process.env.IGDB_CLIENT_SECRET);
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}` +
      `&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' },
  );
  const text = await res.text();
  console.log('[probe] token response status:', res.status, 'body preview:', text.slice(0, 200));
  const data = JSON.parse(text) as { access_token?: string };
  if (!data.access_token) throw new Error('No access_token in response');
  return data.access_token;
}

async function igdb(token: string, endpoint: string, query: string): Promise<unknown> {
  const res = await fetch(`${IGDB_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': process.env.IGDB_CLIENT_ID!,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: query,
  });
  const text = await res.text();
  if (!res.ok) {
    return { _error: true, status: res.status, body: text };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { _parseError: true, body: text };
  }
}

async function main() {
  const token = await getToken();
  console.log('[probe] got IGDB token');

  // Experiment 1 — single appid, legacy `category` field, ` = ` operator.
  // This is the shape PR #110 used (just with multiple values).
  console.log('\n=== exp1: fields game, uid; where category = 1 & uid = "220";');
  console.log(
    await igdb(
      token,
      'external_games',
      `fields game, uid, category; where category = 1 & uid = "220"; limit 5;`,
    ),
  );

  // Experiment 2 — same shape but with the newer `external_game_source` name.
  // IGDB renamed some category fields in 2024-ish; worth checking if the
  // external_games endpoint moved too.
  console.log('\n=== exp2: fields ..., external_game_source; where external_game_source = 1 & uid = "220";');
  console.log(
    await igdb(
      token,
      'external_games',
      `fields game, uid, external_game_source; where external_game_source = 1 & uid = "220"; limit 5;`,
    ),
  );

  // Experiment 3 — the multi-value shape from PR #110 verbatim. If this works
  // for multiple appids in one call we're done.
  const uidList = PROBE_APPIDS.map((a) => `"${a}"`).join(',');
  console.log(`\n=== exp3: where category = 1 & uid = (${uidList});`);
  console.log(
    await igdb(
      token,
      'external_games',
      `fields game, uid; where category = 1 & uid = (${uidList}); limit 10;`,
    ),
  );

  // Experiment 4 — fallback OR-chain syntax in case the parens-list doesn't
  // work on string fields on this endpoint.
  const orChain = PROBE_APPIDS.map((a) => `uid = "${a}"`).join(' | ');
  console.log(`\n=== exp4: where category = 1 & (${orChain});`);
  console.log(
    await igdb(
      token,
      'external_games',
      `fields game, uid; where category = 1 & (${orChain}); limit 10;`,
    ),
  );

  // Experiment 5 — just dump a single external_games row with ALL fields so we
  // can see what field names the endpoint actually returns.
  console.log('\n=== exp5: fields *; where uid = "220"; limit 3;');
  console.log(
    await igdb(token, 'external_games', `fields *; where uid = "220"; limit 3;`),
  );
}

main().catch((e) => {
  console.error('[probe] fatal:', e);
  process.exit(1);
});
