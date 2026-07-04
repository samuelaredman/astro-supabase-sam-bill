import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db } = auth;

  const { unmatched_id } = await context.request.json();
  if (!unmatched_id) return json({ error: "Missing unmatched_id." }, 400);

  const { error } = await db
    .from('steam_unmatched_titles')
    .update({ dismissed: true })
    .eq('id', unmatched_id);

  if (error) {
    console.error('[admin/unmatched-games/dismiss] update error:', JSON.stringify(error));
    return json({ error: "Failed to dismiss." }, 500);
  }

  return json({ ok: true });
};
