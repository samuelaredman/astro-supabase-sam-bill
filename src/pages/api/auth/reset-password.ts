import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../utils/database";

export const POST: APIRoute = async ({ request }) => {
  const response = new Response();
  const supabase = createSupabaseServerClient(request, response);
  const { email } = await request.json();

  if (!email) {
    return new Response(JSON.stringify({ error: "Email is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

const siteUrl = import.meta.env.SITE_URL ?? "https://greview.netlify.app";
  
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${siteUrl}/reset-password-confirm`,
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
