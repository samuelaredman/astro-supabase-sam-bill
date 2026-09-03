/**
 * Phase 4 — review reconciliation (the one irreversible step).
 *
 * After canonical_game_id has been applied (scripts/backfill-canonical.ts --apply),
 * reviews may sit on rows that are now collapsed editions. This script:
 *   1. Seeds game_revisions: a 'release' revision per canonical game that has
 *      reviews, plus one revision per collapsed edition row that has reviews
 *      (kind = remaster_merge for remasters, else edition), keyed on the edition's
 *      igdb_id so re-runs never duplicate.
 *   2. Moves each review's game_id to the canonical game and assigns revision_id:
 *      reviews originally on the canonical row → its 'release' revision; reviews
 *      on an edition row → that edition's revision. Dated-history means a user's
 *      base and edition reviews become DISTINCT revisions, so nothing collides.
 *   3. Backfills revision_id = 'release' for published reviews already resident on
 *      a canonical row (so every published review has a non-null revision_id, which
 *      the Phase 4 per-revision unique index requires).
 *
 * SAFE BY DEFAULT — dry-run prints a full manifest and a collision pre-check and
 * writes NOTHING. Re-run with --apply to write. Fully idempotent.
 *
 * REQUIRED ORDER (irreversible — snapshot the reviews table first):
 *   1. Migration: DROP the old reviews_one_published_per_game index.
 *   2. npx tsx scripts/reconcile-reviews.ts --apply
 *   3. Migration: ADD unique (profile_id, game_id, revision_id) WHERE published.
 * The old index MUST be dropped before --apply, or moving an edition review onto a
 * canonical game that the same user already reviewed will be rejected.
 *
 * Run from project root:
 *   npx tsx scripts/reconcile-reviews.ts            # dry-run manifest
 *   npx tsx scripts/reconcile-reviews.ts --apply    # write
 *
 * Requires SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { revisionKindForEdition, type GameRevisionKind } from '../src/utils/games';

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 1000;

const db = createClient(
  process.env.SUPABASE_DATABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type GameRow = {
  id: string;
  canonical_game_id: string | null;
  igdb_id: number | null;
  igdb_category: number | null;
  title: string;
  version_title: string | null;
  date_released: string | null;
};
type ReviewRow = {
  id: string;
  profile_id: string;
  game_id: string;
  status: string;
  revision_id: string | null;
};
type RevisionRow = { id: string; game_id: string; kind: string; igdb_ref: number | null; label: string | null };

async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const all: T[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await build(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

// Natural keys so re-runs are idempotent and dry-run can group without ids.
const releaseKey = (canonicalId: string) => `${canonicalId}|release`;
const editionKey = (canonicalId: string, edition: GameRow) =>
  edition.igdb_id != null
    ? `${canonicalId}|ed|ref:${edition.igdb_id}`
    : `${canonicalId}|ed|row:${edition.id}`;

async function main() {
  console.log(`Review reconciliation — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  const games = await fetchAll<GameRow>((from, to) =>
    db.from('games')
      .select('id, canonical_game_id, igdb_id, igdb_category, title, version_title, date_released')
      .order('id').range(from, to));
  const reviews = await fetchAll<ReviewRow>((from, to) =>
    db.from('reviews').select('id, profile_id, game_id, status, revision_id').order('id').range(from, to));
  const existingRevisions = await fetchAll<RevisionRow>((from, to) =>
    db.from('game_revisions').select('id, game_id, kind, igdb_ref, label').order('id').range(from, to));

  const byId = new Map<string, GameRow>(games.map((g) => [g.id, g]));
  const canonicalOf = (g: GameRow) => g.canonical_game_id ?? g.id;

  // Map existing revisions by natural key so we don't recreate them.
  const revIdByKey = new Map<string, string>();
  for (const r of existingRevisions) {
    const key = r.kind === 'release'
      ? releaseKey(r.game_id)
      : (r.igdb_ref != null ? `${r.game_id}|ed|ref:${r.igdb_ref}` : `${r.game_id}|ed|lbl:${r.label ?? ''}`);
    revIdByKey.set(key, r.id);
  }

  // ── Plan revisions + review assignments ──────────────────────────────────────
  type RevSpec = { key: string; game_id: string; kind: GameRevisionKind; igdb_ref: number | null; label: string | null; released_at: string | null };
  const neededRevs = new Map<string, RevSpec>();
  type Assign = { review: ReviewRow; targetGameId: string; revKey: string; moved: boolean };
  const assignments: Assign[] = [];
  let skippedMissingGame = 0;

  for (const rev of reviews) {
    const g = byId.get(rev.game_id);
    if (!g) { skippedMissingGame++; continue; }
    const canonicalId = canonicalOf(g);
    const isEdition = g.canonical_game_id != null;

    let revKey: string;
    if (isEdition) {
      revKey = editionKey(canonicalId, g);
      if (!neededRevs.has(revKey)) {
        neededRevs.set(revKey, {
          key: revKey, game_id: canonicalId, kind: revisionKindForEdition(g.igdb_category),
          igdb_ref: g.igdb_id, label: g.version_title ?? g.title, released_at: g.date_released,
        });
      }
    } else {
      revKey = releaseKey(canonicalId);
      if (!neededRevs.has(revKey)) {
        const canon = byId.get(canonicalId);
        neededRevs.set(revKey, {
          key: revKey, game_id: canonicalId, kind: 'release',
          igdb_ref: canon?.igdb_id ?? null, label: null, released_at: canon?.date_released ?? null,
        });
      }
    }
    assignments.push({ review: rev, targetGameId: canonicalId, revKey, moved: isEdition });
  }

  // Revisions that don't already exist:
  const revsToCreate = [...neededRevs.values()].filter((r) => !revIdByKey.has(r.key));

  // ── Collision pre-check against the future unique (profile, game, revision) ──
  const publishedGroups = new Map<string, number>();
  for (const a of assignments) {
    if (a.review.status !== 'published') continue;
    const k = `${a.review.profile_id}|${a.targetGameId}|${a.revKey}`;
    publishedGroups.set(k, (publishedGroups.get(k) ?? 0) + 1);
  }
  const collisions = [...publishedGroups.entries()].filter(([, n]) => n > 1);

  const movedCount = assignments.filter((a) => a.moved).length;
  const backfillCount = assignments.filter((a) => !a.moved && a.review.revision_id == null).length;

  // ── Manifest ─────────────────────────────────────────────────────────────────
  console.log(`Games: ${games.length}  Reviews: ${reviews.length}  Existing revisions: ${existingRevisions.length}`);
  console.log(`Revisions to create: ${revsToCreate.length}`);
  console.log(`  release: ${revsToCreate.filter((r) => r.kind === 'release').length}`);
  console.log(`  edition/remaster_merge: ${revsToCreate.filter((r) => r.kind !== 'release').length}`);
  console.log(`Reviews to MOVE to canonical (game_id change): ${movedCount}`);
  console.log(`Published reviews needing revision_id backfill (already canonical): ${backfillCount}`);
  if (skippedMissingGame > 0) console.log(`Reviews skipped (game_id not found): ${skippedMissingGame}`);

  console.log('\n── Sample edition-review moves (first 25) ──');
  for (const a of assignments.filter((x) => x.moved).slice(0, 25)) {
    const from = byId.get(a.review.game_id);
    console.log(`  review ${a.review.id.slice(0, 8)} "${from?.title}" → canonical ${byId.get(a.targetGameId)?.title} [${a.revKey.split('|').slice(1).join('|')}]`);
  }

  console.log(`\n── Collision pre-check (must be ZERO before --apply): ${collisions.length} ──`);
  for (const [k, n] of collisions.slice(0, 20)) console.log(`  ${n}× ${k}`);
  if (collisions.length > 0) {
    console.error('\n⛔ Collisions found — two published reviews would map to the same (profile, game, revision).');
    console.error('   Resolve these (keep latest per group) before applying. NOT writing.');
    if (APPLY) process.exit(1);
  }

  if (!APPLY) {
    console.log('\nDry run — no writes. Snapshot `reviews`, drop the old index, then re-run with --apply.');
    return;
  }

  // ── Apply ────────────────────────────────────────────────────────────────────
  console.log(`\nCreating ${revsToCreate.length} revisions...`);
  for (const spec of revsToCreate) {
    const { data, error } = await db.from('game_revisions')
      .insert({ game_id: spec.game_id, kind: spec.kind, igdb_ref: spec.igdb_ref, label: spec.label, released_at: spec.released_at })
      .select('id').single();
    if (error) { console.error(`  revision insert error (${spec.key}):`, error.message); continue; }
    revIdByKey.set(spec.key, data.id);
  }

  console.log(`Updating ${assignments.length} reviews...`);
  let updated = 0;
  for (const a of assignments) {
    const revId = revIdByKey.get(a.revKey);
    const patch: Record<string, unknown> = { game_id: a.targetGameId };
    // Only stamp revision_id on published reviews (drafts get it at publish time).
    if (a.review.status === 'published') patch.revision_id = revId ?? a.review.revision_id;
    const { error } = await db.from('reviews').update(patch).eq('id', a.review.id);
    if (error) console.error(`  review ${a.review.id} update error:`, error.message);
    else updated++;
  }
  console.log(`Done — ${updated}/${assignments.length} reviews updated. Now add the per-revision unique index.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
