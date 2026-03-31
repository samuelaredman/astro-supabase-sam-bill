export const prerender = false;

import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../utils/database";

export const POST: APIRoute = async ({ request }) => {
  const response = new Response();
  const supabase = createSupabaseServerClient(request, response);

  const { email, password } = await request.json();

  if (!email || !password) {
    return new Response(JSON.stringify({ error: "Email and password are required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...Object.fromEntries(response.headers),
    },
  });
};
