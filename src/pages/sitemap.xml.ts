import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
  const base = 'https://chekpoint.gg';

  const staticPages = [
    { url: base + '/',               changefreq: 'daily',   priority: '1.0' },
    { url: base + '/recommendations', changefreq: 'daily',  priority: '0.9' },
    { url: base + '/discover',       changefreq: 'daily',   priority: '0.8' },
    { url: base + '/rankings',  changefreq: 'daily',   priority: '0.8' },
    { url: base + '/search',    changefreq: 'weekly',  priority: '0.8' },
    { url: base + '/groups',    changefreq: 'weekly',  priority: '0.6' },
    { url: base + '/signin',    changefreq: 'monthly', priority: '0.3' },
    { url: base + '/signup',    changefreq: 'monthly', priority: '0.3' },
    { url: base + '/privacy',   changefreq: 'monthly', priority: '0.2' },
    { url: base + '/terms',     changefreq: 'monthly', priority: '0.2' },
    { url: base + '/contact',   changefreq: 'monthly', priority: '0.2' },
  ];

  const urlEntries = staticPages.map(p => `  <url>
    <loc>${p.url}</loc>
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
