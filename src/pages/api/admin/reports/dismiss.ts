import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

const VALID_TARGET_TYPES = ['review', 'comment', 'recommendation', 'profile'];

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db } = auth;

  const { target_type, target_id } = await context.request.json();
  if (!VALID_TARGET_TYPES.includes(target_type)) return json({ error: "Invalid target_type." }, 400);
  if (!target_id) return json({ error: "Missing target_id." }, 400);

  const { error } = await db
    .from('reports')
    .update({ status: 'dismissed' })
    .eq('target_type', target_type)
    .eq('target_id', target_id)
    .eq('status', 'pending');

  if (error) {
    console.error('[admin/reports/dismiss] update error:', JSON.stringify(error));
    return json({ error: "Failed to dismiss report." }, 500);
  }

  return json({ ok: true });
};
