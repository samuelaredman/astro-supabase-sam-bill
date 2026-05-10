import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext } from "../../../utils/database";

export const POST: APIRoute = async (context) => {
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "You must be signed in to comment." }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const { review_id, body } = await context.request.json();

  if (!review_id || !body?.trim()) {
    return new Response(JSON.stringify({ error: "review_id and body are required." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  if (body.trim().length > 2000) {
    return new Response(JSON.stringify({ error: "Comment must be 2000 characters or fewer." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { data: profile } = await (supabase as any)
    .from('profiles').select('id, username, avatar_url').eq('auth_user_id', user.id).single();
  if (!profile) {
    return new Response(JSON.stringify({ error: "Profile not found." }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  const { data: comment, error } = await (supabase as any)
    .from('review_comments')
    .insert({ review_id, profile_id: profile.id, body: body.trim() })
    .select('id, body, created_at, profiles(id, username, avatar_url)')
    .single();

  if (error) {
    console.error('comment insert error', error);
    return new Response(JSON.stringify({ error: "Failed to post comment." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ comment }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};
