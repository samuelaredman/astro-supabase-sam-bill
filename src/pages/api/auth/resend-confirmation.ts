import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";

// Re-sends the signup confirmation email, for users who lost it, had it go to
// spam, or whose link was already used/expired. Same client and redirect as
// signup.ts so the resent email is identical to the original.
//
// The response never says whether an account exists for the email (Supabase's
// resend doesn't either), so this can't be used to probe for registered emails.
export const POST: APIRoute = async (context) => {
  const { email } = await context.request.json().catch(() => ({}));
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return new Response(JSON.stringify({ error: "Enter the email you signed up with." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createSupabaseServerClientFromContext(context);

  // Same rule as signup.ts: the configured `site`, never context.url.origin, and it
  // must be /auth/confirm (the page that exchanges the token for a session).
  const emailRedirectTo = new URL("/auth/confirm", context.site ?? context.url.origin).toString();

  const { error } = await supabase.auth.resend({
    type: "signup",
    email: email.trim(),
    options: { emailRedirectTo },
  });

  if (error) {
    console.error("[auth/resend-confirmation] resend error:", JSON.stringify(error));
    // Rate limits are the one failure worth surfacing — the user should wait, not retry.
    const rateLimited = error.status === 429 || /rate limit|security purposes/i.test(error.message);
    return new Response(
      JSON.stringify({
        error: rateLimited
          ? "Too many emails sent recently. Please wait a few minutes and try again."
          : "Couldn't send the email. Please try again.",
      }),
      { status: rateLimited ? 429 : 400, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
