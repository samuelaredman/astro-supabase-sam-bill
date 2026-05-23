import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  // Auth verification uses user JWT
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { review_id, vote } = await context.request.json();
  if (!review_id || ![1, -1].includes(vote)) return json({ error: "Invalid request." }, 400);

  // All DB ops use admin client to bypass RLS
  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

  // Check for existing vote
  const { data: existing } = await db
    .from('review_votes')
    .select('vote')
    .eq('profile_id', profile.id)
    .eq('review_id', review_id)
    .maybeSingle();

  let newVote: number | null;

  if (existing) {
    if (existing.vote === vote) {
      // Same vote — toggle off (delete)
      const { error } = await db
        .from('review_votes')
        .delete()
        .eq('profile_id', profile.id)
        .eq('review_id', review_id);
      if (error) {
        console.error('[vote] delete error:', JSON.stringify(error));
        return json({ error: "Failed to remove vote.", detail: error.message, code: error.code }, 500);
      }
      newVote = null;
    } else {
      // Different vote — switch it
      const { error } = await db
        .from('review_votes')
        .update({ vote })
        .eq('profile_id', profile.id)
        .eq('review_id', review_id);
      if (error) {
        console.error('[vote] update error:', JSON.stringify(error));
        return json({ error: "Failed to update vote.", detail: error.message, code: error.code }, 500);
      }
      newVote = vote;
    }
  } else {
    // No existing vote — insert
    const { error } = await db.from('review_votes').insert({ profile_id: profile.id, review_id, vote });
    if (error) {
      console.error('[vote] insert error:', JSON.stringify(error));
      return json({ error: "Failed to save vote.", detail: error.message, code: error.code }, 500);
    }
    newVote = vote;
  }

  // Return the real counts from DB so the client never has to guess
  const [{ count: upCount }, { count: downCount }] = await Promise.all([
    db.from('review_votes').select('*', { count: 'exact', head: true }).eq('review_id', review_id).eq('vote', 1),
    db.from('review_votes').select('*', { count: 'exact', head: true }).eq('review_id', review_id).eq('vote', -1),
  ]);

  return json({ vote: newVote, up: upCount ?? 0, down: downCount ?? 0 });
};
