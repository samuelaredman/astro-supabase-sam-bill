export const prerender = false;
import type { APIRoute } from "astro";
import { getSupabaseAdmin } from "../../utils/database";
import { isBotUserAgent, isValidLinkCode, withRef } from "../../utils/trackedLinks";

// chekpoint.gg/r/<code> — a tracked link (see /admin/links). Counts the click
// and sends the visitor to the link's destination with ?ref=<code>, which
// Layout carries to /signup so the new account records the link. Nothing is
// stored on the visitor's device and nothing about them is saved here.
//
// 302 and no-store: a cached redirect would skip the click count, and a link's
// destination can be changed. Unknown codes go to the homepage rather than a
// 404, so a mistyped or deleted link still lands somewhere useful.
const NO_STORE = { "Cache-Control": "no-store", "Netlify-CDN-Cache-Control": "no-store" };

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...NO_STORE } });
}

export const GET: APIRoute = async ({ params, request }) => {
  const code = (params.code ?? "").toLowerCase();
  if (!isValidLinkCode(code)) return redirect("/");

  const db = getSupabaseAdmin() as any;
  const countIt = request.method === "GET" && !isBotUserAgent(request.headers.get("user-agent"));

  const { data, error } = countIt
    ? await db.rpc("track_link_click", { p_code: code })
    : await db.from("tracked_links").select("destination").eq("code", code).maybeSingle();
  if (error) {
    console.error("[r/code] lookup error:", JSON.stringify(error));
    return redirect("/");
  }

  const destination: string | null = countIt ? data : data?.destination ?? null;
  if (!destination) return redirect("/");
  return redirect(withRef(destination, code));
};
