export const prerender = false;
import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

// Ban / unban a user via Supabase Auth's `banned_until`. A banned user can't
// sign in, and their existing session fails at the next JWT refresh (<=1h).
// Call with { profile_id, banned }.
//
// We don't delete content on ban — that's a separate decision made per piece
// via the existing /api/admin/reports/delete-target flow.
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
  const banned = typeof body?.banned === "boolean" ? body.banned : null;
  if (!profileId || banned === null)
    return json({ error: "profile_id (string) and banned (boolean) are required." }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId))
    return json({ error: "profile_id must be a UUID." }, 400);

  if (profileId === adminProfile.id) {
    return json({ error: "You can't ban yourself." }, 400);
  }

  const { data: target } = await (db as any)
    .from("profiles")
    .select("id, auth_user_id, username")
    .eq("id", profileId)
    .maybeSingle();
  if (!target) return json({ error: "User not found." }, 404);

  // Refuse to ban another admin.
  const { data: targetAdmin } = await (db as any)
    .from("site_admins")
    .select("profile_id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (targetAdmin) return json({ error: "Can't ban another admin." }, 400);

  // ban_duration: 'none' lifts; a long duration bans. 100y covers forever in practice.
  const banDuration = banned ? "876000h" : "none";
  const { error } = await (db as any).auth.admin.updateUserById(target.auth_user_id, {
    ban_duration: banDuration,
  });
  if (error) {
    console.error("[admin/users/ban] updateUserById error:", JSON.stringify(error));
    return json({ error: "Could not update ban state." }, 500);
  }

  return json({ ok: true, profile_id: profileId, username: target.username, banned });
};
