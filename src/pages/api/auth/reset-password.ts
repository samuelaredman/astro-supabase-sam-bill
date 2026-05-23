import type { APIRoute } from "astro";
import { createClient } from "@supabase/supabase-js";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const { email } = await context.request.json();

  if (!email) {
    return new Response(JSON.stringify({ error: "Email is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Use a plain anon client with implicit flow so no PKCE code-verifier is
  // stored server-side. With implicit flow the reset link delivers
  // #access_token=...&type=recovery in the hash, which the confirm page
  // reads and handles entirely client-side — no cookie round-trip needed.
  const supabase = createClient(
    import.meta.env.SUPABASE_DATABASE_URL,
    import.meta.env.SUPABASE_ANON_KEY,
    { auth: { flowType: "implicit", persistSession: false } }
  );

  const redirectTo = new URL("/reset-password-confirm", context.url.origin).toString();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
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
