/**
 * Read-only audit of probable duplicate studios (`developers` rows that are the
 * same company — IGDB has duplicate company entries and we import both). Matching
 * rules live in src/utils/studioDuplicates.ts.
 *
 * Writes studio-duplicates.csv (one row per studio, grouped) with each studio's
 * game / reviewed-game / review counts and a blank `verdict` column to fill in
 * with keep / same / different, then turned into merges by
 * scripts/build-studio-merges.ts.
 *
 * Run: npx tsx scripts/audit-studio-duplicates.ts [out.csv]
 * Requires SUPABASE_DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.
 * Makes no writes.
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { findStudioDuplicates, type DuplicateConfidence } from '../src/utils/studioDuplicates';
import { countryName } from '../src/utils/country';

const db = createClient(
  process.env.SUPABASE_DATABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const PAGE_SIZE = 1000;

async function fetchAllRows<T>(table: string, columns: string, orderBy: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db.from(table).select(columns)
      .order(orderBy).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${JSON.stringify(error)}`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

type Developer = {
  id: string; name: string; slug: string; igdb_id: number | null;
  country: string | null; founded_year: number | null;
};

const [developers, links, stats] = await Promise.all([
  fetchAllRows<Developer>('developers', 'id, name, slug, igdb_id, country, founded_year', 'id'),
  fetchAllRows<{ company_id: string; game_id: string }>('game_companies', 'company_id, game_id', 'game_id'),
  fetchAllRows<{ game_id: string; review_count: number }>('game_review_stats', 'game_id, review_count', 'game_id'),
]);

const reviewsByGame = new Map(stats.map((s) => [s.game_id, Number(s.review_count)]));
const gamesByStudio = new Map<string, Set<string>>();
for (const l of links) {
  if (!gamesByStudio.has(l.company_id)) gamesByStudio.set(l.company_id, new Set());
  gamesByStudio.get(l.company_id)!.add(l.game_id);
}

function countsFor(id: string) {
  const games = [...(gamesByStudio.get(id) ?? [])];
  const reviewed = games.filter((g) => (reviewsByGame.get(g) ?? 0) > 0);
  return {
    games: games.length,
    reviewedGames: reviewed.length,
    reviews: reviewed.reduce((n, g) => n + reviewsByGame.get(g)!, 0),
  };
}

const RANK: Record<DuplicateConfidence, number> = { high: 0, medium: 1, low: 2 };

const groups = findStudioDuplicates(developers).map((g) => {
  const studios = g.studios
    .map((s) => ({ ...s, ...countsFor(s.id) }))
    .sort((a, b) => b.games - a.games || b.reviews - a.reviews || (a.igdb_id ?? 0) - (b.igdb_id ?? 0));
  return {
    ...g,
    studios,
    // Duplicates only cost anything when more than one row has games.
    linkedRows: studios.filter((s) => s.games > 0).length,
    reviews: studios.reduce((n, s) => n + s.reviews, 0),
  };
}).sort((a, b) =>
  RANK[a.confidence] - RANK[b.confidence]
  || Number(b.linkedRows > 1) - Number(a.linkedRows > 1)
  || b.reviews - a.reviews
  || a.key.localeCompare(b.key));

const csv = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const header = [
  'group', 'confidence', 'suggested', 'name', 'games', 'reviewed_games', 'reviews',
  'country', 'founded', 'igdb_id', 'slug', 'chekpoint_url', 'verdict',
];
const lines = [header.join(',')];
groups.forEach((g, i) => {
  g.studios.forEach((s, j) => {
    lines.push([
      i + 1, g.confidence, j === 0 ? 'keep' : 'merge into keep?', s.name, s.games, s.reviewedGames, s.reviews,
      countryName(s.country) ?? '', s.founded_year ?? '', s.igdb_id ?? '', s.slug,
      `https://chekpoint.gg/studios/${s.slug}`, '',
    ].map(csv).join(','));
  });
});

const out = process.argv[2] ?? 'studio-duplicates.csv';
writeFileSync(out, '﻿' + lines.join('\n') + '\n', 'utf8');

const tally = (c: DuplicateConfidence) => groups.filter((g) => g.confidence === c);
console.log(`${developers.length} studios, ${links.length} game links, ${groups.length} suspected groups → ${out}`);
for (const c of ['high', 'medium', 'low'] as const) {
  const t = tally(c);
  console.log(`  ${c.padEnd(6)} ${String(t.length).padStart(4)} groups, ${t.filter((g) => g.linkedRows > 1).length} where 2+ rows have games, ${t.filter((g) => g.studios.filter((s) => s.reviews > 0).length > 1).length} where 2+ rows have reviews`);
}
