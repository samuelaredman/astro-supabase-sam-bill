import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

const VALID_TARGET_TYPES = ['review', 'comment', 'profile', 'recommendation'];
const VALID_REASONS = ['spam', 'harassment', 'spoilers', 'inappropriate', 'other'];

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { target_type, target_id, reason, notes } = await context.request.json();

  if (!VALID_TARGET_TYPES.includes(target_type) || !target_id || !VALID_REASONS.includes(reason))
    return json({ error: "Invalid report data." }, 400);

  const { data: existing } = await db
    .from('reports')
    .select('id')
    .eq('reporter_id', profile.id)
    .eq('target_type', target_type)
    .eq('target_id', target_id)
    .maybeSingle();

  if (existing) return json({ error: "You've already reported this." }, 409);

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
    console.error('report insert error', JSON.stringify(error));
    return json({ error: "Failed to submit report." }, 500);
  }

  return json({ ok: true });
};
