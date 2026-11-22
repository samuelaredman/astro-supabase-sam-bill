import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

// Start a site-wide discussion thread. Any signed-in user may post.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { title, body } = await context.request.json();
  if (!body?.trim())
    return json({ error: "Body is required" }, 400);
  if (title && String(title).length > 200)
    return json({ error: "Title too long (max 200)" }, 400);
  // Bodies are Tiptap HTML — base64 images push past small limits.
  if (body.length > 2000000)
    return json({ error: "Discussion is too large" }, 400);

  const { data: discussion, error } = await (db as any)
    .from("site_discussions")
    .insert({
      profile_id: profile.id,
      title: title ? String(title).trim() : null,
      body: body.trim(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("[discussions/create] error:", JSON.stringify(error));
    return json({ error: "Failed to post discussion" }, 500);
  }

  return json({ id: discussion.id });
};
