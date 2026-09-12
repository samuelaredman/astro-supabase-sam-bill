import type { APIContext } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "./database";

export type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export interface AuthContext {
  user: { id: string };
  profile: { id: string };
  db: SupabaseAdmin;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Validates the session JWT and resolves the profiles row.
 * Returns either { auth, response: null } on success or { auth: null, response } on failure.
 *
 * Usage:
 *   const { auth, response } = await requireAuth(context);
 *   if (!auth) return response;
 *   const { user, profile, db } = auth;
 */
export async function requireAuth(
  context: APIContext
): Promise<{ auth: AuthContext; response: null } | { auth: null; response: Response }> {
  const userClient = createSupabaseServerClientFromContext(context);
  const {
    data: { user },
  } = await userClient.auth.getUser();

  if (!user) {
    return { auth: null, response: json({ error: "Unauthorized" }, 401) };
  }

  const db = getSupabaseAdmin();

  const { data: profile } = await (db as any)
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return { auth: null, response: json({ error: "Profile not found." }, 404) };
  }

  return { auth: { user, profile, db }, response: null };
}

/**
 * Same as requireAuth, but additionally requires the profile to be in
 * site_admins. Returns 404 (not 403) on failure so the existence of admin
 * routes isn't revealed to non-admins.
 *
 * Usage:
 *   const { auth, response } = await requireAdmin(context);
 *   if (!auth) return response;
 */
export async function requireAdmin(
  context: APIContext
): Promise<{ auth: AuthContext; response: null } | { auth: null; response: Response }> {
  const { auth, response } = await requireAuth(context);
  if (!auth) return { auth: null, response };

  const { data: adminRow } = await (auth.db as any)
    .from("site_admins")
    .select("profile_id")
    .eq("profile_id", auth.profile.id)
    .maybeSingle();

  if (!adminRow) {
    return { auth: null, response: json({ error: "Not found." }, 404) };
  }

  return { auth, response: null };
}

export interface GroupAuthority {
  role: string;
  custom_role_id: string | null;
}

/**
 * The caller's standing in a group, for permission checks: their group_members
 * role and custom role — except that site admins count as a group admin in
 * every group, joined or not, so they can moderate the groups they run.
 * Owner-only actions (delete, transfer ownership, promote to admin) keep
 * checking for the real owner row. null = not a member and not a site admin.
 *
 * For admin-gated actions only. Member actions (leave, vote, log a session)
 * should read group_members directly: a site admin who hasn't joined isn't in it.
 */
export async function getGroupAuthority(
  db: SupabaseAdmin,
  groupId: string,
  profileId: string
): Promise<GroupAuthority | null> {
  const [{ data: membership }, siteAdmin] = await Promise.all([
    db.from("group_members")
      .select("role, custom_role_id").eq("group_id", groupId).eq("profile_id", profileId).maybeSingle(),
    isSiteAdmin(db, profileId),
  ]);
  if (!siteAdmin || membership?.role === "owner") return membership;
  return { role: "admin", custom_role_id: null };
}

/** Whether the profile is in site_admins (managed by hand in the SQL editor). */
export async function isSiteAdmin(db: SupabaseAdmin, profileId: string): Promise<boolean> {
  const { data } = await db.from("site_admins").select("profile_id").eq("profile_id", profileId).maybeSingle();
  return !!data;
}

/**
 * Page-oriented counterpart to requireAdmin, for .astro pages (which redirect
 * rather than return a JSON error response). Returns the profile (for Layout's
 * currentProfile prop) or null if the visitor isn't signed in / isn't an admin.
 *
 * Usage in an .astro frontmatter:
 *   const profile = await resolveSiteAdminProfile(Astro);
 *   if (!profile) return Astro.redirect('/404');
 */
export async function resolveSiteAdminProfile(
  context: { request: Request; cookies: any }
): Promise<{ id: string; username: string; avatar_url: string | null } | null> {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;

  const db = getSupabaseAdmin();

  const { data: profile } = await (db as any)
    .from("profiles")
    .select("id, username, avatar_url")
    .eq("auth_user_id", user.id)
    .single();
  if (!profile) return null;

  const { data: adminRow } = await (db as any)
    .from("site_admins")
    .select("profile_id")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!adminRow) return null;

  return profile;
}
