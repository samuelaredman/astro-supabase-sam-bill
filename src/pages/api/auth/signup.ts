import type { APIRoute } from "astro";
import { createSupabaseServerClient } from "../../../utils/database";

export const POST: APIRoute = async ({ request }) => {
  const response = new Response();
  const supabase = createSupabaseServerClient(request, response);
  const { email, password, username } = await request.json();

  if (!email || !password || !username) {
    return new Response(JSON.stringify({ error: "All fields are required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  response.headers.forEach((value, key) => { headers.append(key, value); });

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
};
