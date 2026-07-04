import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db } = auth;

  const { report_id } = await context.request.json();
  if (!report_id) return json({ error: "Missing report_id." }, 400);

  const { error } = await db
    .from('reports')
    .update({ status: 'resolved' })
    .eq('id', report_id);

  if (error) {
    console.error('[admin/reports/resolve] update error:', JSON.stringify(error));
    return json({ error: "Failed to resolve report." }, 500);
  }

  return json({ ok: true });
};
