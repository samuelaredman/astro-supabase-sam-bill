// Fonts for OG-image generation are imported with `?inline` so Vite embeds them
// as base64 data URIs directly in the built JS — see src/utils/og.ts for why:
// reading them via fs at request time breaks once the server bundle relocates
// modules to a different directory depth than the source tree.
declare module "*.ttf?inline" {
  const dataUri: string;
  export default dataUri;
}
