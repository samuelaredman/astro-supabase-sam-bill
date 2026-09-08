import { getSupabaseAdmin } from "./database";

/**
 * Escape SQL LIKE/ILIKE metacharacters (`\`, `%`, `_`). PostgREST additionally
 * treats `*` as an alias for `%` in `like`/`ilike`, so callers that pass
 * untrusted input must ALSO reject/verify `*` — see resolveRenamedUsername,
 * which does an exact post-fetch comparison rather than trusting the pattern.
 */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");

// Anything a real username (including grandfathered email-prefix ones with
// dots/hyphens/pluses) could contain. Used to drop junk URL params before they
// reach the DB — and to keep `*`, commas, parens, spaces and unicode out of an
// ILIKE pattern.
const USERNAME_LIKE_CHARS = /^[A-Za-z0-9_.+-]{1,40}$/;

/**
 * Given a username that matches NO live profile, return the CURRENT username of
 * the profile that used to hold it (so the caller can 301-redirect a stale
 * link), or null when there's nothing to redirect to.
 *
 * Call this only after a live `profiles.username` lookup has missed — a live
 * profile always wins, including the case where the old name was later
 * re-registered by someone else.
 */
export async function resolveRenamedUsername(username: string): Promise<string | null> {
  const name = (username ?? "").trim();
  if (!name || !USERNAME_LIKE_CHARS.test(name)) return null;

  const db = getSupabaseAdmin() as any;

  // Fetch a few candidates, then verify an exact case-insensitive match in JS so
  // a stray wildcard in the pattern can never widen the result.
  const { data: rows } = await db
    .from("username_history")
    .select("profile_id, old_username")
    .ilike("old_username", likeEscape(name))
    .order("changed_at", { ascending: false })
    .limit(10);

  const hit = (rows ?? []).find(
    (r: any) => String(r.old_username).toLowerCase() === name.toLowerCase()
  );
  if (!hit?.profile_id) return null;

  const { data: cur } = await db
    .from("profiles")
    .select("username, is_active")
    .eq("id", hit.profile_id)
    .maybeSingle();
  if (!cur?.is_active || !cur.username) return null;
  // Only bail if the target is byte-identical to what was requested (a no-op
  // redirect). A case-only difference SHOULD redirect (e.g. /reviewers/billy →
  // /reviewers/Billy), and the live `.eq` lookup for the exact target always
  // resolves, so there's no loop.
  if (cur.username === name) return null;

  return cur.username as string;
}
