import type { APIRoute } from "astro";
import { getSupabase, createSupabaseServerClient } from "../../utils/database";

export const POST: APIRoute = async ({ request }) => {
  const response = new Response();
  const serverClient = createSupabaseServerClient(request, response);

  // Check session
  const { data: { session } } = await serverClient.auth.getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "You must be signed in to post a review." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = getSupabase();

  // Get profile_id from auth user
  const { data: profile, error: profileError } = await (supabase as any)
    .from("profiles")
    .select("id")
    .eq("auth_user_id", session.user.id)
    .single();

  if (profileError || !profile) {
    return new Response(JSON.stringify({ error: "Profile not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await request.json();
  const { game_id, score, title, body: reviewBody, platform_played_on, play_time_hours, contains_spoilers } = body;

  if (!game_id || !score || !title || !reviewBody) {
    return new Response(JSON.stringify({ error: "Missing required fields." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { error: insertError } = await (supabase as any)
    .from("reviews")
    .insert({
      profile_id: profile.id,
      game_id,
      score,
      title,
      body: reviewBody,
      platform_played_on: platform_played_on || null,
      play_time_hours: play_time_hours || null,
      contains_spoilers: contains_spoilers ?? false,
      status: "published",
      published_at: new Date().toISOString(),
    });

  if (insertError) {
    return new Response(JSON.stringify({ error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
