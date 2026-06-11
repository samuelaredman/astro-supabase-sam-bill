import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

const VALID_VISIBILITY = ["public", "private"] as const;
const VALID_STATUSES = ["playing", "want_to_play", "owned", "completed", "hundred_percent", "dropped"];

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { library_visibility, library_show_hours, library_hidden_tabs } = body;

  const update: Record<string, unknown> = {};

  if (library_visibility !== undefined) {
    if (!VALID_VISIBILITY.includes(library_visibility))
      return json({ error: "Invalid library_visibility" }, 400);
    update.library_visibility = library_visibility;
  }

  if (library_show_hours !== undefined) {
    if (typeof library_show_hours !== "boolean")
      return json({ error: "library_show_hours must be boolean" }, 400);
    update.library_show_hours = library_show_hours;
  }

  if (library_hidden_tabs !== undefined) {
    if (!Array.isArray(library_hidden_tabs) || library_hidden_tabs.some((t: any) => !VALID_STATUSES.includes(t)))
      return json({ error: "library_hidden_tabs must be an array of valid status values" }, 400);
    update.library_hidden_tabs = library_hidden_tabs;
  }

  if (Object.keys(update).length === 0)
    return json({ error: "No valid fields provided" }, 400);

  const { error } = await db
    .from("profiles")
    .update(update)
    .eq("id", profile.id);

  if (error) {
    console.error("[library-settings] update error:", JSON.stringify(error));
    return json({ error: "Failed to save settings" }, 500);
  }

  return json({ success: true });
};
