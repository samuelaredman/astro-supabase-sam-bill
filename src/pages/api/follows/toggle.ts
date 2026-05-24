import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

  const { following_id } = await context.request.json();

  const { data: profile } = await (supabase as any).from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { "Content-Type": "application/json" } });

  const { error } = await (supabase as any).from('follows').insert({ follower_id: profile.id, following_id });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { "Content-Type": "application/json" } });

  // Fire new_follower notification (non-blocking)
  try {
    const db = getSupabaseAdmin() as any;
    const { data: existing } = await db.from('notifications')
      .select('id').eq('profile_id', following_id).eq('actor_profile_id', profile.id)
      .eq('type', 'new_follower').maybeSingle();
    if (!existing) {
      await db.from('notifications').insert({
        profile_id: following_id,
        actor_profile_id: profile.id,
        type: 'new_follower',
      });
    }
  } catch (e) {
    console.error('[follows/toggle] notification error (non-fatal):', e);
  }

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const DELETE: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });

  const { following_id } = await context.request.json();

  const { data: profile } = await (supabase as any).from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return new Response(JSON.stringify({ error: "Profile not found" }), { status: 404, headers: { "Content-Type": "application/json" } });

  const { error } = await (supabase as any).from('follows').delete().eq('follower_id', profile.id).eq('following_id', following_id);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { "Content-Type": "application/json" } });

  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
};
