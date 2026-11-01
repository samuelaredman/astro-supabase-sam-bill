/**
 * Production smoke test for the canonical-studios change. Read-only.
 *
 *   npx tsx scripts/smoke-studios-live.ts before               # 1. before applying the migration
 *   npx tsx scripts/smoke-studios-live.ts after-migration      # 2. after applying it (nothing may have changed)
 *   npx tsx scripts/smoke-studios-live.ts after-merge          # 3. after running a merge file
 *
 * Add --site <url> to also load the real pages (default https://chekpoint.gg;
 * use http://localhost:4321 for the dev server). Run the page checks once the
 * new code is deployed there.
 *
 * `before` saves .smoke-studios-before.json; the other two compare against it.
 * Requires SUPABASE_DATABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY in .env.
 */

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const MODE = process.argv[2];
const SITE_ARG = process.argv.indexOf('--site');
const SITE = SITE_ARG > -1 ? process.argv[SITE_ARG + 1].replace(/\/$/, '') : null;
const SNAPSHOT = '.smoke-studios-before.json';

if (!['before', 'after-migration', 'after-merge'].includes(MODE ?? '')) {
  console.error('Usage: npx tsx scripts/smoke-studios-live.ts before|after-migration|after-merge [--site <url>]');
  process.exit(2);
}

const url = process.env.SUPABASE_DATABASE_URL!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!ok) failures++;
}

