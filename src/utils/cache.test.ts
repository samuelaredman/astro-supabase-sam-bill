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
    expect(headers.get("Netlify-CDN-Cache-Control")).toBe("public, durable, max-age=300, stale-while-revalidate=600");
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("Netlify-Vary")).toBe(PAGE_VARY);
  });

  it("honours a custom max-age", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, false, 120);
    expect(headers.get("Netlify-CDN-Cache-Control")).toBe("public, durable, max-age=120, stale-while-revalidate=600");
  });

  it("never shared-caches a logged-in render", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, true);
    expect(headers.get("Netlify-CDN-Cache-Control")).toBeNull();
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    expect(headers.get("Netlify-Vary")).toBe(PAGE_VARY);
  });
});
