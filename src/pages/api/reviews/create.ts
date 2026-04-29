import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "You must be signed in to post a review." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile, error: profileError } = await (supabase as any)
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (profileError || !profile) {
    return new Response(JSON.stringify({ error: "Profile not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await context.request.json();
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
