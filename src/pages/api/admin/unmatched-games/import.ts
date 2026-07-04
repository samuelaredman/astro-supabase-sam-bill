import type { APIRoute } from "astro";
import { requireAdmin, json } from "../../../../utils/api";
import { importGameByIgdbId } from "../../../../utils/games";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAdmin(context);
  if (!auth) return response;
  const { db } = auth;

  const { unmatched_id, igdb_id } = await context.request.json();
  if (!unmatched_id || !igdb_id) return json({ error: "Missing unmatched_id or igdb_id." }, 400);

  const result = await importGameByIgdbId(db, igdb_id);
  if (!result.ok) return json({ error: result.error }, result.status);

  const { error: deleteError } = await db
    .from('steam_unmatched_titles')
    .delete()
    .eq('id', unmatched_id);

  if (deleteError) {
    console.error('[admin/unmatched-games/import] delete error (non-fatal):', JSON.stringify(deleteError));
  }

  return json({ game: result.game });
};
