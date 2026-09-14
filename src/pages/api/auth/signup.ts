import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";
import { validateName } from "../../../utils/moderation/nameRules";
import { likeEscape } from "../../../utils/usernameHistory";
import { toPendingGroup } from "../../../utils/groupJoin";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { email, password, username, group_id, invite_code } = await context.request.json();

  if (!email || !password || !username) {
    return new Response(JSON.stringify({ error: "All fields are required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const nameCheck = validateName(username);
  if (!nameCheck.ok) {
    return new Response(JSON.stringify({ error: nameCheck.error }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Check username availability before attempting signup so a duplicate
  // doesn't surface as the cryptic "database error saving new user" from
  // the handle_new_user trigger.
  const db = getSupabaseAdmin();
  const { data: existing } = await db
    .from("profiles")
    .select("id")
    .ilike("username", likeEscape(username))
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ error: "Username is already taken." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Use the configured `site` (astro.config.ts), not context.url.origin — the
  // request-derived origin doesn't reliably match Supabase's Redirect URLs
  // allowlist behind Netlify (same root cause as the reset-password bug).
  //
  // Must point to /auth/confirm, not directly to /welcome: Supabase's
  // confirmation link only hands back a code/token in the URL — /auth/confirm
  // is what actually exchanges it for a session (via exchangeCodeForSession /
  // verifyOtp) and sets the auth cookie. /welcome only checks for an existing
  // cookie session, so landing there directly leaves the user logged out and
  // bounces them to /signin even though their email was confirmed.
  const emailRedirectTo = new URL("/auth/confirm", context.site ?? context.url.origin).toString();

  // Signed up from a group page: remember the group in the user's metadata so
  // /auth/confirm can join it after the email round trip (utils/groupJoin).
  // Anything malformed is dropped — it never blocks the signup itself.
  const pendingGroup = toPendingGroup(group_id, invite_code);

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: pendingGroup ? { username, pending_group: pendingGroup } : { username },
      emailRedirectTo,
    },
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
