import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const VALID_TARGET_TYPES = ['review', 'comment', 'profile'];
const VALID_REASONS = ['spam', 'harassment', 'spoilers', 'inappropriate', 'other'];

export const POST: APIRoute = async (context) => {
  // Auth check with user client
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "You must be signed in to report content." }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const { target_type, target_id, reason, notes } = await context.request.json();

  if (!VALID_TARGET_TYPES.includes(target_type) || !target_id || !VALID_REASONS.includes(reason)) {
    return new Response(JSON.stringify({ error: "Invalid report data." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // All DB operations use admin client to bypass RLS
  const db = getSupabaseAdmin() as any;

  const { data: profile } = await db
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) {
    return new Response(JSON.stringify({ error: "Profile not found." }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  // Prevent duplicate reports from the same user for the same target
  const { data: existing } = await db
    .from('reports')
    .select('id')
    .eq('reporter_id', profile.id)
    .eq('target_type', target_type)
    .eq('target_id', target_id)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ error: "You've already reported this." }), {
      status: 409, headers: { "Content-Type": "application/json" },
    });
  }

  const { error } = await db
    .from('reports')
    .insert({
      reporter_id: profile.id,
      target_type,
      target_id,
      reason,
      notes: notes?.trim()?.slice(0, 500) || null,
      status: 'pending',
    });

  if (error) {
    console.error('report insert error', error);
    return new Response(JSON.stringify({ error: "Failed to submit report." }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};
