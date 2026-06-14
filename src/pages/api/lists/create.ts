import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { title, description, is_ranked, visibility, shared_to_feed } = await context.request.json();

  if (!title?.trim()) return json({ error: "Title is required." }, 400);
  if (visibility && !["public", "private"].includes(visibility))
    return json({ error: "visibility must be 'public' or 'private'." }, 400);

  const { data: list, error } = await (db as any)
    .from("lists")
    .insert({
      profile_id: profile.id,
      title: title.trim(),
      description: description?.trim() || null,
      is_ranked: is_ranked ?? false,
      visibility: visibility ?? "public",
      shared_to_feed: visibility === "private" ? false : (shared_to_feed ?? true),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[lists/create] insert error:", JSON.stringify(error));
    return json({ error: "Failed to create list." }, 500);
  }

  return json({ list_id: list.id });
};
