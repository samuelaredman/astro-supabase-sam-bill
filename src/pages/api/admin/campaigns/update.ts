export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";
import { parseCampaignFields } from "../../../../utils/campaigns";
import { isUuid } from "../../../../utils/trackedLinks";

// Edits a marketing campaign — typically to set its end date once it's over.
// Body: { id, name, kind, starts_on, ends_on?, notes? } (all fields, as on create)
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

  const fields = parseCampaignFields(body);
  if ("error" in fields) return json({ error: fields.error }, 400);

  const { data, error } = await (db as any)
    .from("marketing_campaigns").update(fields.value).eq("id", id).select("id").maybeSingle();
  if (error) {
    console.error("[admin/campaigns/update] update error:", JSON.stringify(error));
    return json({ error: "Could not save the campaign." }, 500);
  }
  if (!data) return json({ error: "Campaign not found." }, 404);

  return json({ ok: true });
};
