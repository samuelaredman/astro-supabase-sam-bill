// The Backloggd library scraper, as a self-contained IIFE string. Runs in the
// user's own logged-in browser on backloggd.com (their session has already
// cleared the Anubis bot challenge that blocks server-side fetches of the
// /games/ pages). It reads the four Backloggd "shelves" and downloads a JSON
// file the user uploads on /settings#backloggd.
//
// Used two ways:
//   - served as JS at /api/import/backloggd/library-scraper.js (console paste)
//   - encoded into the drag-to-bookmarks-bar bookmarklet on the settings page
//
// Structure confirmed against a real games page (2026-08):
//   <div class="card mx-auto game-cover " game_id="1074">
//     <a href="/games/super-mario-64/" class="cover-link"></a>
//     <div class="overflow-wrapper"><img class="card-img height" ... alt="Super Mario 64"></div>
//   Only these library filters actually work; `status:*` and
//   `type:completed|retired|…` are ignored by Backloggd and return the whole
//   library, so they are NOT used:
//     /u/<user>/games/added:desc/type:playing/
//     /u/<user>/games/added:desc/type:played/
//     /u/<user>/games/added:desc/type:backlog/
//     /u/<user>/games/added:desc/type:wishlist/
//
// `void` prefix so the bookmarklet doesn't navigate to the returned Promise.

