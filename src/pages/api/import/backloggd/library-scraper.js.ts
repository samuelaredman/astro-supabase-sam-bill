import type { APIRoute } from "astro";

// Console snippet for importing a Backloggd *library* (game list + play states).
// Backloggd's /u/<user>/games/ pages are behind an Anubis proof-of-work bot
// challenge, so the server can't fetch them — but the user's own logged-in
// browser has already cleared that challenge, so this runs there:
//
//   fetch('https://chekpoint.gg/api/import/backloggd/library-scraper.js').then(r=>r.text()).then(eval)
//
// It walks each play-status filter, collects the games under it, and downloads a
// JSON file the user uploads on /settings#backloggd. Card parsing mirrors
// parseGamesPage() in src/utils/backloggd/parse.ts — keep them in sync.

const SCRAPER = String.raw`(async function () {
  var NAMED = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", hellip:"…", mdash:"—", ndash:"–" };
  function decode(s){ return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function(w,b){
    if (b[0]==="#"){ var n=(b[1]==="x"||b[1]==="X")?parseInt(b.slice(2),16):parseInt(b.slice(1),10);
      try { return isNaN(n)?w:String.fromCodePoint(n); } catch(e){ return w; } }
    return NAMED.hasOwnProperty(b)?NAMED[b]:w; }); }

  function parseGames(html){
    var out = [], seen = {};
    var re = /<a[^>]+href="\/games\/([a-z0-9-]+)\/"[^>]*>[\s\S]{0,400}?<img[^>]*\balt="([^"]*)"/g, m;
    while ((m = re.exec(html))) {
      if (seen[m[1]]) continue; seen[m[1]] = 1;
      out.push({ game_slug: m[1], game_title: decode(m[2]).trim() || m[1].replace(/-/g," ") });
    }
    if (!out.length) {
      var re2 = /href="\/games\/([a-z0-9-]+)\/"/g, mm;
      while ((mm = re2.exec(html))) { if (seen[mm[1]]) continue; seen[mm[1]] = 1;
        out.push({ game_slug: mm[1], game_title: mm[1].replace(/-/g," ") }); }
    }
    var pages = 1;
    var nav = html.match(/<nav[^>]*class="[^"]*\bpagy\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i);
    if (nav){ var pm, pr = /[?&]page=(\d+)/g; while ((pm = pr.exec(nav[1]))) { var n = parseInt(pm[1],10); if (n>pages) pages = n; } }
    return { games: out, pages: pages };
  }

  var um = location.pathname.match(/\/u\/([^\/]+)/);
  if (!um) { alert("Open your Backloggd profile first (backloggd.com/u/yourname), then run this."); return; }
  var username = um[1];

  // Most-committed status first so a game that appears under two filters keeps
  // the stronger one (played beats backlog, etc). Backloggd's filter segment has
  // varied over time (type: / status: / game_status:), so try each form — a
  // form that doesn't actually filter is detected and skipped below.
  var FILTERS = [
    "type:completed", "status:completed", "game_status:completed",
    "type:played", "status:played", "game_status:played", "type:mastered",
    "type:playing", "status:playing", "game_status:playing",
    "type:retired", "status:retired", "type:shelved", "type:abandoned", "game_status:abandoned",
    "type:backlog", "status:backlog", "game_status:backlog",
    "type:wishlist", "status:wishlist", "game_status:wishlist"
  ];

  var box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:99999;right:16px;bottom:16px;background:#1b1b22;color:#fff;" +
    "font:13px/1.4 system-ui,sans-serif;padding:14px 16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:280px";
  box.textContent = "Chekpoint library importer: starting…";
  document.body.appendChild(box);

  var seen = {}, rows = [];
  try {
    // Baseline: the whole library. Used to spot a "filter" that isn't actually
    // filtering (same page count) so we don't tag the entire library one status.
    var baseline = parseGames(
      await fetch("/u/" + username + "/games/?page=1", { credentials: "include" }).then(function(r){ return r.text(); })
    );
    var baselinePages = baseline.pages;

    for (var f = 0; f < FILTERS.length; f++) {
      var filter = FILTERS[f];
      var status = filter.split(":")[1];
      var base = "/u/" + username + "/games/added:desc/" + filter + "/";
      var first = await fetch(base + "?page=1", { credentials: "include" }).then(function(r){ return r.text(); });
      var p1 = parseGames(first);
      if (!p1.games.length) continue;
      // Filter had no effect (returned the full library) — ignore it.
      if (baselinePages > 1 && p1.pages === baselinePages && p1.games.length >= baseline.games.length) continue;
      var pages = p1.pages;
      var pageGames = p1.games.slice();
      for (var pg = 2; pg <= pages; pg++) {
        box.textContent = "Chekpoint: " + status + " — page " + pg + "/" + pages + " (" + rows.length + " games)";
        var h = await fetch(base + "?page=" + pg, { credentials: "include" }).then(function(r){ return r.text(); });
        pageGames = pageGames.concat(parseGames(h).games);
        await new Promise(function(r){ setTimeout(r, 300); });
      }
      for (var i = 0; i < pageGames.length; i++) {
        var g = pageGames[i];
        if (seen[g.game_slug]) continue;
        seen[g.game_slug] = 1;
        rows.push({ game_slug: g.game_slug, game_title: g.game_title, release_year: null, backloggd_status: status });
      }
      box.textContent = "Chekpoint: collected " + rows.length + " games so far…";
    }

    if (!rows.length) {
      box.textContent = "Chekpoint: found no games. Are you on your own profile and signed in?";
      return;
    }

    var payload = { version: 1, source: "backloggd", kind: "library", username: username, scrapedAt: new Date().toISOString(), rows: rows };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "backloggd-chekpoint-library.json";
    document.body.appendChild(a); a.click(); a.remove();
    box.textContent = "Chekpoint: done — " + rows.length + " games saved. Upload the file on Chekpoint.";
  } catch (e) {
    box.textContent = "Chekpoint library importer: failed — " + (e && e.message ? e.message : e);
    throw e;
  }
})();
`;

export const GET: APIRoute = async () => {
  return new Response(SCRAPER, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
};