async function fetchAllRows<T>(table: string, columns: string, orderBy: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q: any = admin.from(table).select(columns);
    for (const o of orderBy) q = q.order(o);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(`${table}: ${JSON.stringify(error)}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

const hash = (rows: unknown[]) => createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
type Link = { game_id: string; company_id: string; role: string };

// ── Gather ─────────────────────────────────────────────────────────────────
const [links, devs, reviewRows, games] = await Promise.all([
  fetchAllRows<Link>('game_companies', 'game_id, company_id, role', ['game_id', 'company_id', 'role']),
  fetchAllRows<{ id: string; name: string; slug: string }>('developers', 'id, name, slug', ['id']),
  fetchAllRows<{ id: string; game_id: string; score: number; status: string }>('reviews', 'id, game_id, score, status', ['id']),
  fetchAllRows<{ id: string; slug: string | null; canonical_game_id: string | null }>('games', 'id, slug, canonical_game_id', ['id']),
]);
const { data: top } = await (admin as any).rpc('top_studios_by_reviewed_games', { p_limit: 200 });
const topStudioIds: string[] = (top ?? []).slice(0, 40).map((s: any) => s.id);
const hub: Record<string, string> = {};
for (const id of topStudioIds) {
  const { data, error } = await (admin as any).rpc('hub_game_review_stats', { p_company_id: id }).order('game_id');
  hub[id] = error ? `error ${error.message}` : hash(data ?? []);
}

// The joins pages make through Supabase's API, as the anonymous visitor.
// Adding a second link between tables can make these ambiguous; they must keep working.
const reviewedGameIds = [...new Set(reviewRows.filter((r) => r.status === 'published').map((r) => r.game_id))];
const sampleGameId = reviewedGameIds.find((id) => links.some((l) => l.game_id === id && l.role === 'developer'))!;
const embedQueries: Record<string, () => PromiseLike<{ data: any; error: any }>> = {
  'game page: games → game_companies → developers': () =>
    anon.from('games').select('id, game_companies(role, developers(id, name, slug))').eq('id', sampleGameId).maybeSingle(),
  'lists/profile: game_companies → developers(name)': () =>
    anon.from('game_companies').select('game_id, role, developers ( name )').eq('game_id', sampleGameId),
  'library filter: game_companies!inner → developers!inner': () =>
    anon.from('games').select('id, game_companies!inner(role, developers!inner(name))').eq('id', sampleGameId).limit(1),
  'studio page: game_companies → games!inner(reviews!inner)': () =>
    admin.from('game_companies').select('company_id, games!inner(reviews!inner(id))').eq('game_id', sampleGameId).eq('games.reviews.status', 'published').limit(1),
};
const embeds: Record<string, string> = {};
for (const [label, run] of Object.entries(embedQueries)) {
  const { data, error } = await run();
  embeds[label] = error ? `error ${error.code}: ${error.message}` : hash([data]);
}

const current = {
  links: links.length,
  linksHash: hash(links),
  devs: devs.length,
  reviews: reviewRows.length,
  reviewsHash: hash(reviewRows),
  gamesHash: hash(games),
  topHash: hash(top ?? []),
  hub,
  embeds,
  gameRoles: [...new Set(links.map((l) => `${l.game_id}|${l.role}`))].sort(),
  devSlugs: Object.fromEntries(devs.map((d) => [d.id, d.slug])),
};

// ── before ─────────────────────────────────────────────────────────────────
if (MODE === 'before') {
  const embedErrors = Object.entries(embeds).filter(([, v]) => v.startsWith('error'));
  check(embedErrors.length === 0, 'every page join works today (baseline)', embedErrors);
  writeFileSync(SNAPSHOT, JSON.stringify({ takenAt: new Date().toISOString(), ...current }));
  console.log(`\nSnapshot saved to ${SNAPSHOT}: ${links.length} game links, ${devs.length} studios, ${reviewRows.length} reviews.`);
}

if (MODE !== 'before') {
  if (!existsSync(SNAPSHOT)) {
    console.error(`No ${SNAPSHOT} — run "before" first, before applying the migration.`);
    process.exit(2);
  }
  const before = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  console.log(`Comparing with the snapshot from ${before.takenAt}\n`);

  // Shared by both: the migration exists and is locked down.
  const { error: colErr } = await admin.from('developers').select('canonical_developer_id').limit(1);
  check(!colErr, 'developers.canonical_developer_id exists', colErr);
  const { error: anonMerge } = await (anon as any).rpc('merge_developer', { p_duplicate: topStudioIds[0], p_canonical: topStudioIds[1] });
  check(!!anonMerge, 'anonymous visitors cannot call merge_developer', anonMerge ? undefined : 'call was accepted');
  check(current.reviews === before.reviews, `review count unchanged (${current.reviews})`);
  for (const [label, v] of Object.entries(current.embeds)) {
    check(!v.startsWith('error'), `join still works — ${label}`, v);
  }

  if (MODE === 'after-migration') {
    const { count } = await admin.from('developers').select('id', { count: 'exact', head: true }).not('canonical_developer_id', 'is', null);
    check(count === 0, 'no studio is marked as a duplicate yet');
    check(current.links === before.links && current.linksHash === before.linksHash, `every game link identical (${current.links})`);
    check(current.devs === before.devs, `studio count identical (${current.devs})`);
    check(current.topHash === before.topHash, 'top-studios ranking identical');
    const hubDiff = Object.keys(before.hub).filter((id) => current.hub[id] !== before.hub[id]);
    check(hubDiff.length === 0, `review stats identical for the top ${Object.keys(before.hub).length} studios`, hubDiff);
    for (const [label, v] of Object.entries(before.embeds as Record<string, string>)) {
      check(current.embeds[label] === v, `same result as before — ${label}`);
    }
    if (current.reviewsHash !== before.reviewsHash || current.gamesHash !== before.gamesHash) {
      console.log('note  reviews or games changed since the snapshot — expected if people used the site in between; counts above are what matter');
    }
  }

  if (MODE === 'after-merge') {
    const { data: dups } = await admin.from('developers').select('id, slug, canonical_developer_id').not('canonical_developer_id', 'is', null);
    const dupIds = new Set((dups ?? []).map((d) => d.id));
    check(dupIds.size > 0, `${dupIds.size} studios are merged duplicates`);
    check(!links.some((l) => dupIds.has(l.company_id)), 'merged duplicates own no game links');
    const mains = new Set((dups ?? []).map((d) => d.canonical_developer_id));
    check(![...mains].some((id) => dupIds.has(id!)), 'no duplicate points at another duplicate');
    // Every (game, role) that had a studio before still has one. New games added
    // since the snapshot only add pairs, so compare in one direction.
    const now = new Set(current.gameRoles);
    const lost = (before.gameRoles as string[]).filter((k) => !now.has(k) && games.some((g) => g.id === k.split('|')[0]));
    check(lost.length === 0, 'no game lost its developer or publisher', lost.slice(0, 5));

    if (SITE) {
      for (const d of (dups ?? []).slice(0, 5)) {
        const res = await fetch(`${SITE}/studios/${d.slug}`, { redirect: 'manual' });
        const target = res.headers.get('location') ?? '';
        const mainSlug = current.devSlugs[d.canonical_developer_id!];
        check(res.status === 301 && target.endsWith(`/studios/${mainSlug}`), `/studios/${d.slug} → 301 /studios/${mainSlug}`, `${res.status} ${target}`);
      }
    }
  }
}

// ── Real pages ───────────────────────────────────────────────────────────────
if (SITE) {
  console.log(`\nLoading pages on ${SITE}`);
  const gameSlug = games.find((g) => g.id === sampleGameId)?.slug;
  const topStudio = (top ?? [])[0];
  const pages: [string, (html: string) => boolean][] = [
    ['/', (h) => h.includes('Chekpoint')],
    [`/games/${gameSlug}`, (h) => h.includes('/studios/')],
    [`/studios/${topStudio.slug}`, (h) => h.includes(topStudio.name.replace(/&/g, '&amp;'))],
    [`/search?q=${encodeURIComponent(topStudio.name.slice(0, 6))}&tab=studios`, (h) => h.includes(`/studios/${topStudio.slug}`)],
    ['/search?tab=studios', (h) => h.includes('/studios/')],
    ['/sitemap.xml', (h) => h.includes('/studios/') && h.includes('/games/')],
    ['/rankings', (h) => h.includes('/games/')],
  ];
  for (const [path, ok] of pages) {
    const res = await fetch(`${SITE}${path}`, { redirect: 'manual' });
    const body = res.status === 200 ? await res.text() : '';
    check(res.status === 200 && ok(body), `${path} loads (${res.status})`, res.status !== 200 ? res.headers.get('location') : 'expected content missing');
  }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
