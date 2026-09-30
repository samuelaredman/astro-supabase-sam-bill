import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { email, password } = await context.request.json();

  if (!email || !password) {
    return new Response(JSON.stringify({ error: "Email and password are required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // `code` lets the page offer "resend confirmation email" for email_not_confirmed.
    const notConfirmed = error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message);
    return new Response(JSON.stringify({
      error: notConfirmed ? "Please confirm your email before signing in. Check your inbox (and spam folder) for the link." : error.message,
      code: notConfirmed ? "email_not_confirmed" : error.code ?? null,
    }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
