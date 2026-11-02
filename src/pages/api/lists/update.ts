import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { list_id, title, description, is_ranked, visibility, default_view, show_hours, show_achievements } = await context.request.json();

  if (!list_id) return json({ error: "list_id is required." }, 400);
  if (title !== undefined && !title?.trim()) return json({ error: "Title cannot be empty." }, 400);
  if (visibility && !["public", "private"].includes(visibility))
    return json({ error: "visibility must be 'public' or 'private'." }, 400);

  const { data: list } = await (db as any)
    .from("lists")
    .select("id, profile_id")
    .eq("id", list_id)
    .maybeSingle();

  if (!list) return json({ error: "List not found." }, 404);
  if (list.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description?.trim() || null;
  if (is_ranked !== undefined) updates.is_ranked = is_ranked;
  if (visibility !== undefined) {
    updates.visibility = visibility;
    // Flipping to private also pulls the list off the home feed — a private
    // list has no business being discoverable there. Clear the cooldown too
    // so flipping back to public and reposting isn't gated.
    if (visibility === "private") {
      updates.shared_to_feed = false;
      updates.last_posted_to_feed_at = null;
    }
  }
  if (default_view !== undefined) {
    if (!["grid", "list"].includes(default_view)) return json({ error: "default_view must be 'grid' or 'list'." }, 400);
    updates.default_view = default_view;
  }
  if (show_hours !== undefined) updates.show_hours = !!show_hours;
  if (show_achievements !== undefined) updates.show_achievements = !!show_achievements;

  const { error } = await (db as any).from("lists").update(updates).eq("id", list_id);

  if (error) {
    console.error("[lists/update] update error:", JSON.stringify(error));
    return json({ error: "Failed to update list." }, 500);
  }

  return json({ success: true });
};
