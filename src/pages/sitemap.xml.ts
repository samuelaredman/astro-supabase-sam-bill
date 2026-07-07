import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../utils/database';

export const prerender = false;

const BASE = 'https://chekpoint.gg';

type Entry = { url: string; changefreq: string; priority: string };

// Escape the five XML predefined entities so slugs/usernames can't break the doc.
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Supabase caps a single query at 1000 rows and truncates silently. Page through
// with .range() until a short page comes back. `build` runs one ranged query.
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

export const GET: APIRoute = async () => {
  const db = getSupabaseAdmin();

  const staticPages: Entry[] = [
    { url: BASE + '/',                changefreq: 'daily',   priority: '1.0' },
    { url: BASE + '/rankings',        changefreq: 'daily',   priority: '0.8' },
    { url: BASE + '/recommendations', changefreq: 'daily',   priority: '0.8' },
    { url: BASE + '/search',          changefreq: 'weekly',  priority: '0.5' },
    { url: BASE + '/about',           changefreq: 'monthly', priority: '0.4' },
    { url: BASE + '/contact',         changefreq: 'monthly', priority: '0.3' },
    { url: BASE + '/privacy',         changefreq: 'monthly', priority: '0.2' },
    { url: BASE + '/terms',           changefreq: 'monthly', priority: '0.2' },
  ];

  // ── Catalog pages ──────────────────────────────────────────────────────────
  // A game is only indexed once it has ≥1 published review (matches the page's
  // own noindex rule), and a hub (genre/platform/studio) is only indexed once it
  // has ≥1 reviewed game. This keeps bare IGDB stub pages out of the index.
  const reviewRows = await fetchAll<{ game_id: string }>((f, t) =>
    db.from('reviews').select('game_id').eq('status', 'published').range(f, t));
  const reviewedGameIds = new Set(reviewRows.map((r) => r.game_id));

  const [games, genres, platforms, studios] = await Promise.all([
    fetchAll<{ id: string; slug: string | null }>((f, t) =>
      db.from('games').select('id, slug').not('slug', 'is', null).range(f, t)),
    fetchAll<{ id: string; slug: string | null }>((f, t) =>
      db.from('genres').select('id, slug').not('slug', 'is', null).range(f, t)),
    fetchAll<{ id: string; slug: string | null }>((f, t) =>
      db.from('platforms').select('id, slug').not('slug', 'is', null).range(f, t)),
    fetchAll<{ id: string; slug: string | null }>((f, t) =>
      db.from('developers').select('id, slug').not('slug', 'is', null).range(f, t)),
  ]);

  // For each hub type, collect the ids of entities linked to a reviewed game via
  // the junction tables. Chunk the IN filter so the reviewed-game list can't
  // overflow the request. Table name is dynamic, so this one helper is untyped.
  const hubIdsWithReviewedGame = async (table: string, idCol: string): Promise<Set<string>> => {
    const set = new Set<string>();
    const ids = [...reviewedGameIds];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data } = await (db as any).from(table).select(idCol).in('game_id', chunk);
      for (const row of (data ?? []) as Record<string, string>[]) set.add(row[idCol]);
    }
    return set;
  };

  const [devIds, genreIds, platformIds] = reviewedGameIds.size > 0
    ? await Promise.all([
        hubIdsWithReviewedGame('game_companies', 'company_id'),
        hubIdsWithReviewedGame('game_genres', 'genre_id'),
        hubIdsWithReviewedGame('game_platforms', 'platform_id'),
      ])
    : [new Set<string>(), new Set<string>(), new Set<string>()];

  // ── User content: only for authors who opted into search indexing (GDPR) ───
  const consentedProfiles = await fetchAll<{ id: string; username: string }>((f, t) =>
    db.from('profiles').select('id, username').eq('search_indexable', true).range(f, t));
  const consentedIds = consentedProfiles.map((p) => p.id);

  let reviews: { id: string }[] = [];
  let recommendations: { id: string }[] = [];
  let lists: { id: string }[] = [];
  if (consentedIds.length > 0) {
    [reviews, recommendations, lists] = await Promise.all([
      fetchAll<{ id: string }>((f, t) =>
        db.from('reviews').select('id').eq('status', 'published').in('profile_id', consentedIds).range(f, t)),
      // `recommendations` isn't in the generated types yet (types.ts predates that
      // migration), so this table is accessed untyped throughout the codebase.
      fetchAll<{ id: string }>((f, t) =>
        (db as any).from('recommendations').select('id').in('profile_id', consentedIds).range(f, t)),
      fetchAll<{ id: string }>((f, t) =>
        db.from('lists').select('id').eq('visibility', 'public').in('profile_id', consentedIds).range(f, t)),
    ]);
  }

  const dynamic: Entry[] = [
    ...games.filter((g) => reviewedGameIds.has(g.id)).map((g) => ({ url: `${BASE}/games/${g.slug}`, changefreq: 'weekly', priority: '0.7' })),
    ...genres.filter((g) => genreIds.has(g.id)).map((g) => ({ url: `${BASE}/genres/${g.slug}`, changefreq: 'weekly', priority: '0.5' })),
    ...platforms.filter((p) => platformIds.has(p.id)).map((p) => ({ url: `${BASE}/platforms/${p.slug}`, changefreq: 'weekly', priority: '0.5' })),
    ...studios.filter((s) => devIds.has(s.id)).map((s) => ({ url: `${BASE}/studios/${s.slug}`, changefreq: 'weekly', priority: '0.5' })),
    ...consentedProfiles.map((p) => ({ url: `${BASE}/reviewers/${p.username}`, changefreq: 'weekly', priority: '0.6' })),
    ...reviews.map((r) => ({ url: `${BASE}/reviews/${r.id}`, changefreq: 'monthly', priority: '0.6' })),
    ...recommendations.map((r) => ({ url: `${BASE}/recommendations/${r.id}`, changefreq: 'monthly', priority: '0.5' })),
    ...lists.map((l) => ({ url: `${BASE}/lists/${l.id}`, changefreq: 'monthly', priority: '0.5' })),
  ];

  // A single sitemap is valid up to 50,000 URLs / 50MB. If the catalog grows past
  // that, split into per-type sitemaps behind a sitemap index.
  const all = [...staticPages, ...dynamic];

  const urlEntries = all.map((p) => `  <url>
    <loc>${xmlEscape(p.url)}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Netlify-CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
};
