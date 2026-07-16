import { describe, expect, it } from "vitest";
import { toCdnUrl, rewriteImageUrls } from "./imageCdn";

// Fake hosts/URLs only — never the real project URL (that's an env-var value
// and would trip Netlify's secret scanner if committed).
const HOSTS = ["images.igdb.com", "demo-project.supabase.co"];
const IGDB = "https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg";
const SUPA = "https://demo-project.supabase.co/storage/v1/object/public/avatars/u1.png";

const rewrite = (html: string) => rewriteImageUrls(html, HOSTS);

describe("toCdnUrl", () => {
  it("wraps a source URL in a Netlify Image CDN request", () => {
    expect(toCdnUrl(IGDB)).toBe(`/.netlify/images?url=${encodeURIComponent(IGDB)}`);
  });

  it("un-escapes HTML entities before encoding", () => {
    const escaped = "https://images.igdb.com/x?a=1&amp;b=2";
    expect(toCdnUrl(escaped)).toBe(
      `/.netlify/images?url=${encodeURIComponent("https://images.igdb.com/x?a=1&b=2")}`,
    );
  });
});

describe("rewriteImageUrls", () => {
  it("rewrites an allowlisted <img src> and preserves all other attributes", () => {
    const html = `<img src="${IGDB}" alt="Cover" loading="lazy" class="rc-cover-img" width="90">`;
    const out = rewrite(html);
    expect(out).toBe(
      `<img src="${toCdnUrl(IGDB)}" alt="Cover" loading="lazy" class="rc-cover-img" width="90">`,
    );
    // Everything except the URL is byte-identical.
    expect(out.replace(toCdnUrl(IGDB), IGDB)).toBe(html);
  });

  it("rewrites Supabase Storage avatars", () => {
    const html = `<img src="${SUPA}" alt="avatar">`;
    expect(rewrite(html)).toBe(`<img src="${toCdnUrl(SUPA)}" alt="avatar">`);
  });

  it("rewrites CSS background url() values", () => {
    const html = `<div style="background-image:url('${SUPA}')"></div>`;
    expect(rewrite(html)).toBe(
      `<div style="background-image:url('${toCdnUrl(SUPA)}')"></div>`,
    );
  });

  it("leaves og:image and other content= URLs untouched", () => {
    const html = `<meta property="og:image" content="${IGDB}">`;
    expect(rewrite(html)).toBe(html);
  });

  it("leaves <link href> / anchor URLs untouched", () => {
    const html = `<link rel="canonical" href="${IGDB}"><a href="${SUPA}">x</a>`;
    expect(rewrite(html)).toBe(html);
  });

  it("does not touch srcset or data-src attributes", () => {
    const html = `<img data-src="${IGDB}" srcset="${SUPA} 2x">`;
    expect(rewrite(html)).toBe(html);
  });

  it("passes through images from non-allowlisted hosts unchanged", () => {
    const html = `<img src="https://cdn.example.com/steam/avatar.jpg" alt="x">`;
    expect(rewrite(html)).toBe(html);
  });

  it("handles multiple images in one document", () => {
    const html = `<img src="${IGDB}"><span></span><img src="${SUPA}">`;
    expect(rewrite(html)).toBe(
      `<img src="${toCdnUrl(IGDB)}"><span></span><img src="${toCdnUrl(SUPA)}">`,
    );
  });

  it("no-ops when no hosts are configured", () => {
    const html = `<img src="${IGDB}">`;
    expect(rewriteImageUrls(html, [])).toBe(html);
  });
});
