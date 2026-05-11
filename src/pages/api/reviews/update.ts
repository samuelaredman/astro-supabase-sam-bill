import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { review_id, score, title, body: reviewBody, platform_played_on, play_time_hours, contains_spoilers } = await context.request.json();

  if (!review_id || !score || !title || !reviewBody)
    return json({ error: "Missing required fields." }, 400);
  if (parseFloat(score) < 0.1 || parseFloat(score) > 10)
    return json({ error: "Score must be between 0.1 and 10." }, 400);
  if (reviewBody.length > 5000)
    return json({ error: "Review must be at most 5000 characters." }, 400);

  // Resolve profile
  const { data: profile } = await (supabase as any)
    .from("profiles").select("id").eq("auth_user_id", user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

  // Verify ownership
  const { data: review } = await (supabase as any)
    .from("reviews").select("id, profile_id").eq("id", review_id).maybeSingle();
  if (!review) return json({ error: "Review not found." }, 404);
  if (review.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  const { error: updateError } = await (supabase as any)
    .from("reviews")
    .update({
      score: parseFloat(score),
      title: title.trim(),
      body: reviewBody.trim(),
      platform_played_on: platform_played_on || null,
      play_time_hours: play_time_hours ? parseInt(play_time_hours) : null,
      contains_spoilers: contains_spoilers ?? false,
    })
    .eq("id", review_id);

  if (updateError) return json({ error: updateError.message }, 500);
  return json({ success: true });
};
