import type { APIRoute } from 'astro';
import { getSupabase } from '../utils/database';

export const prerender = false;

export const GET: APIRoute = async () => {
  const supabase = getSupabase() as any;
  const base = 'https://chekpoint.gg';

  const { data: games } = await supabase
    .from('games')
    .select('slug, updated_at')
    .order('updated_at', { ascending: false });

  type SitemapEntry = {
    url: string;
    changefreq: string;
    priority: string;
    lastmod?: string;
  };

  const staticPages: SitemapEntry[] = [
    { url: base + '/',           changefreq: 'daily',   priority: '1.0' },
    { url: base + '/hot-takes',  changefreq: 'daily',   priority: '0.9' },
    { url: base + '/search',     changefreq: 'weekly',  priority: '0.8' },
    { url: base + '/signin',     changefreq: 'monthly', priority: '0.3' },
    { url: base + '/signup',     changefreq: 'monthly', priority: '0.3' },
    { url: base + '/privacy',    changefreq: 'monthly', priority: '0.2' },
    { url: base + '/terms',      changefreq: 'monthly', priority: '0.2' },
    { url: base + '/contact',    changefreq: 'monthly', priority: '0.2' },
  ];

  const gamePages: SitemapEntry[] = (games ?? []).map((g: any) => ({
    url: `${base}/games/${g.slug}`,
    changefreq: 'weekly',
    priority: '0.9',
    lastmod: g.updated_at ? g.updated_at.slice(0, 10) : undefined,
  }));

  // Reviewer profiles are intentionally excluded — users have not
  // explicitly consented to search-engine indexing of their profiles.
  const allPages = [...staticPages, ...gamePages];

  const urlEntries = allPages.map(p => `  <url>
    <loc>${p.url}</loc>${p.lastmod ? `\n    <lastmod>${p.lastmod}</lastmod>` : ''}
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
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
