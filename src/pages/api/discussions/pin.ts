import type { APIRoute } from "astro";
import { requireAuth, json, isSiteAdmin } from "../../../utils/api";

// Pin / unpin a site discussion. Site admins only.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { discussion_id, pinned } = await context.request.json();
  if (!discussion_id || typeof pinned !== "boolean")
    return json({ error: "discussion_id and pinned are required" }, 400);

  if (!(await isSiteAdmin(db, profile.id)))
    return json({ error: "Not authorized" }, 403);

  const { error } = await (db as any)
    .from("site_discussions").update({ pinned }).eq("id", discussion_id);
  if (error) {
    console.error("[discussions/pin] error:", JSON.stringify(error));
    return json({ error: "Failed to update discussion" }, 500);
  }

  return json({ success: true });
};
