import { describe, expect, it } from "vitest";
import { AUTH_VARY, cdnCacheControl, setPageCacheHeaders } from "./cache";

describe("cdnCacheControl", () => {
  it("opts into Netlify's shared durable cache", () => {
    expect(cdnCacheControl(300, 600)).toBe("public, durable, max-age=300, stale-while-revalidate=600");
  });
});

describe("AUTH_VARY", () => {
  it("varies on both the whole and the chunked auth cookie", () => {
    const names = AUTH_VARY.replace(/^cookie=/, "").split("|");
    expect(names).toHaveLength(2);
    expect(names[1]).toBe(`${names[0]}.0`);
  });
});

describe("setPageCacheHeaders", () => {
  it("shares the anonymous render at the CDN but never in the browser", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, false);
    expect(headers.get("Netlify-CDN-Cache-Control")).toBe(cdnCacheControl(300, 600));
    expect(headers.get("Cache-Control")).toBe("no-store");
    expect(headers.get("Netlify-Vary")).toBe(AUTH_VARY);
  });

  it("honours a custom max-age", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, false, 120);
    expect(headers.get("Netlify-CDN-Cache-Control")).toBe(cdnCacheControl(120, 600));
  });

  it("never shared-caches a logged-in render", () => {
    const headers = new Headers();
    setPageCacheHeaders(headers, true);
    expect(headers.get("Netlify-CDN-Cache-Control")).toBeNull();
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    expect(headers.get("Netlify-Vary")).toBe(AUTH_VARY);
  });
});
