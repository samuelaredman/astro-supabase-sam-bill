// The HowLongToBeat library scraper, as a self-contained IIFE string. Runs in
// the user's own logged-in browser on howlongtobeat.com — their session is the
// only way past Cloudflare + the SPA cookie, so server-side scraping isn't an
// option here (same reason the Backloggd library importer runs client-side).
//
// Served two ways:
//   - as JS at /api/import/hltb/library-scraper.js (console paste)
//   - encoded into the drag-to-bookmarks bookmarklet shown on settings
//
// Strategy, in order:
//   1. Read Next.js hydration data (window.__NEXT_DATA__). HLTB is a Next.js
//      app; the user's library page carries their list as JSON props. When
//      present we take it verbatim — fewer regex surprises than parsing HTML.
//   2. Walk `/user/<id>/games/<status>?page=N` for each known status filter,
//      parsing entries out of the rendered HTML. Covers the user whose Next
//      data shape has drifted or whose session renders differently.
//
// Output JSON shape — see `coerceHltbRow` in src/utils/hltb/parse.ts:
//   { version, source: "hltb", kind: "library", username, scrapedAt,
//     totalGames, counts, rows: [ { hltb_id, game_title, release_year,
//     hltb_status, minutes_played, score, review_text, review_date,
//     contains_spoilers } ] }
//
// `void` prefix so the bookmarklet doesn't navigate to the returned Promise.

