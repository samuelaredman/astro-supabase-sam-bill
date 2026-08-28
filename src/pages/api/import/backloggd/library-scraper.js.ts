import type { APIRoute } from "astro";
import { LIBRARY_SCRAPER_SOURCE } from "../../../../utils/backloggd/libraryScraperSource";

// The library scraper, served as JavaScript with permissive CORS so a user can
// run it from the DevTools console *on backloggd.com*:
//
//   fetch('https://chekpoint.gg/api/import/backloggd/library-scraper.js').then(r=>r.text()).then(eval)
//
// The friendlier drag-to-bookmarks-bar version on /settings#backloggd uses the
// same source (src/utils/backloggd/libraryScraperSource.ts).

export const GET: APIRoute = async () => {
  return new Response(LIBRARY_SCRAPER_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
};
