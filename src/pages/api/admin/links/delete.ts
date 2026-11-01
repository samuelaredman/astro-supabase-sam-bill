export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";
import { isUuid } from "../../../../utils/trackedLinks";

// Deletes a tracked link. Profiles that signed up through it are kept and lose
// the attribution (profiles.signup_link_id ON DELETE SET NULL); the code stops
// working and /r/<code> falls back to the homepage.
// Body: { id }

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db } = auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const id = typeof body?.id === "string" ? body.id : "";
  if (!isUuid(id)) return json({ error: "id must be a UUID." }, 400);

  const { error } = await (db as any).from("tracked_links").delete().eq("id", id);
  if (error) {
    console.error("[admin/links/delete] delete error:", JSON.stringify(error));
    return json({ error: "Could not delete the link." }, 500);
  }

  return json({ ok: true });
};
