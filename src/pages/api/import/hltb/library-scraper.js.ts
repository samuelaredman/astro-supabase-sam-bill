import type { APIRoute } from "astro";
import { LIBRARY_SCRAPER_SOURCE } from "../../../../utils/hltb/libraryScraperSource";

// The HLTB library scraper, served as JavaScript with permissive CORS so a
// user can run it from the DevTools console *on howlongtobeat.com*:
//
//   fetch('https://chekpoint.gg/api/import/hltb/library-scraper.js').then(r=>r.text()).then(eval)
//
// The drag-to-bookmarks-bar version on /settings#hltb uses the same source
// (src/utils/hltb/libraryScraperSource.ts).

export const GET: APIRoute = async () => {
  return new Response(LIBRARY_SCRAPER_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
};
