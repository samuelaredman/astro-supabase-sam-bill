export const prerender = false;
import type { APIRoute } from "astro";
import { json } from "../../../utils/api";

// Diagnostic — tells us whether the server-side runtime is actually
// seeing YOUTUBE_API_KEY. Does NOT leak the key, only its presence +
// length so we can distinguish "not set" from "set but wrong length".
// Delete after we confirm the var is reachable.
export const GET: APIRoute = async () => {
  const fromImport = (import.meta as any).env?.YOUTUBE_API_KEY as string | undefined;
  const fromProcess = (globalThis as any).process?.env?.YOUTUBE_API_KEY as string | undefined;
  return json({
    import_meta_env: {
      present: typeof fromImport === "string" && fromImport.length > 0,
      length: typeof fromImport === "string" ? fromImport.length : null,
    },
    process_env: {
      present: typeof fromProcess === "string" && fromProcess.length > 0,
      length: typeof fromProcess === "string" ? fromProcess.length : null,
    },
    // Rough sanity check — real Google API keys are 39 chars starting with "AIza"
    looks_like_google_key: {
      import_meta: typeof fromImport === "string" && /^AIza[0-9A-Za-z_-]{35}$/.test(fromImport),
      process: typeof fromProcess === "string" && /^AIza[0-9A-Za-z_-]{35}$/.test(fromProcess),
    },
  });
};
