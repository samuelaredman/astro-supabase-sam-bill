import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

const DELETABLE_TARGET_TYPES = ['review', 'comment', 'recommendation'] as const;
type DeletableTargetType = typeof DELETABLE_TARGET_TYPES[number];

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db } = auth;

  const { target_type, target_id } = await context.request.json();
  if (!DELETABLE_TARGET_TYPES.includes(target_type as DeletableTargetType))
    return json({ error: "Invalid target_type." }, 400);
  if (!target_id) return json({ error: "Missing target_id." }, 400);

  // Reviews are soft-deleted (status='deleted') to match the user-facing delete
  // pattern; the published-only RLS policy already hides them. Comments and
  // recommendations are hard-deleted to match their user-facing endpoints.
  if (target_type === 'review') {
    const { error } = await db.from('reviews').update({ status: 'deleted' }).eq('id', target_id);
    if (error) {
      console.error('[admin/reports/delete-target] review update error:', JSON.stringify(error));
      return json({ error: "Failed to delete review." }, 500);
    }
  } else if (target_type === 'comment') {
    const { error } = await db.from('review_comments').delete().eq('id', target_id);
    if (error) {
      console.error('[admin/reports/delete-target] comment delete error:', JSON.stringify(error));
      return json({ error: "Failed to delete comment." }, 500);
    }
  } else if (target_type === 'recommendation') {
    // Mirror user-facing recommendation delete: clear notifications first (FK is
    // ON DELETE SET NULL, so otherwise orphaned rows render the fallback copy).
    try {
      await (db as any).from('notifications').delete().eq('recommendation_id', target_id);
    } catch (e) {
      console.error('[admin/reports/delete-target] notification cleanup error (non-fatal):', e);
    }
    const { error } = await (db as any).from('recommendations').delete().eq('id', target_id);
    if (error) {
      console.error('[admin/reports/delete-target] recommendation delete error:', JSON.stringify(error));
      return json({ error: "Failed to delete recommendation." }, 500);
    }
  }

  // Resolve every pending report pointing at this target so the queue clears
  // for brigaded content in one action.
  const { error: reportErr } = await db
    .from('reports')
    .update({ status: 'resolved' })
    .eq('target_type', target_type)
    .eq('target_id', target_id)
    .eq('status', 'pending');

  if (reportErr) {
    console.error('[admin/reports/delete-target] report resolve error:', JSON.stringify(reportErr));
    return json({ error: "Content deleted, but failed to resolve related reports." }, 500);
  }

  return json({ ok: true });
};
