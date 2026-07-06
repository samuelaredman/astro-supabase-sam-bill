// Shared machinery for generating share-preview (Open Graph) images.
// satori lays out a plain object tree (a React-element shape, but built by hand
// here — no React/JSX involved) into SVG; @resvg/resvg-js rasterizes that SVG to PNG.
// (resvg-js is the native NAPI build, not the wasm one — benchmarked ~4x faster
// or better for our SVGs, which matters a lot given this runs synchronously on
// every cache-miss request. Netlify's function bundler traces and ships native
// NAPI binaries like this routinely — same mechanism it already uses for `sharp`.)
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
// `?inline` makes Vite embed these as base64 data URIs directly in the built JS,
// rather than a filesystem path. A path resolved from `import.meta.url` at request
// time breaks once bundling relocates this module to a different directory depth
// than the source tree (which is exactly what happens in the deployed function —
// confirmed by inspecting the built output; it was serving a 500 in production).
import dmSansRegularUri from "../assets/og-fonts/DMSans-Regular.ttf?inline";
import dmSansBoldUri from "../assets/og-fonts/DMSans-Bold.ttf?inline";
import dmSerifDisplayUri from "../assets/og-fonts/DMSerifDisplay-Regular.ttf?inline";

type OgFont = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

function dataUriToBuffer(dataUri: string): Buffer {
  return Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
}

let fontsCache: OgFont[] | null = null;
function loadOgFonts(): OgFont[] {
  if (!fontsCache) {
    fontsCache = [
      { name: "DM Sans", data: dataUriToBuffer(dmSansRegularUri), weight: 400, style: "normal" },
      { name: "DM Sans", data: dataUriToBuffer(dmSansBoldUri), weight: 700, style: "normal" },
      { name: "DM Serif Display", data: dataUriToBuffer(dmSerifDisplayUri), weight: 400, style: "normal" },
    ];
  }
  return fontsCache;
}

/** Builds a satori node without pulling in React — `{ type, props }` is all satori needs. */
export function h(type: string, props: Record<string, any> = {}, children?: any): any {
  return children !== undefined ? { type, props: { ...props, children } } : { type, props };
}

export async function renderOgPng(tree: any, width: number, height: number): Promise<Buffer> {
  const svg = await satori(tree, { width, height, fonts: loadOgFonts() });
  // satori already vectorizes all text into paths, so resvg never needs to resolve
  // a font — skip its system-font scan, which otherwise runs on every cold start.
  const resvg = new Resvg(svg, { font: { loadSystemFonts: false } });
  return resvg.render().asPng();
}

/**
 * Fetches an image and inlines it as a base64 data URI. satori can fetch remote
 * `src` URLs itself, but its docs recommend pre-fetched data URIs when rendering
 * to a raster format (no extra I/O mid-layout, and one bad fetch can't stall the rest).
 * Returns null on any failure so callers can just skip that image.
 */
export async function fetchImageDataUri(url: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Splits a cover count into row groups that always exactly fill the canvas width —
 * each row's cell width is 1200 / (items in that row), so an uneven last row (e.g.
 * 7 covers over 2 rows -> [4, 3]) never leaves a gap the way a fixed column count would.
 */
export function coverGridRows(count: number): { rowCounts: number[]; shown: number } {
  if (count <= 0) return { rowCounts: [], shown: 0 };
  const rows = count <= 4 ? 1 : count <= 8 ? 2 : 3;
  const shown = Math.min(count, rows === 3 ? 18 : count);
  const rowCounts: number[] = [];
  let remaining = shown;
  for (let i = 0; i < rows; i++) {
    const take = Math.ceil(remaining / (rows - i));
    rowCounts.push(take);
    remaining -= take;
  }
  return { rowCounts, shown };
}
