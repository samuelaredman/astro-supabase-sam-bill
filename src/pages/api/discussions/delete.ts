import type { APIRoute } from "astro";
import { requireAuth, json, isSiteAdmin } from "../../../utils/api";

// Delete a site discussion. Author may delete their own; site admins may
// delete any.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { discussion_id } = await context.request.json();
  if (!discussion_id) return json({ error: "discussion_id is required" }, 400);

  const { data: discussion } = await (db as any)
    .from("site_discussions")
    .select("id, profile_id")
    .eq("id", discussion_id)
    .maybeSingle();
  if (!discussion) return json({ error: "Discussion not found" }, 404);

  const isAuthor = discussion.profile_id === profile.id;
  if (!isAuthor && !(await isSiteAdmin(db, profile.id)))
    return json({ error: "Not authorized" }, 403);

  const { error } = await (db as any)
    .from("site_discussions").delete().eq("id", discussion_id);
  if (error) {
    console.error("[discussions/delete] error:", JSON.stringify(error));
    return json({ error: "Failed to delete discussion" }, 500);
  }

  return json({ success: true });
};
