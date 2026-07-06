import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: 'https://chekpoint.gg',
  output: 'server',
  markdown: {
    shikiConfig: {
      theme: 'github-light-high-contrast',
    },
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: ['.netlify.app']
    }
  },
  adapter: netlify({
    // Explicitly bundle the resvg wasm binary used for OG share-image generation —
    // it's read via fs at request time (not import'd), so the function's dependency
    // tracer can miss it. (OG-image fonts are imported with `?inline` instead, so
    // they're embedded directly in the built JS and don't need this treatment.)
    includeFiles: ['./node_modules/@resvg/resvg-wasm/index_bg.wasm'],
  }),
});
