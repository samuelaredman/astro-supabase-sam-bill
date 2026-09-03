import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";
import { validateName } from "../../../utils/moderation/nameRules";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { email, password, username } = await context.request.json();

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
    .ilike("username", username)
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


  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
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