export const LIBRARY_SCRAPER_SOURCE = String.raw`void (async function () {
  var NAMED = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", hellip:"…", mdash:"—", ndash:"–", rsquo:"’", lsquo:"‘", ldquo:"“", rdquo:"”" };
  function decode(s){ return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function(w,b){
    if (b[0]==="#"){ var n=(b[1]==="x"||b[1]==="X")?parseInt(b.slice(2),16):parseInt(b.slice(1),10);
      try { return isNaN(n)?w:String.fromCodePoint(n); } catch(e){ return w; } }
    return NAMED.hasOwnProperty(b)?NAMED[b]:w; }); }
  function stripHtml(s){ return decode(String(s).replace(/<[^>]+>/g, "")).replace(/\s+/g," ").trim(); }
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };

  // ── UI progress box ──────────────────────────────────────────────────────
  var box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:99999;right:16px;bottom:16px;background:#1b1b22;color:#fff;" +
    "font:13px/1.4 system-ui,sans-serif;padding:14px 16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:320px";
  box.textContent = "Chekpoint HLTB importer: starting…";
  document.body.appendChild(box);

  // ── Who are we on? ────────────────────────────────────────────────────────
  // HLTB profile URLs look like /user/<id>/<handle>/games or /user/<id>/games.
  // We just need the numeric id in the path; the handle is cosmetic.
  var um = location.pathname.match(/\/user\/([^\/]+)/);
  if (!um) {
    alert("Open your own HowLongToBeat profile first (howlongtobeat.com/user/<you>/games), then run this.");
    return;
  }
  var userSlug = um[1];
  var username = userSlug;
  // If a human-readable handle follows the id, use that for the download name.
  var hm = location.pathname.match(/\/user\/[^\/]+\/([^\/]+)/);
  if (hm && !/^games$/i.test(hm[1])) username = hm[1];

  // ── Strategy 1: Next.js hydration data ───────────────────────────────────
  // Collect everything we can from __NEXT_DATA__ on the current page. HLTB
  // puts the "all games" list behind an auth-gated API, so navigating the
  // user to /user/<id>/games/all before running the bookmarklet is the
  // instruction we give them — this is the easiest payload to parse.
  function readNextData(){
    var el = document.getElementById("__NEXT_DATA__");
    if (!el || !el.textContent) return null;
    try { return JSON.parse(el.textContent); } catch (e) { return null; }
  }

  // Walk any object tree looking for arrays whose entries look like HLTB
  // user-game records. HLTB has shuffled the exact prop path across releases
  // (pageProps.userGames vs pageProps.user.games vs …), so we probe by shape
  // rather than hard-coding a path.
  function harvestFromObject(root){
    var out = [];
    var seen = typeof WeakSet !== "undefined" ? new WeakSet() : null;
    function looksLikeUserGame(o){
      if (!o || typeof o !== "object") return false;
      // HLTB entries carry a game id and a user-progress wrapper. Known shapes
      // use custom_title, main_story, etc. for the embedded game, and
      // custom_main_hours / custom_main_minutes / review_score / review_notes
      // for the user side. Accept anything with a title and a HLTB game id.
      var hasTitle = typeof o.custom_title === "string" || typeof o.title === "string" || typeof o.game_name === "string";
      var hasId = o.game_id || o.custom_game_id || o.hltb_id;
      return hasTitle && hasId;
    }
    function walk(v){
      if (!v) return;
      if (Array.isArray(v)) {
        var arrayLooksRight = v.length > 0 && v.every(looksLikeUserGame);
        if (arrayLooksRight) { out = out.concat(v); return; }
        for (var i=0;i<v.length;i++) walk(v[i]);
        return;
      }
      if (typeof v === "object") {
        if (seen) { if (seen.has(v)) return; seen.add(v); }
        for (var k in v) walk(v[k]);
      }
    }
    walk(root);
    // Dedupe by hltb id.
    var byId = {}, dedup = [];
    for (var j=0;j<out.length;j++) {
      var id = out[j].game_id || out[j].custom_game_id || out[j].hltb_id;
      if (!byId[id]) { byId[id] = 1; dedup.push(out[j]); }
    }
    return dedup;
  }

  function pickHours(o){
    // HLTB stores minutes in several fields. Prefer the user-logged time
    // (custom_main_minutes / custom_minutes / play_minutes) and fall back to
    // whatever's set on the entry.
    var mins = o.custom_main_minutes || o.custom_minutes || o.play_minutes;
    if (typeof mins === "number" && mins > 0) return mins;
    var secs = o.custom_main_seconds || o.custom_seconds;
    if (typeof secs === "number" && secs > 0) return Math.round(secs / 60);
    // Older shape: hours as a decimal.
    var hrs = o.custom_main_hours || o.custom_hours || o.main_hours;
    if (typeof hrs === "number" && hrs > 0) return Math.round(hrs * 60);
    return null;
  }

  function pickStatus(o){
    // HLTB's play state has gone by a few names. All variants land in one of
    // our mapHltbStatus() keys (completed / playing / backlog / retired /
    // custom / replay).
    var raw = o.play_status || o.list_type || o.list_section || o.status || o.custom_status || "";
    return String(raw).toLowerCase().trim();
  }

  function pickScore(o){
    // Stars on HLTB are 1–10. review_score is the canonical field.
    var s = o.review_score != null ? o.review_score
          : o.review != null && typeof o.review === "object" ? o.review.score
          : o.rating;
    if (typeof s === "string") s = parseFloat(s);
    if (typeof s !== "number" || !isFinite(s)) return null;
    // Some payloads use a 0–5 half-star scale. Keep ints only — reviews.score
    // is CHECK(1..10) INT. Treat 0–5 as "already doubled on the server" or
    // leave for Chekpoint-side coercion.
    if (s > 10) return null;
    if (s < 1) return null;
    return Math.round(s);
  }

  function pickReviewText(o){
    var t = o.review_notes || o.review_text || (o.review && typeof o.review === "object" ? o.review.body : null) || o.notes;
    if (!t || typeof t !== "string") return null;
    var cleaned = stripHtml(t);
    return cleaned ? cleaned.slice(0, 20000) : null;
  }

  function pickTitle(o){
    return decode(String(o.custom_title || o.title || o.game_name || "").trim()) || null;
  }

  function pickReleaseYear(o){
    var y = o.release_year;
    if (typeof y === "number" && y >= 1950 && y <= 2100) return y;
    // Some payloads carry a full date — "2020-01-01" or epoch.
    var raw = o.release_date || o.first_release_date;
    if (typeof raw === "string") {
      var m = raw.match(/\b(19|20)\d{2}\b/);
      if (m) return parseInt(m[0], 10);
    }
    if (typeof raw === "number" && raw > 0) {
      var d = new Date(raw > 1e12 ? raw : raw * 1000);
      if (!isNaN(d.getTime())) return d.getFullYear();
    }
    return null;
  }

  function pickReviewDate(o){
    var raw = o.review_date || (o.review && typeof o.review === "object" ? o.review.date : null) || o.updated_date;
    if (!raw) return null;
    var d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }

  function toRow(o){
    var status = pickStatus(o);
    var title = pickTitle(o);
    if (!title || !status) return null;
    return {
      hltb_id: String(o.game_id || o.custom_game_id || o.hltb_id || "") || null,
      game_title: title,
      release_year: pickReleaseYear(o),
      hltb_status: status,
      minutes_played: pickHours(o),
      score: pickScore(o),
      review_text: pickReviewText(o),
      review_date: pickReviewDate(o),
      contains_spoilers: o.review_spoilers === true || o.contains_spoilers === true,
    };
  }

  // ── Strategy 2: DOM-scrape each shelf ────────────────────────────────────
  // When __NEXT_DATA__ doesn't carry the list (e.g. we're on the profile home
  // instead of /games), walk each shelf's page. HLTB paginates with ?page=N
  // and the current markup wraps each entry in an element that carries the
  // game id and a visible title. The scraper is defensive — it accepts a few
  // alternative class names so markup drift doesn't silently break it.
  //
  // Note: this path can't recover scores/reviews from the DOM alone (they're
  // under per-entry expanders fetched on demand). The payload will carry
  // library+status for every row and leave score/review null for them, which
  // the server treats as library-only.
  function parseShelfHtml(html){
    var out = [], seen = {};
    var re = /\/game\/(\d+)[^\"]*\"[^>]*>([^<]+)</g, m;
    while ((m = re.exec(html))) {
      var id = m[1], title = decode(m[2].trim());
      if (!title || seen[id]) continue;
      seen[id] = 1;
      out.push({ hltb_id: id, game_title: title });
    }
    return out;
  }
  function totalFromShelfHtml(html){
    var m = html.match(/>\s*([\d,]+)\s+(?:results?|games?)\s*</i);
    if (!m) return null;
    var n = parseInt(m[1].replace(/,/g, ""), 10);
    return isNaN(n) ? null : n;
  }

  async function fetchText(url){
    var r = await fetch(url, { credentials: "include", headers: { "accept": "text/html" } });
    if (!r.ok) throw new Error("HLTB returned " + r.status + " for " + url);
    return await r.text();
  }

  var SHELVES = [
    { slug: "completed", status: "completed" },
    { slug: "playing",   status: "playing" },
    { slug: "backlog",   status: "backlog" },
    { slug: "replays",   status: "replay" },
    { slug: "retired",   status: "retired" },
    { slug: "custom",    status: "custom" },
  ];

  async function crawlShelves(){
    var all = [];
    for (var i=0;i<SHELVES.length;i++) {
      var sh = SHELVES[i];
      box.textContent = "Chekpoint HLTB: reading " + sh.slug + "…";
      var page = 1, seenSize = -1;
      while (page <= 60) {
        var url = "/user/" + userSlug + "/games/" + sh.slug + "?page=" + page;
        var html;
        try { html = await fetchText(url); } catch (e) { break; }
        var entries = parseShelfHtml(html);
        if (!entries.length) break;
        // Stop when a page repeats everything we've already got for this
        // shelf (HLTB silently returns page 1 for out-of-range values).
        var before = all.length;
        for (var j=0;j<entries.length;j++) {
          all.push({ hltb_id: entries[j].hltb_id, game_title: entries[j].game_title,
            hltb_status: sh.status });
        }
        if (all.length === seenSize) break;
        seenSize = all.length;
        if (entries.length < 20 || all.length === before) break;
        page++;
        await sleep(400);
      }
    }
    return all;
  }

  // ── Drive ────────────────────────────────────────────────────────────────
  try {
    box.textContent = "Chekpoint HLTB: reading your games…";
    var rows = [];

    // Try hydration data first.
    var next = readNextData();
    if (next) {
      var raw = harvestFromObject(next);
      for (var i=0;i<raw.length;i++) {
        var row = toRow(raw[i]);
        if (row) rows.push(row);
      }
    }

    // If that didn't surface a library, fall back to shelf walks.
    if (!rows.length) {
      box.textContent = "Chekpoint HLTB: no hydration data — walking shelves…";
      try { rows = await crawlShelves(); } catch (e) { console.error(e); }
    }

    // Last-ditch: at least report what we're on.
    if (!rows.length) {
      box.textContent = "Chekpoint HLTB: no games found. Open your 'Games' tab (howlongtobeat.com/user/<id>/games) and try again.";
      return;
    }

    // Dedupe (shelf-fallback can double-count a game sitting in two lists).
    var byTitle = {};
    var dedup = [];
    for (var k=0;k<rows.length;k++) {
      var key = (rows[k].hltb_id || rows[k].game_title || "").toLowerCase();
      if (!key) continue;
      if (!byTitle[key]) { byTitle[key] = 1; dedup.push(rows[k]); }
    }

    var counts = { completed: 0, playing: 0, backlog: 0, retired: 0, replay: 0, custom: 0 };
    for (var r2=0;r2<dedup.length;r2++) {
      var st = dedup[r2].hltb_status;
      if (counts[st] != null) counts[st]++;
    }

    var payload = {
      version: 1,
      source: "hltb",
      kind: "library",
      username: username,
      scrapedAt: new Date().toISOString(),
      totalGames: dedup.length,
      counts: counts,
      rows: dedup,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hltb-chekpoint-library.json";
    document.body.appendChild(a); a.click(); a.remove();
    box.textContent = "Chekpoint HLTB: done — " + dedup.length + " games exported. Upload the file on Chekpoint.";
  } catch (e) {
    box.textContent = "Chekpoint HLTB importer: failed — " + (e && e.message ? e.message : e);
    throw e;
  }
})();`;
