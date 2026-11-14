export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";
import { isUuid, parseLinkFields } from "../../../../utils/trackedLinks";

// Edits a tracked link's label, destination, campaign or creator. The code is
// fixed once created — it's already out in the world.
// Body: { id, label, destination?, campaign_id?, owner_profile_id? }

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

  const fields = parseLinkFields(body);
  if ("error" in fields) return json({ error: fields.error }, 400);

  const { data, error } = await (db as any)
    .from("tracked_links").update(fields.value).eq("id", id).select("id").maybeSingle();
  if (error) {
    if (error.code === "23503") return json({ error: "That campaign or creator no longer exists." }, 400);
    console.error("[admin/links/update] update error:", JSON.stringify(error));
    return json({ error: "Could not save the link." }, 500);
  }
  if (!data) return json({ error: "Link not found." }, 404);

  return json({ ok: true });
};
