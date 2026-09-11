export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../utils/api";

// Freeze/unfreeze an account's ability to change its username. Used against
// rename-hopping (block/report evasion) without a full ban. API-only for now —
// call with { profile_id, locked }.
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

  const profileId = typeof body?.profile_id === "string" ? body.profile_id.trim() : "";
  const locked = typeof body?.locked === "boolean" ? body.locked : null;
  if (!profileId || locked === null)
    return json({ error: "profile_id (string) and locked (boolean) are required." }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId))
    return json({ error: "profile_id must be a UUID." }, 400);

  const { error } = await (db as any)
    .from("profiles")
    .update({ username_locked: locked })
    .eq("id", profileId);
  if (error) {
    console.error("[admin/username-lock] update error:", JSON.stringify(error));
    return json({ error: "Could not update." }, 500);
  }

  return json({ ok: true, profile_id: profileId, locked });
};
