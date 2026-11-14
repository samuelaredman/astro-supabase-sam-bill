export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";
import { isValidLinkCode, parseLinkFields } from "../../../../utils/trackedLinks";

// Creates a tracked link (chekpoint.gg/r/<code>).
// Body: { code, label, destination?, campaign_id?, owner_profile_id? }
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

  const code = typeof body?.code === "string" ? body.code.trim().toLowerCase() : "";
  if (!isValidLinkCode(code))
    return json({ error: "Code: 1–40 lowercase letters, numbers or dashes (no dash at either end)." }, 400);

  const fields = parseLinkFields(body);
  if ("error" in fields) return json({ error: fields.error }, 400);

  const { data, error } = await (db as any)
    .from("tracked_links")
    .insert({ code, ...fields.value, created_by: profile.id })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return json({ error: `The code "${code}" is already taken.` }, 409);
    if (error.code === "23503") return json({ error: "That campaign or creator no longer exists." }, 400);
    console.error("[admin/links/create] insert error:", JSON.stringify(error));
    return json({ error: "Could not save the link." }, 500);
  }

  return json({ ok: true, id: data.id });
};
