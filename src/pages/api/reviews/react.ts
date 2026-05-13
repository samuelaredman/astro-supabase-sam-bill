import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: "Sign in to react to reviews." }, 401);

  const { review_id, reaction_type } = await context.request.json();
  if (!review_id || !reaction_type)
    return json({ error: "review_id and reaction_type are required." }, 400);

  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ error: "Profile not found." }, 404);

  // Toggle: delete if exists, insert if not
  const { data: existing } = await db
    .from('review_reactions')
    .select('id')
    .eq('review_id', review_id)
    .eq('profile_id', profile.id)
    .eq('reaction_type', reaction_type)
    .maybeSingle();

  let reacted: boolean;
  if (existing) {
    await db.from('review_reactions').delete()
      .eq('review_id', review_id)
      .eq('profile_id', profile.id)
      .eq('reaction_type', reaction_type);
    reacted = false;
  } else {
    await db.from('review_reactions')
      .insert({ review_id, profile_id: profile.id, reaction_type });
    reacted = true;
  }

  const { count } = await db
    .from('review_reactions')
    .select('*', { count: 'exact', head: true })
    .eq('review_id', review_id)
    .eq('reaction_type', reaction_type);

  return json({ reacted, count: count ?? 0, reaction_type });
};
