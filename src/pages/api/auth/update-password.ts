import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../utils/database";

export const POST: APIRoute = async ({ request }) => {
  const { password } = await request.json();

  if (!password) {
    return new Response(JSON.stringify({ error: "Password is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = new Response();
  const supabase = createSupabaseServerClient(request, response);

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
