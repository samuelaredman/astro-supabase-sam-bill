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

  // Check username isn't already taken
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (existingProfile) {
    return new Response(JSON.stringify({ error: "That username is already taken." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Sign up with Supabase auth
  // The profile row will be created automatically by the database trigger
  // We pass username in metadata so the trigger can use it
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username },
      emailRedirectTo: `${new URL(request.url).origin}/auth/confirm`,
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
