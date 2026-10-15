import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";
import { authRedirectUrl } from "../../../utils/api";
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

  // Backstop for the client's minlength=8. Supabase's global minimum defaults
  // to 6 and the client can be bypassed (curl, modified page), so enforce 8
  // here too to match what the signup form promises the user.
  if (typeof password !== "string" || password.length < 8) {
    return new Response(JSON.stringify({ error: "Password must be at least 8 characters." }), {
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

  const db = getSupabaseAdmin();

  // Pre-check: does this email already have an account? Supabase's signUp
  // on an existing-but-unconfirmed email re-sends the confirmation without
  // inserting a new auth.users row, which means `handle_new_user` never
  // fires again and the profile keeps its first-attempt username. A user
  // who meant to change their name lands as the original one with no error
  // anywhere. Short-circuit here so the user gets a clear next step
  // (confirm the existing link, or request a new one) instead of a
  // mysterious re-send with silent state drift.
  const { data: emailStatus } = await (db as any).rpc("email_signup_status", { p_email: email });
  if (emailStatus === "confirmed") {
    return new Response(
      JSON.stringify({
        error: "An account with this email already exists. Sign in instead, or reset your password if you've forgotten it.",
        code: "email_exists",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }
  if (emailStatus === "unconfirmed") {
    return new Response(
      JSON.stringify({
        error: "You've already started signing up with this email. Check your inbox for the confirmation link, or request a new one from the sign-in page.",
        code: "pending_confirmation",
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  // Check username availability before attempting signup so a duplicate
  // doesn't surface as the cryptic "database error saving new user" from
  // the handle_new_user trigger.
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

  // Must point to /auth/confirm, not directly to /welcome: Supabase's
  // confirmation link only hands back a code/token in the URL — /auth/confirm
  // is what actually exchanges it for a session (via exchangeCodeForSession /
  // verifyOtp) and sets the auth cookie. /welcome only checks for an existing
  // cookie session, so landing there directly leaves the user logged out and
  // bounces them to /signin even though their email was confirmed.
  const emailRedirectTo = authRedirectUrl(context, "/auth/confirm");

  // Signed up from a group page: remember the group in the user's metadata so
  // /auth/confirm can join it after the email round trip (utils/groupJoin).
  // Anything malformed is dropped — it never blocks the signup itself.
  const pendingGroup = toPendingGroup(group_id, invite_code);

  const { data, error } = await supabase.auth.signUp({
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

  // An email that already belongs to a confirmed account gets a fake success from
  // Supabase (no error, no email sent) — the returned user has no identities.
  // Without this check the page says "we sent a confirmation email" and the user
  // waits for one that never comes. (Unconfirmed accounts do have identities;
  // Supabase re-sends their confirmation, so they fall through to success.)
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return new Response(
      JSON.stringify({
        error: "An account with this email already exists. Sign in instead, or reset your password if you've forgotten it.",
        code: "email_exists",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
