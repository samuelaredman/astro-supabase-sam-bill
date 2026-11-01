export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";
import { parseCampaignFields } from "../../../../utils/campaigns";

// Adds a marketing campaign (a date window) to the admin Activity page, which
// shades it on the chart and compares its signups' retention with organic ones.
// Body: { name, kind, starts_on: 'YYYY-MM-DD', ends_on?: 'YYYY-MM-DD' | null, notes? }
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db, profile } = auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const fields = parseCampaignFields(body);
  if ("error" in fields) return json({ error: fields.error }, 400);

  const { data, error } = await (db as any)
    .from("marketing_campaigns")
    .insert({ ...fields.value, created_by: profile.id })
    .select("id")
    .single();
  if (error) {
    console.error("[admin/campaigns/create] insert error:", JSON.stringify(error));
    return json({ error: "Could not save the campaign." }, 500);
  }

  return json({ ok: true, id: data.id });
};
