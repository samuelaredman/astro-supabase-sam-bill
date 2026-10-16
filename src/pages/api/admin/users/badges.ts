export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";
import { getBadge } from "../../../../utils/badges";

// Assign or revoke a badge on a user. POST { profile_id, badge_slug, assigned }.
// Validates the slug against src/utils/badges.ts, so stale/retired slugs can't
// be written, and records assigned_by for audit.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db, profile: adminProfile } = auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const profileId = typeof body?.profile_id === "string" ? body.profile_id.trim() : "";
  const badgeSlug = typeof body?.badge_slug === "string" ? body.badge_slug.trim() : "";
  const assigned = typeof body?.assigned === "boolean" ? body.assigned : null;
  if (!profileId || !badgeSlug || assigned === null)
    return json({ error: "profile_id, badge_slug and assigned (boolean) are required." }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId))
    return json({ error: "profile_id must be a UUID." }, 400);
  if (!getBadge(badgeSlug))
    return json({ error: `Unknown badge: ${badgeSlug}` }, 400);

  const { data: target } = await (db as any)
    .from("profiles")
    .select("id")
    .eq("id", profileId)
    .maybeSingle();
  if (!target) return json({ error: "User not found." }, 404);

  if (assigned) {
    const { error } = await (db as any)
      .from("profile_badges")
      .upsert({
        profile_id: profileId,
        badge_slug: badgeSlug,
        assigned_by: adminProfile.id,
      }, { onConflict: "profile_id,badge_slug" });
    if (error) {
      console.error("[admin/users/badges] upsert error:", JSON.stringify(error));
      return json({ error: "Could not assign badge." }, 500);
    }
  } else {
    const { error } = await (db as any)
      .from("profile_badges")
      .delete()
      .eq("profile_id", profileId)
      .eq("badge_slug", badgeSlug);
    if (error) {
      console.error("[admin/users/badges] delete error:", JSON.stringify(error));
      return json({ error: "Could not revoke badge." }, 500);
    }
  }

  return json({ ok: true, profile_id: profileId, badge_slug: badgeSlug, assigned });
};
