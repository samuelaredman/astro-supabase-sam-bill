import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import tailwindcss from "@tailwindcss/vite";
import { supabase } from "@lib/supabase";

export default defineConfig({
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
  adapter: netlify()
});
