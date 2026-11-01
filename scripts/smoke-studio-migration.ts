/**
 * Dry run of the canonical-studios change against a full local copy of the real
 * data, before anything touches production. Read-only on Supabase: it copies
 * studios, game links, games and published review scores (no review text) into
 * an in-memory PGlite database, then checks, in order:
 *
 *   1. Migration alone changes nothing: every game link, every studio's review
 *      stats and the top-studios ranking are identical before and after, and
 *      the migration can be applied twice.
 *   2. Existing write patterns still work (import upserts, new links, deleting
 *      a game or a studio).
 *   3. A real merge of every "high" duplicate group, run through the actual
 *      generated merge file: no game loses a studio, no link is invented,
 *      reviews and games are untouched, and studios outside the merge keep
 *      identical stats.
 *   4. The merge file's rollback restores every link exactly.
 *
 * The two SQL functions and the view are copied verbatim from production.
 *
 * Run: npx tsx scripts/smoke-studio-migration.ts
 * Requires SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { PGlite } from '@electric-sql/pglite';
import { findStudioDuplicates } from '../src/utils/studioDuplicates';

const MIGRATION = 'supabase/migrations/20261031000005_canonical-developers.sql';

const remote = createClient(
  process.env.SUPABASE_DATABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function fetchAllRows<T>(table: string, columns: string, orderBy: string, filter?: (q: any) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = remote.from(table).select(columns).order(orderBy).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${JSON.stringify(error)}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!ok) failures++;
}
async function throws(fn: () => Promise<unknown>, label: string) {
  try { await fn(); check(false, label, 'did not raise'); }
  catch (e: any) { check(true, `${label} (${String(e.message).split('\n')[0]})`); }
}

process.on('unhandledRejection', (e: any) => {
  console.error(`
CRASHED: ${e?.message ?? e}${e?.query ? `
  query: ${String(e.query).slice(0, 300)}` : ''}`);
  process.exit(1);
});

// ── 0. Copy production data ─────────────────────────────────────────────────
console.log('Copying data from Supabase (read-only)…');
type Dev = { id: string; name: string; slug: string; igdb_id: number | null };
type Link = { game_id: string; company_id: string; role: string };
type Game = { id: string; title: string };
type Review = { id: string; game_id: string; score: number; status: string; play_time_hours: number | null };

const [devs, links, games, reviews] = await Promise.all([
  fetchAllRows<Dev>('developers', 'id, name, slug, igdb_id', 'id'),
  fetchAllRows<Link>('game_companies', 'game_id, company_id, role', 'game_id'),
  fetchAllRows<Game>('games', 'id, title', 'id'),
  fetchAllRows<Review>('reviews', 'id, game_id, score, status, play_time_hours', 'id', (q) => q.eq('status', 'published')),
]);
console.log(`  ${devs.length} studios, ${links.length} game links, ${games.length} games, ${reviews.length} published reviews\n`);

const db = new PGlite();
const q = async <T = any>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

// Production shape of the tables involved (columns the change reads or writes,
// with the real keys, constraints and foreign keys).
await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE games (id uuid PRIMARY KEY, title text NOT NULL);
  CREATE TABLE reviews (
    id uuid PRIMARY KEY, game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    score numeric(4,1) NOT NULL, status text NOT NULL, play_time_hours smallint
  );
  CREATE TABLE developers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE, slug text NOT NULL UNIQUE, igdb_id int
  );
  CREATE TABLE game_companies (
    game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role = ANY (ARRAY['developer','publisher','supporting'])),
    PRIMARY KEY (game_id, company_id, role)
  );

  -- Verbatim from production.
  CREATE VIEW game_review_stats AS
   SELECT game_id,
      count(*)::integer AS review_count,
      sum(score)::integer AS score_sum,
      sum(score)::double precision / count(*)::double precision AS avg_score,
      count(*) FILTER (WHERE play_time_hours > 0)::integer AS hours_count,
      COALESCE(sum(play_time_hours) FILTER (WHERE play_time_hours > 0), 0::bigint)::integer AS hours_sum
     FROM reviews
    WHERE status = 'published'::text
    GROUP BY game_id;

  CREATE OR REPLACE FUNCTION public.hub_game_review_stats(p_genre_id uuid DEFAULT NULL::uuid, p_platform_id uuid DEFAULT NULL::uuid, p_company_id uuid DEFAULT NULL::uuid)
   RETURNS TABLE(game_id uuid, review_count integer, score_sum integer)
   LANGUAGE sql STABLE
  AS $function$
    SELECT s.game_id, s.review_count, s.score_sum
    FROM game_review_stats s
    WHERE (p_company_id IS NULL OR EXISTS (
            SELECT 1 FROM game_companies x WHERE x.game_id = s.game_id AND x.company_id = p_company_id));
  $function$;

  CREATE OR REPLACE FUNCTION public.top_studios_by_reviewed_games(p_limit integer DEFAULT 24)
   RETURNS TABLE(id uuid, name text, slug text, reviewed_game_count integer)
   LANGUAGE sql STABLE
  AS $function$
    SELECT d.id, d.name, d.slug, count(*)::int AS reviewed_game_count
    FROM game_review_stats s
    JOIN game_companies gc ON gc.game_id = s.game_id AND gc.role = 'developer'
    JOIN developers d ON d.id = gc.company_id
    GROUP BY d.id, d.name, d.slug
    ORDER BY reviewed_game_count DESC, d.name
    LIMIT p_limit;
  $function$;
`);
// (hub_game_review_stats' genre/platform branches are omitted: they don't read
// studios, and the copy has no genre/platform tables.)

async function insertAll(table: string, cols: string[], rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const params: unknown[] = [];
    const values = chunk.map((r) => `(${cols.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(',')})`);
    await db.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${values.join(',')}`, params);
  }
}
await insertAll('games', ['id', 'title'], games);
await insertAll('reviews', ['id', 'game_id', 'score', 'status', 'play_time_hours'], reviews);
await insertAll('developers', ['id', 'name', 'slug', 'igdb_id'], devs);
await insertAll('game_companies', ['game_id', 'company_id', 'role'], links);

// ── Snapshots ────────────────────────────────────────────────────────────────
const linkSnapshot = async () =>
  (await q<{ s: string }>(`SELECT string_agg(concat_ws('|', game_id, company_id, role), ',' ORDER BY game_id, company_id, role) s FROM game_companies`))[0].s;
const reviewSnapshot = async () =>
  (await q<{ s: string }>(`SELECT md5(string_agg(concat_ws('|', id, game_id, score, status, play_time_hours), ',' ORDER BY id)) s FROM reviews`))[0].s;
const gameSnapshot = async () =>
  (await q<{ s: string }>(`SELECT md5(string_agg(concat_ws('|', id, title), ',' ORDER BY id)) s FROM games`))[0].s;
// Every studio's hub stats as the studio page computes them.
const hubStats = async () => {
  const rows = await q<{ company_id: string; n: number; reviews: number; score: number }>(`
    SELECT d.id company_id, count(h.game_id)::int n, coalesce(sum(h.review_count), 0)::int reviews, coalesce(sum(h.score_sum), 0)::int score
    FROM developers d LEFT JOIN LATERAL hub_game_review_stats(p_company_id => d.id) h ON true
    GROUP BY d.id`);
  return new Map(rows.map((r) => [r.company_id, `${r.n}/${r.reviews}/${r.score}`]));
};
const topStudios = async () => JSON.stringify(await q(`SELECT * FROM top_studios_by_reviewed_games(100000)`));

const before = {
  links: await linkSnapshot(), reviews: await reviewSnapshot(), games: await gameSnapshot(),
  hub: await hubStats(), top: await topStudios(),
};
check(links.length === (await q(`SELECT count(*)::int n FROM game_companies`))[0].n, 'copy has every production game link');

// ── 1. Migration alone changes nothing ───────────────────────────────────────
console.log('\n1. Applying the migration');
const migration = readFileSync(MIGRATION, 'utf8');
await db.exec(migration);
await db.exec(migration);
check(true, 'migration applies, and applies again (re-runnable)');

check((await q(`SELECT count(*)::int n FROM developers WHERE canonical_developer_id IS NOT NULL`))[0].n === 0, 'no studio is marked as a duplicate yet');
check(await linkSnapshot() === before.links, 'all game links identical');
check(await reviewSnapshot() === before.reviews, 'reviews identical');
check(await gameSnapshot() === before.games, 'games identical');
const hubAfterMigration = await hubStats();
const hubDiffs = [...before.hub].filter(([id, v]) => hubAfterMigration.get(id) !== v);
check(hubDiffs.length === 0, `every studio's review stats identical (${before.hub.size} studios)`, hubDiffs.slice(0, 5));
check(await topStudios() === before.top, 'top-studios ranking identical');

const grants = await q<{ grantee: string }>(`
  SELECT grantee FROM information_schema.routine_privileges WHERE routine_name = 'merge_developer' AND privilege_type = 'EXECUTE'`);
const granted = grants.map((g) => g.grantee);
check(!granted.includes('anon') && !granted.includes('authenticated') && !granted.includes('PUBLIC') && granted.includes('service_role'),
  'merge_developer is callable only by the service role', granted);

// ── 2. Existing write patterns still work ────────────────────────────────────
console.log('\n2. Existing write patterns');
await db.exec('BEGIN');
const someDev = devs[0];
await q(`INSERT INTO developers (name, slug, igdb_id) VALUES ('Smoke Test Studio', 'smoke-test-studio', -1)`);
check((await q(`SELECT 1 FROM developers WHERE slug = 'smoke-test-studio'`)).length === 1, 'a new studio can be inserted');
await q(`UPDATE developers SET name = name || ' (renamed)' WHERE id = $1`, [someDev.id]);
check(true, 'a studio can be renamed');
const newDev = (await q<{ id: string }>(`SELECT id FROM developers WHERE slug = 'smoke-test-studio'`))[0].id;
await q(`INSERT INTO game_companies VALUES ($1, $2, 'developer')`, [games[0].id, newDev]);
check((await q(`SELECT 1 FROM game_companies WHERE game_id = $1 AND company_id = $2`, [games[0].id, newDev])).length === 1, 'a game link to a normal studio is stored as written');
await q(`INSERT INTO game_companies VALUES ($1, $2, 'developer') ON CONFLICT DO NOTHING`, [games[0].id, newDev]);
check(true, 'repeating it as an upsert is a no-op, as before');
const gameWithLinks = links[0].game_id;
await q(`DELETE FROM games WHERE id = $1`, [gameWithLinks]);
check((await q(`SELECT 1 FROM game_companies WHERE game_id = $1`, [gameWithLinks])).length === 0, 'deleting a game still removes its links');
await q(`DELETE FROM developers WHERE id = $1`, [newDev]);
check(true, 'deleting a studio still works');
await db.exec('ROLLBACK');
check(await linkSnapshot() === before.links, 'all of the above rolled back cleanly');

// ── 3. Real merge of every "high" group, through the generated file ─────────
console.log('\n3. Merging every "high" duplicate group');
const linkCount = new Map<string, number>();
for (const l of links) linkCount.set(l.company_id, (linkCount.get(l.company_id) ?? 0) + 1);
const groups = findStudioDuplicates(devs).filter((g) => g.confidence === 'high');
const canonOf = new Map<string, string>();
const csvLines = ['group,name,slug,verdict'];
const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
groups.forEach((g, i) => {
  const sorted = [...g.studios].sort((a, b) => (linkCount.get(b.id) ?? 0) - (linkCount.get(a.id) ?? 0));
  sorted.forEach((s, j) => {
    csvLines.push([i + 1, esc(s.name), esc(s.slug), j === 0 ? 'keep' : 'same'].join(','));
    canonOf.set(s.id, sorted[0].id);
  });
});
const work = mkdtempSync(join(tmpdir(), 'studio-smoke-'));
writeFileSync(join(work, 'verdicts.csv'), csvLines.join('\n'));
execFileSync('npx', ['tsx', 'scripts/build-studio-merges.ts', join(work, 'verdicts.csv'), join(work, 'merge.sql')], { stdio: 'inherit', shell: true });
const mergeSql = readFileSync(join(work, 'merge.sql'), 'utf8');

await db.exec(mergeSql);
await db.exec(mergeSql);
check(true, `generated merge file runs, and runs again (${groups.length} groups)`);

const dupIds = [...canonOf].filter(([id, c]) => id !== c).map(([id]) => id);
const pointers = await q<{ id: string; c: string }>(`SELECT id, canonical_developer_id c FROM developers WHERE canonical_developer_id IS NOT NULL`);
check(pointers.length === dupIds.length && pointers.every((p) => canonOf.get(p.id) === p.c), `exactly the ${dupIds.length} duplicates point at their main studio`);
check((await q(`SELECT count(*)::int n FROM game_companies WHERE company_id = ANY($1::uuid[])`, [dupIds]))[0].n === 0, 'duplicates own no game links');

// Every game keeps the same studios per role, with duplicates read as their main studio.
const expected = new Set(links.map((l) => `${l.game_id}|${canonOf.get(l.company_id) ?? l.company_id}|${l.role}`));
const actual = new Set((await q<Link>(`SELECT game_id, company_id, role FROM game_companies`)).map((l) => `${l.game_id}|${l.company_id}|${l.role}`));
const lost = [...expected].filter((k) => !actual.has(k));
const invented = [...actual].filter((k) => !expected.has(k));
check(lost.length === 0, 'no game lost a studio link', lost.slice(0, 5));
check(invented.length === 0, 'no studio link was invented', invented.slice(0, 5));
check(await reviewSnapshot() === before.reviews, 'reviews untouched by merging');
check(await gameSnapshot() === before.games, 'games untouched by merging');

const hubAfterMerge = await hubStats();
const involved = new Set(canonOf.keys());
const outsideDiffs = [...before.hub].filter(([id, v]) => !involved.has(id) && hubAfterMerge.get(id) !== v);
check(outsideDiffs.length === 0, 'studios outside the merge keep identical review stats', outsideDiffs.slice(0, 5));

// A main studio's stats now cover the union of its group's games.
const statsByGame = new Map((await q<{ game_id: string; review_count: number }>(`SELECT game_id, review_count FROM game_review_stats`)).map((r) => [r.game_id, r.review_count]));
const mainMismatch: string[] = [];
for (const mainId of new Set(canonOf.values())) {
  const groupGames = new Set(links.filter((l) => canonOf.get(l.company_id) === mainId).map((l) => l.game_id));
  const reviewed = [...groupGames].filter((g) => statsByGame.has(g));
  const want = `${reviewed.length}/${reviewed.reduce((n, g) => n + statsByGame.get(g)!, 0)}`;
  const got = hubAfterMerge.get(mainId)!.split('/').slice(0, 2).join('/');
  if (want !== got) mainMismatch.push(`${mainId}: want ${want} got ${got}`);
}
check(mainMismatch.length === 0, 'each main studio\'s stats = all games from its group', mainMismatch.slice(0, 5));

// Imports after the merge: a link written to a duplicate lands on the main studio.
const [dupId] = dupIds;
const freshGame = games.find((g) => !links.some((l) => l.game_id === g.id))!;
await db.exec('BEGIN');
await q(`INSERT INTO game_companies VALUES ($1, $2, 'publisher') ON CONFLICT (game_id, company_id, role) DO NOTHING`, [freshGame.id, dupId]);
const landed = await q<{ company_id: string }>(`SELECT company_id FROM game_companies WHERE game_id = $1`, [freshGame.id]);
check(landed.length === 1 && landed[0].company_id === canonOf.get(dupId), 'a later import linking a duplicate lands on the main studio');
await db.exec('ROLLBACK');

await throws(() => q(`SELECT merge_developer($1, $2)`, [canonOf.get(dupId), dupId]), 'merging a main studio into its own duplicate is refused');

// ── 4. Rollback ──────────────────────────────────────────────────────────────
console.log('\n4. Rolling back with the merge file\'s own rollback');
const rollback = mergeSql.split('\n').filter((l) => l.startsWith('--    ')).map((l) => l.slice(6)).join('\n');
await db.exec(rollback);
check(await linkSnapshot() === before.links, 'every original game link restored exactly');
check((await q(`SELECT count(*)::int n FROM developers WHERE canonical_developer_id IS NOT NULL`))[0].n === 0, 'no duplicate pointers left');
const hubAfterRollback = await hubStats();
check([...before.hub].every(([id, v]) => hubAfterRollback.get(id) === v), 'every studio\'s review stats back to the original');

// ── 5. Removing the migration itself ─────────────────────────────────────────
console.log('\n5. Rolling back the migration itself');
const headerLines = migration.split('\n');
const rollbackStart = headerLines.findIndex((l) => l.includes('ROLLBACK'));
const rollbackEnd = headerLines.findIndex((l, i) => i > rollbackStart && l.startsWith('-- ─'));
const schemaRollback = headerLines.slice(rollbackStart + 1, rollbackEnd)
  .filter((l) => l.startsWith('--    ')).map((l) => l.slice(6)).join('\n');
await db.exec(schemaRollback);
check((await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'developers' AND column_name = 'canonical_developer_id'`)).length === 0, 'column removed');
check((await q(`SELECT 1 FROM pg_proc WHERE proname IN ('merge_developer', 'game_companies_use_canonical_developer', 'enforce_developer_canonical_single_level')`)).length === 0, 'functions removed');
check((await q(`SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('developers'::regclass, 'game_companies'::regclass)`)).length === 0, 'triggers removed');
check(await linkSnapshot() === before.links && await topStudios() === before.top, 'data and stats exactly as before the migration');
await db.exec(migration);
check(true, 'migration can be applied again after a rollback');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
