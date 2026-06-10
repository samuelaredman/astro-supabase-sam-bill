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
