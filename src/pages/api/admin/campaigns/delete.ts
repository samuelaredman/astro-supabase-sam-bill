export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

// Removes a marketing campaign. Only the date window goes — no user data is
// attached to campaigns, so signups simply fall back to "organic".
// Body: { id }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!UUID_RE.test(id)) return json({ error: "id must be a UUID." }, 400);

  const { error } = await (db as any).from("marketing_campaigns").delete().eq("id", id);
  if (error) {
    console.error("[admin/campaigns/delete] delete error:", JSON.stringify(error));
    return json({ error: "Could not delete the campaign." }, 500);
  }

  return json({ ok: true });
};
