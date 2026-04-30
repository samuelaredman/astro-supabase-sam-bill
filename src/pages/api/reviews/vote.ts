import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

  const { review_id, vote } = await context.request.json();
  if (!review_id || ![1, -1].includes(vote)) {
    return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const { data: profile } = await (supabase as any)
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return new Response(JSON.stringify({ error: "Profile not found." }), { status: 404, headers: { "Content-Type": "application/json" } });

  // Check for existing vote
  const { data: existing } = await (supabase as any)
    .from('review_votes')
    .select('id, vote')
    .eq('profile_id', profile.id)
    .eq('review_id', review_id)
    .single();

  if (existing) {
    if (existing.vote === vote) {
      // Same vote — remove it (toggle off)
      await (supabase as any).from('review_votes').delete().eq('id', existing.id);
      return new Response(JSON.stringify({ vote: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    } else {
      // Different vote — switch it
      await (supabase as any).from('review_votes').update({ vote }).eq('id', existing.id);
      return new Response(JSON.stringify({ vote }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  }

  // No existing vote — insert
  await (supabase as any).from('review_votes').insert({ profile_id: profile.id, review_id, vote });
  return new Response(JSON.stringify({ vote }), { status: 200, headers: { "Content-Type": "application/json" } });
};
