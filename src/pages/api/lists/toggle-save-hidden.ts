import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id, hidden } = await context.request.json();
  if (!list_id || typeof hidden !== "boolean")
    return json({ error: "list_id and hidden (boolean) are required" }, 400);

  const { error } = await (db as any)
    .from("list_saves")
    .update({ is_hidden: hidden })
    .eq("list_id", list_id)
    .eq("profile_id", profile.id);

  if (error) {
    console.error("[lists/toggle-save-hidden] error:", JSON.stringify(error));
    return json({ error: "Failed to update" }, 500);
  }

  return json({ hidden });
};
