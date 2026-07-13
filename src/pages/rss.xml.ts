import type { APIRoute } from 'astro';
import { getSupabaseAdmin } from '../utils/database';
import { igdbImage } from '../utils/format';

export const prerender = false;

const BASE = 'https://chekpoint.gg';
// Number of most-recent reviews to include. Feed readers/aggregators only need a
// rolling window; the sitemap is the complete index.
const FEED_SIZE = 50;
// Excerpt length for the "first few lines" shown before the Read more link.
const EXCERPT_CHARS = 300;

// Escape the five XML predefined entities for plain-text nodes (titles, links).
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// CDATA can't contain the literal sequence "]]>"; split any occurrence so the
// review body can't terminate the section early.
function cdata(html: string): string {
  return `<![CDATA[${html.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

// Truncate to the last word boundary within `max` chars, collapsing whitespace.
function excerpt(body: string, max: number): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// Escape only what breaks HTML content (for the CDATA-wrapped description body).
function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

type ReviewRow = {
  id: string;
  title: string | null;
  body: string;
  published_at: string | null;
  created_at: string | null;
  games: { title: string; slug: string | null; cover_img_url: string | null } | null;
  profiles: { username: string; search_indexable: boolean } | null;
};

export const GET: APIRoute = async () => {
  const db = getSupabaseAdmin();

  // GDPR: only surface content from authors who affirmatively opted into search
  // indexing (profiles.search_indexable, default false). This mirrors the gate
  // in sitemap.xml.ts — an author who hasn't consented never appears in the feed.
  // profiles!inner + a filter on the embedded column drops non-consented authors
  // at the query level. Safe under the admin client (RLS does not apply).
  const { data, error } = await (db as any)
    .from('reviews')
    .select(`
      id, title, body, published_at, created_at,
      games ( title, slug, cover_img_url ),
      profiles!inner ( username, search_indexable )
    `)
    .eq('status', 'published')
    .eq('profiles.search_indexable', true)
    .order('published_at', { ascending: false })
    .limit(FEED_SIZE);

  if (error) {
    console.error('[rss.xml] reviews query error:', JSON.stringify(error));
    return new Response('Error generating feed', { status: 500 });
  }

  const reviews = (data ?? []) as ReviewRow[];

  const items = reviews
    .map((r) => {
      const game = r.games?.title ?? 'a game';
      const author = r.profiles?.username ?? 'A reviewer';
      // reviews.title is nullable at the DB level (older rows predate the
      // required-title rule), so fall back to a descriptive title.
      const title = r.title?.trim() || `${author} reviewed ${game}`;
      const link = `${BASE}/reviews/${r.id}`;
      const date = r.published_at ?? r.created_at;
      const pubDate = date ? new Date(date).toUTCString() : new Date().toUTCString();
      const cover = igdbImage(r.games?.cover_img_url, 't_cover_big');

      // description: game cover + first few lines + a Read more link. Wrapped in
      // CDATA so the HTML survives ingestion by readers that render descriptions.
      const parts: string[] = [];
      if (cover) {
        parts.push(`<p><img src="${cover}" alt="${htmlEscape(game)} cover" /></p>`);
      }
      parts.push(`<p>${htmlEscape(excerpt(r.body, EXCERPT_CHARS))}</p>`);
      parts.push(`<p><a href="${link}">Read more on Chekpoint</a></p>`);
      const description = cdata(parts.join(''));

      // media:content advertises the cover to aggregators that render a card
      // thumbnail rather than parsing the description HTML.
      const media = cover
        ? `\n      <media:content url="${xmlEscape(cover)}" medium="image" />`
        : '';

      return `    <item>
      <title>${xmlEscape(title)}</title>
      <link>${xmlEscape(link)}</link>
      <guid isPermaLink="true">${xmlEscape(link)}</guid>
      <dc:creator>${xmlEscape(author)}</dc:creator>
      <pubDate>${pubDate}</pubDate>
      <description>${description}</description>${media}
    </item>`;
    })
    .join('\n');

  const lastBuild = reviews[0]?.published_at
    ? new Date(reviews[0].published_at).toUTCString()
    : new Date().toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Chekpoint — Latest Game Reviews</title>
    <link>${BASE}</link>
    <atom:link href="${BASE}/rss.xml" rel="self" type="application/rss+xml" />
    <description>Community game reviews from Chekpoint.gg — scores, hot takes, and write-ups from real players.</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      'Netlify-CDN-Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
};
