/**
 * Phase 3 — canonical resolution.
 *
 * Computes games.canonical_game_id for every collapse-type row (ports, remasters,
 * bundles, packs, and version_parent editions), folding it into the earliest
 * main_game of its cluster so users review one node instead of many.
 *
 * REPORT-FIRST: by default this makes NO writes — it prints the proposed
 * collapses, the collapse-type rows that stay canonical (orphans), and the
 * low-confidence clusters that need a human call (e.g. Mario Kart / Smash, where
 * IGDB's series links are sparse). Re-run with --apply to write canonical_game_id.
 * canonical_locked rows are never touched. Fully idempotent.
 *
 * Prereqs: migration 20260822000000 applied, and scripts/backfill-game-metadata.ts
 * run (twice) so parent/version columns and relationships are populated.
 *
 * Run from project root:
 *   npx tsx scripts/backfill-canonical.ts            # report only
 *   npx tsx scripts/backfill-canonical.ts --apply    # write canonical_game_id
 *
 * Requires SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  classifyGameType,
  collapseParentCandidates,
  normalizeClusterTitle,
  chooseClusterCanonical,
  GAME_CATEGORIES,
} from '../src/utils/games';

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 1000;

const db = createClient(
  process.env.SUPABASE_DATABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type GameRow = {
  id: string;
  igdb_id: number | null;
  title: string;
  igdb_category: number | null;
  date_released: string | null;
  igdb_parent_game: number | null;
  igdb_version_parent: number | null;
  canonical_game_id: string | null;
  canonical_locked: boolean;
};

async function fetchAllGames(): Promise<GameRow[]> {
  const all: GameRow[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await db
      .from('games')
      .select('id, igdb_id, title, igdb_category, date_released, igdb_parent_game, igdb_version_parent, canonical_game_id, canonical_locked')
      .order('id')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as GameRow[]));
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

const catName = (c: number | null) => (c == null ? 'null' : GAME_CATEGORIES[c] ?? `#${c}`);

async function main() {
  console.log(`Canonical resolution — ${APPLY ? 'APPLY (writing)' : 'REPORT ONLY (no writes)'}\n`);

  const games = await fetchAllGames();
  console.log(`Loaded ${games.length} games.\n`);

  const byIgdbId = new Map<number, GameRow>();
  const byId = new Map<string, GameRow>();
  for (const g of games) {
    byId.set(g.id, g);
    if (g.igdb_id != null) byIgdbId.set(g.igdb_id, g);
  }

  // Exact-title clusters (for the title-fallback path and ambiguity reporting).
  const clustersByTitle = new Map<string, GameRow[]>();
  for (const g of games) {
    const key = normalizeClusterTitle(g.title);
    let cluster = clustersByTitle.get(key);
    if (!cluster) { cluster = []; clustersByTitle.set(key, cluster); }
    cluster.push(g);
  }

  // ── Pass 1: pick a direct collapse target per collapse-type row ──────────────
  type Proposal = { game: GameRow; targetId: string; reason: 'version_parent' | 'parent_game' | 'title_cluster' };
  const directTarget = new Map<string, Proposal>();
  const orphans: GameRow[] = [];           // collapse-type, nothing to fold into → stays canonical
  const lowConfidence: string[] = [];       // needs a human call

  for (const g of games) {
    if (classifyGameType(g.igdb_category) !== 'collapse') continue;
    if (g.canonical_locked) continue;

    // (a) version_parent / parent_game
    let picked: Proposal | null = null;
    const candidates = collapseParentCandidates(g);
    for (let i = 0; i < candidates.length; i++) {
      const target = byIgdbId.get(candidates[i]);
      if (target && target.id !== g.id && classifyGameType(target.igdb_category) !== 'hidden') {
        picked = { game: g, targetId: target.id, reason: i === 0 && g.igdb_version_parent != null ? 'version_parent' : 'parent_game' };
        break;
      }
    }

    // (b) exact-title cluster fallback (identical title across platform rows)
    if (!picked) {
      const cluster = clustersByTitle.get(normalizeClusterTitle(g.title)) ?? [];
      if (cluster.length > 1) {
        const canonicalId = chooseClusterCanonical(cluster);
        if (canonicalId && canonicalId !== g.id) {
          picked = { game: g, targetId: canonicalId, reason: 'title_cluster' };
        }
      }
    }

    if (picked) {
      directTarget.set(g.id, picked);
      if (picked.reason === 'title_cluster') {
        lowConfidence.push(`  [title-fallback] "${g.title}" (${catName(g.igdb_category)}) → ${byId.get(picked.targetId)?.title}`);
      }
    } else {
      orphans.push(g);
    }
  }

  // ── Pass 2: flatten to a single level (follow targets + existing canonicals) ──
  function resolveRoot(id: string, seen: Set<string>): string {
    const next = directTarget.get(id)?.targetId ?? byId.get(id)?.canonical_game_id ?? null;
    if (!next || next === id || seen.has(id)) return id;
    seen.add(id);
    return resolveRoot(next, seen);
  }

  const finals: Array<{ game: GameRow; rootId: string; reason: string }> = [];
  for (const [gameId, p] of directTarget.entries()) {
    const root = resolveRoot(gameId, new Set());
    if (root !== gameId) finals.push({ game: p.game, rootId: root, reason: p.reason });
  }

  // ── Report ───────────────────────────────────────────────────────────────────
  const byReason = new Map<string, number>();
  for (const f of finals) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);

  console.log('── Proposed collapses by reason ──');
  for (const [r, n] of byReason.entries()) console.log(`  ${r}: ${n}`);
  console.log(`  TOTAL: ${finals.length}\n`);

  console.log('── Sample proposals (first 30) ──');
  for (const f of finals.slice(0, 30)) {
    console.log(`  "${f.game.title}" (${catName(f.game.igdb_category)}) → "${byId.get(f.rootId)?.title}"  [${f.reason}]`);
  }

  // Ambiguous title clusters with >1 main_game — likely a series IGDB models flatly
  // (Mario Kart / Smash), where auto-collapse would be wrong.
  console.log('\n── Low-confidence / needs manual review ──');
  let ambiguous = 0;
  for (const [title, members] of clustersByTitle.entries()) {
    const mains = members.filter((m) => m.igdb_category === 0);
    if (members.length > 1 && mains.length > 1) {
      ambiguous++;
      if (ambiguous <= 20) console.log(`  [multi-main cluster] "${title}" — ${mains.length} main_games, ${members.length} rows`);
    }
  }
  for (const line of lowConfidence.slice(0, 20)) console.log(line);
  console.log(`  (ambiguous multi-main clusters: ${ambiguous}; title-fallback collapses: ${lowConfidence.length})`);

  console.log(`\n── Collapse-type rows staying canonical (no parent found): ${orphans.length} ──`);
  for (const o of orphans.slice(0, 20)) console.log(`  "${o.title}" (${catName(o.igdb_category)})`);

  // ── Apply ──────────────────────────────────────────────────────────────────
  if (!APPLY) {
    console.log('\nReport only — no writes. Re-run with --apply once the proposals look right.');
    return;
  }

  console.log(`\nApplying ${finals.length} canonical assignments...`);
  let written = 0;
  for (const f of finals) {
    const { error } = await db.from('games')
      .update({ canonical_game_id: f.rootId })
      .eq('id', f.game.id)
      .eq('canonical_locked', false);
    if (error) console.error(`  error on "${f.game.title}":`, error.message);
    else written++;
  }
  console.log(`Done — ${written}/${finals.length} rows updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
