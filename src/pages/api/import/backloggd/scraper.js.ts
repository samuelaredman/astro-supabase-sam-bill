import type { APIRoute } from "astro";

// Served as JavaScript with permissive CORS so a user can run it from the
// DevTools console *on backloggd.com* when the server-side scrape is blocked
// or their reviews are private:
//
//   fetch('https://chekpoint.gg/api/import/backloggd/scraper.js').then(r=>r.text()).then(eval)
//
// It walks the logged-in user's own reviews pages (their session, their IP —
// Cloudflare sees a normal user), parses each with the SAME logic as
// src/utils/backloggd/parse.ts, and downloads a JSON file the user then uploads
// on /settings#backloggd. Keep the parsing here in sync with parse.ts.

const SCRAPER = String.raw`(async function () {
  var NAMED = { amp:"&", lt:"<", gt:">", quot:'"', apos:"'", nbsp:" ", hellip:"…",
    mdash:"—", ndash:"–", rsquo:"’", lsquo:"‘", ldquo:"“", rdquo:"”" };
  function decode(s){ return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function(w,b){
    if (b[0] === "#") { var n = (b[1]==="x"||b[1]==="X") ? parseInt(b.slice(2),16) : parseInt(b.slice(1),10);
      try { return isNaN(n) ? w : String.fromCodePoint(n); } catch(e){ return w; } }
    return NAMED.hasOwnProperty(b) ? NAMED[b] : w; }); }
  function text(html){ return decode(String(html)
      .replace(/<\s*br\s*\/?\s*>/gi,"\n").replace(/<\/\s*(p|div)\s*>/gi,"\n\n").replace(/<[^>]+>/g,""))
      .replace(/\r/g,"").replace(/[ \t\f\v]+/g," ").replace(/ *\n */g,"\n").replace(/\n{3,}/g,"\n\n").trim(); }
  function starRating(pct){ if(!isFinite(pct)||pct<=0) return null;
    var r = Math.round((pct/100)*5*2)/2; return Math.min(5, Math.max(0.5, r)); }
  function date(v){ if(!v) return null; var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if(m) return m[1]+"-"+m[2]+"-"+m[3]; var d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0,10); }

  function parsePage(html, username){
    var start = html.search(/<div class="row mb-1 game-name">/);
    var rows = [];
    var totalPages = null, totalReviews = null;
    var nav = html.match(/<nav[^>]*class="[^"]*\bpagy\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i);
    if (nav){ var mx = 1, m; var re = /[?&]page=(\d+)/g;
      while ((m = re.exec(nav[1]))) { var n = parseInt(m[1],10); if(n>mx) mx=n; } totalPages = mx; }
    var tr = html.match(/over\s*<span[^>]*>\s*([\d,]+)\s*<\/span>\s*Reviews/i);
    if (tr) totalReviews = parseInt(tr[1].replace(/,/g,""),10);
    if (start === -1) return { rows: rows, totalPages: totalPages, totalReviews: totalReviews };
    var rest = html.slice(start);
    var end = rest.search(/<nav[^>]*class="[^"]*\bpagy\b/i);
    var section = end === -1 ? rest : rest.slice(0, end);
    var pieces = section.split(/(?=<div class="row mb-1 game-name">)/);
    for (var i = 0; i < pieces.length; i++){
      var c = pieces[i];
      if (c.indexOf("review-card") === -1) continue;
      var gl = c.match(/href="\/games\/([^\/"]+)\/"/); if (!gl) continue;
      var slug = gl[1];
      var tm = c.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
      var title = tm ? text(tm[1]) : slug.replace(/-/g," ");
      var ym = c.match(/game-date[^>]*>\s*(\d{4})\s*</);
      var year = ym ? parseInt(ym[1],10) : null;
      var sm = c.match(/class="stars-top"\s+style="width:\s*([\d.]+)%/);
      var rating = sm ? starRating(parseFloat(sm[1])) : null;
      var pm = c.match(/class="[^"]*\breview-platform\b[^"]*"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/);
      var platform = pm ? (text(pm[1]) || null) : null;
      var dm = c.match(/<time[^>]*datetime="([^"]+)"/);
      var rdate = date(dm ? dm[1] : null);
      var stm = c.match(/\bplay-type\s+([a-z_]+)\b/);
      var pstatus = stm ? stm[1].toLowerCase() : null;
      var bb = c.match(/class="[^"]*\breview-body\b[^"]*"\s+review_id="(\d+)"[\s\S]*?<div class="[^"]*\bcard-text\b[^"]*"[^>]*>([\s\S]*?)<\/div>/);
      var rid = bb ? bb[1] : null;
      var body = bb ? text(bb[2]) : "";
      if (!body) continue;
      rows.push({
        game_slug: slug, game_title: title, release_year: year, rating: rating,
        review_text: body, review_date: rdate, platform_name: platform, play_status: pstatus,
        contains_spoilers: /\bspoiler(?:s|-|_|")/i.test(c),
        source_url: rid ? ("https://backloggd.com/u/" + username + "/review/" + rid + "/")
                        : ("https://backloggd.com/games/" + slug + "/")
      });
    }
    return { rows: rows, totalPages: totalPages, totalReviews: totalReviews };
  }

  var um = location.pathname.match(/\/u\/([^\/]+)/);
  if (!um) { alert("Open your Backloggd profile first (backloggd.com/u/yourname), then run this."); return; }
  var username = um[1];

  var box = document.createElement("div");
  box.style.cssText = "position:fixed;z-index:99999;right:16px;bottom:16px;background:#1b1b22;color:#fff;" +
    "font:13px/1.4 system-ui,sans-serif;padding:14px 16px;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.5);max-width:280px";
  box.textContent = "Chekpoint importer: starting…";
  document.body.appendChild(box);

  try {
    var first = await fetch("/u/" + username + "/reviews?page=1", { credentials: "include" }).then(function(r){ return r.text(); });
    var p1 = parsePage(first, username);
    var pages = p1.totalPages || 1;
    var all = p1.rows.slice();
    for (var pg = 2; pg <= pages; pg++){
      box.textContent = "Chekpoint importer: page " + pg + " / " + pages + " (" + all.length + " reviews)";
      var h = await fetch("/u/" + username + "/reviews?page=" + pg, { credentials: "include" }).then(function(r){ return r.text(); });
      all = all.concat(parsePage(h, username).rows);
      await new Promise(function(r){ setTimeout(r, 350); });
    }
    var seen = {}, deduped = [];
    for (var k = 0; k < all.length; k++){ if (!seen[all[k].game_slug]){ seen[all[k].game_slug] = 1; deduped.push(all[k]); } }
    var payload = { version: 1, source: "backloggd", username: username, scrapedAt: new Date().toISOString(), rows: deduped };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "backloggd-chekpoint-export.json";
    document.body.appendChild(a); a.click(); a.remove();
    box.textContent = "Chekpoint importer: done — " + deduped.length + " reviews saved. Upload the file on Chekpoint.";
  } catch (e) {
    box.textContent = "Chekpoint importer: failed — " + (e && e.message ? e.message : e);
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