export const LIBRARY_SCRAPER_SOURCE = String.raw`void (async function () {
  var NAMED = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", hellip:"…", mdash:"—", ndash:"–" };
  function decode(s){ return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function(w,b){
    if (b[0]==="#"){ var n=(b[1]==="x"||b[1]==="X")?parseInt(b.slice(2),16):parseInt(b.slice(1),10);
      try { return isNaN(n)?w:String.fromCodePoint(n); } catch(e){ return w; } }
    return NAMED.hasOwnProperty(b)?NAMED[b]:w; }); }

  // -> [{ slug, title }], deduped, in document order. "lib" (nav link) excluded.
  function parseCards(html){
    var out = [], seen = {};
    // card: <a href="/games/<slug>/" class="cover-link"> … <img … alt="<title>">
    var re = /href="\/games\/([a-z0-9][a-z0-9-]*)\/"[^>]*class="cover-link"[\s\S]{0,240}?alt="([^"]*)"/g, m;
    while ((m = re.exec(html))) {
      if (m[1] === "lib" || seen[m[1]]) continue;
      seen[m[1]] = 1;
      out.push({ slug: m[1], title: decode(m[2]).trim() || m[1].replace(/-/g, " ") });
    }
    if (!out.length) { // markup drift: fall back to bare game links
      var re2 = /href="\/games\/([a-z0-9][a-z0-9-]*)\/"/g, mm;
      while ((mm = re2.exec(html))) {
        if (mm[1] === "lib" || seen[mm[1]]) continue;
        seen[mm[1]] = 1;
        out.push({ slug: mm[1], title: mm[1].replace(/-/g, " ") });
      }
    }
    return out;
  }
  function lastPage(html){
    var nav = html.match(/<nav[^>]*class="[^"]*\bpagy\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i);
    if (!nav) return 1;
    var mx = 1, y, r = /[?&]page=(\d+)/g;
    while ((y = r.exec(nav[1]))) { var n = parseInt(y[1],10); if (n>mx) mx = n; }
    return mx;
  }
  function getText(url){ return fetch(url, { credentials: "include" }).then(function(r){ return r.text(); }); }
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };

  var um = location.pathname.match(/\/u\/([^\/]+)/);
  if (!um) { alert("Open your own Backloggd games tab first (backloggd.com/u/yourname/games/), then run this."); return; }
  var username = um[1];
  var base = "/u/" + username + "/games/";

  // The library filters and per-card state only reflect the OWNER of the profile
  // you're viewing. Backloggd puts the *logged-in viewer's* handle on the
  // per-card "quick-logs" link — bail unless it matches the profile in the URL.
  function viewerHandle(html){
    var m = html.match(/class="[^"]*\bquick-logs\b[^"]*"[^>]*username="([^"]+)"/);
    if (m) return m[1];
    m = html.match(/href="\/u\/([^\/"]+)\/(?:settings|following)\/?"/);
    return m ? m[1] : null;
  }

  var box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:99999;right:16px;bottom:16px;background:#1b1b22;color:#fff;" +
    "font:13px/1.4 system-ui,sans-serif;padding:14px 16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:300px";
  box.textContent = "Chekpoint library importer: starting…";
  document.body.appendChild(box);

  // Walk every page of a given library URL, return the full card list.
  async function crawl(pathBase, label){
    var first = await getText(pathBase + "?page=1");
    if (/anubis|not a bot/i.test(first)) throw new Error("Backloggd is showing a bot check — reload the page and try again.");
    var pages = lastPage(first);
    var cards = parseCards(first);
    for (var p = 2; p <= pages; p++) {
      box.textContent = "Chekpoint: " + label + " — page " + p + "/" + pages + " (" + cards.length + ")";
      cards = cards.concat(parseCards(await getText(pathBase + "?page=" + p)));
      await sleep(300);
    }
    // de-dupe by slug across pages
    var seen = {}, uniq = [];
    for (var i = 0; i < cards.length; i++) { if (!seen[cards[i].slug]) { seen[cards[i].slug] = 1; uniq.push(cards[i]); } }
    return uniq;
  }

  try {
    box.textContent = "Chekpoint: reading your library…";
    var firstHtml = await getText(base + "?page=1");
    if (/anubis|not a bot/i.test(firstHtml)) { box.textContent = "Chekpoint: Backloggd is showing a bot check — reload the page and try again."; return; }

    var viewer = viewerHandle(firstHtml);
    if (!viewer) {
      box.textContent = "Chekpoint: you don't seem to be signed in to Backloggd. Sign in, then run this on your own games tab.";
      return;
    }
    if (viewer.toLowerCase() !== username.toLowerCase()) {
      box.textContent = "Chekpoint: this is " + username + "'s library, but you're signed in as " + viewer +
        ". Open YOUR games tab — backloggd.com/u/" + viewer + "/games/ — and run this there.";
      return;
    }

    var baseline = await crawl(base, "all games");
    var baseCount = baseline.length;
    if (!baseCount) { box.textContent = "Chekpoint: no games found in your library."; return; }

    // Most-current status first so it wins on de-dupe (playing > played > backlog > wishlist).
    var SHELVES = ["playing", "played", "backlog", "wishlist"];
    var titleBySlug = {};
    for (var b = 0; b < baseline.length; b++) titleBySlug[baseline[b].slug] = baseline[b].title;

    var assigned = {};          // slug -> status
    var seenSets = [];          // JSON of each kept shelf's slug list, for alias detection
    for (var s = 0; s < SHELVES.length; s++) {
      var shelf = SHELVES[s];
      box.textContent = "Chekpoint: reading " + shelf + "…";
      var cards = await crawl(base + "added:desc/type:" + shelf + "/", shelf);
      var slugs = cards.map(function(c){ return c.slug; }).sort();
      // Skip a shelf that returned nothing, more than the whole library (bogus),
      // or the exact same set as an already-kept shelf (Backloggd ignored it).
      if (!slugs.length || slugs.length > baseCount) continue;
      var key = slugs.join(",");
      if (seenSets.indexOf(key) !== -1) continue;
      seenSets.push(key);
      for (var c2 = 0; c2 < cards.length; c2++) {
        if (!assigned[cards[c2].slug]) {
          assigned[cards[c2].slug] = shelf;
          if (cards[c2].title && !titleBySlug[cards[c2].slug]) titleBySlug[cards[c2].slug] = cards[c2].title;
        }
      }
      await sleep(300);
    }

    var rows = [];
    for (var slug in assigned) {
      rows.push({ game_slug: slug, game_title: titleBySlug[slug] || slug.replace(/-/g, " "),
        release_year: null, backloggd_status: assigned[slug] });
    }

    if (!rows.length) {
      box.textContent = "Chekpoint: your " + baseCount + " games have no shelf status (played/playing/backlog/wishlist) to import.";
      return;
    }

    var payload = { version: 1, source: "backloggd", kind: "library", username: username,
      scrapedAt: new Date().toISOString(), totalGames: baseCount, rows: rows };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "backloggd-chekpoint-library.json";
    document.body.appendChild(a); a.click(); a.remove();
    box.textContent = "Chekpoint: done — " + rows.length + " of " + baseCount + " games have a status. Upload the file on Chekpoint.";
  } catch (e) {
    box.textContent = "Chekpoint library importer: failed — " + (e && e.message ? e.message : e);
    throw e;
  }
})();`;
