import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../utils/api";
import { normalizeGroupSlug } from "../../../utils/groupSlug";

// Sets or clears a group's custom link (chekpoint.gg/c/<slug>). Site admins
// only: the links are for the creator groups we run, and a first-come slug
// would let anyone squat a creator's name.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db } = auth;

  const { group_id, slug } = await context.request.json();
  if (!group_id) return json({ error: "group_id required" }, 400);

  let value: string | null = null;
  if (typeof slug === "string" && slug.trim() !== "") {
    const check = normalizeGroupSlug(slug);
    if (!check.ok) return json({ error: check.error }, 400);
    value = check.slug;
  }

  const { data: updated, error } = await db
    .from("groups").update({ slug: value }).eq("id", group_id).select("slug").maybeSingle();
  if (error) {
    if (error.code === "23505") return json({ error: "Another group already uses that link." }, 409);
    console.error("[groups/slug] update error:", JSON.stringify(error));
    return json({ error: "Couldn't save the link." }, 500);
  }
  if (!updated) return json({ error: "Group not found" }, 404);

  return json({ success: true, slug: updated.slug });
};
