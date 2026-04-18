import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../utils/database";

export const POST: APIRoute = async ({ request }) => {
  const { access_token, password } = await request.json();

  if (!access_token || !password) {
    return new Response(JSON.stringify({ error: "Missing required fields." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = new Response();
  const supabase = createSupabaseServerClient(request, response);

  // Exchange the recovery token for a session first
  const { error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token: access_token,
  });

  if (sessionError) {
    return new Response(JSON.stringify({ error: "Reset link is invalid or expired." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Now update the password
  const { error } = await supabase.auth.updateUser({ password });

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
