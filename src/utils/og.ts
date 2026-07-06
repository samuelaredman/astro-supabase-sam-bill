// Shared machinery for generating share-preview (Open Graph) images.
// satori lays out a plain object tree (a React-element shape, but built by hand
// here — no React/JSX involved) into SVG; @resvg/resvg-wasm rasterizes that SVG to PNG.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const require = createRequire(import.meta.url);

// resvg's wasm module can only be initialized once per process — cache the promise
// so concurrent/warm-invocation requests reuse it instead of re-initializing.
let resvgReady: Promise<void> | null = null;
function ensureResvgReady(): Promise<void> {
  if (!resvgReady) {
    const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
    resvgReady = initWasm(readFileSync(wasmPath));
  }
  return resvgReady;
}

type OgFont = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };

let fontsCache: OgFont[] | null = null;
function loadOgFonts(): OgFont[] {
  if (!fontsCache) {
    const dir = fileURLToPath(new URL("../assets/og-fonts/", import.meta.url));
    fontsCache = [
      { name: "DM Sans", data: readFileSync(dir + "DMSans-Regular.ttf"), weight: 400, style: "normal" },
      { name: "DM Sans", data: readFileSync(dir + "DMSans-Bold.ttf"), weight: 700, style: "normal" },
      { name: "DM Serif Display", data: readFileSync(dir + "DMSerifDisplay-Regular.ttf"), weight: 400, style: "normal" },
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
  await ensureResvgReady();
  const resvg = new Resvg(svg);
  return Buffer.from(resvg.render().asPng());
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
