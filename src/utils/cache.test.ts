import { describe, expect, it } from "vitest";
import { PAGE_VARY, cdnCacheHeaders, setPageCacheHeaders } from "./cache";

describe("cdnCacheHeaders", () => {
  it("opts into Netlify's shared durable cache", () => {
    expect(cdnCacheHeaders(120, 300)["Netlify-CDN-Cache-Control"]).toBe(
      "public, durable, max-age=120, stale-while-revalidate=300",
    );
  });

  it("keys the durable cache on the query string", () => {
    expect(cdnCacheHeaders(120, 300)["Netlify-Vary"]).toBe("query");
  });

  it("attaches Netlify-Cache-Tag when tags are supplied", () => {
    expect(cdnCacheHeaders(120, 300, ["reviews-public"])["Netlify-Cache-Tag"]).toBe("reviews-public");
  });

  it("omits Netlify-Cache-Tag when no tags are supplied", () => {
    expect("Netlify-Cache-Tag" in cdnCacheHeaders(120, 300)).toBe(false);
  });
});

describe("PAGE_VARY", () => {
  it("varies on the query string", () => {
    expect(PAGE_VARY.split(",")).toContain("query");
  });

  it("varies on both the whole and the chunked auth cookie", () => {
    const cookie = PAGE_VARY.split(",").find((d) => d.startsWith("cookie="))!;
    const names = cookie.replace(/^cookie=/, "").split("|");
    expect(names).toHaveLength(2);
    expect(names[1]).toBe(`${names[0]}.0`);
  });
});

describe("setPageCacheHeaders", () => {
  it("shares the anonymous render at the CDN but never in the browser", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, false);
    expect(headers.get("Netlify-CDN-Cache-Control")).toBe("public, durable, max-age=3600, stale-while-revalidate=86400");
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("Netlify-Vary")).toBe(PAGE_VARY);
  });

  it("honours a custom max-age", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, false, 120);
    expect(headers.get("Netlify-CDN-Cache-Control")).toBe("public, durable, max-age=120, stale-while-revalidate=86400");
  });

  it("never shared-caches a logged-in render", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, true);
    expect(headers.get("Netlify-CDN-Cache-Control")).toBeNull();
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    expect(headers.get("Netlify-Vary")).toBe(PAGE_VARY);
  });

  it("emits Netlify-Cache-Tag on anon responses when tags are supplied", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, false, 3600, ["reviews-public", "games"]);
    expect(headers.get("Netlify-Cache-Tag")).toBe("reviews-public,games");
  });

  it("omits Netlify-Cache-Tag on logged-in responses even if tags are supplied", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, true, 3600, ["reviews-public"]);
    expect(headers.get("Netlify-Cache-Tag")).toBeNull();
  });
});
