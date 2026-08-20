import { afterEach, describe, expect, it, vi } from "vitest";
import { toCdnUrl, cdnImage, rewriteImageUrls } from "./imageCdn";

// Global cap appended to every proxied image by toCdnUrl. Kept as a constant
// so these tests read as "the encoded source URL, plus the cap".
const CAP = "&w=1600&q=72";

// Fake hosts/URLs only — never the real project URL (that's an env-var value
// and would trip Netlify's secret scanner if committed).
const HOSTS = ["images.igdb.com", "demo-project.supabase.co"];
const IGDB = "https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg";
const SUPA = "https://demo-project.supabase.co/storage/v1/object/public/avatars/u1.png";

const rewrite = (html: string) => rewriteImageUrls(html, HOSTS);

describe("toCdnUrl", () => {
  it("wraps a source URL in a Netlify Image CDN request with a size/quality cap", () => {
    expect(toCdnUrl(IGDB)).toBe(`/.netlify/images?url=${encodeURIComponent(IGDB)}${CAP}`);
  });

  it("un-escapes HTML entities before encoding", () => {
    const escaped = "https://images.igdb.com/x?a=1&amp;b=2";
    expect(toCdnUrl(escaped)).toBe(
      `/.netlify/images?url=${encodeURIComponent("https://images.igdb.com/x?a=1&b=2")}${CAP}`,
    );
  });
});

describe("cdnImage", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns null for a null/undefined source", () => {
    expect(cdnImage(null, 96)).toBeNull();
    expect(cdnImage(undefined, 96)).toBeNull();
  });

  it("requests the given width and default quality in production", () => {
    vi.stubEnv("DEV", false);
    expect(cdnImage(SUPA, 96, 72, HOSTS)).toBe(
      `/.netlify/images?url=${encodeURIComponent(SUPA)}&w=96&q=72`,
    );
  });

  it("accepts a custom quality and un-escapes HTML entities before encoding", () => {
    vi.stubEnv("DEV", false);
    const escaped = "https://images.igdb.com/x?a=1&amp;b=2";
    expect(cdnImage(escaped, 240, 80, HOSTS)).toBe(
      `/.netlify/images?url=${encodeURIComponent("https://images.igdb.com/x?a=1&b=2")}&w=240&q=80`,
    );
  });

  it("passes non-allowlisted hosts (e.g. Steam avatars) through untouched", () => {
    vi.stubEnv("DEV", false);
    const steam = "https://avatars.steamstatic.com/abc_full.jpg";
    expect(cdnImage(steam, 96, 72, HOSTS)).toBe(steam);
  });

  it("returns the raw URL unchanged in DEV (the /.netlify/images endpoint is prod-only)", () => {
    vi.stubEnv("DEV", true);
    expect(cdnImage(SUPA, 96, 72, HOSTS)).toBe(SUPA);
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
