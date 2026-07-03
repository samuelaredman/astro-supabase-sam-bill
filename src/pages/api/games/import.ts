import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";
import { importGameByIgdbId } from "../../../utils/games";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { igdb_id } = await context.request.json();
  if (!igdb_id) return json({ error: 'Missing igdb_id' }, 400);

  const db = getSupabaseAdmin();

  const result = await importGameByIgdbId(db, igdb_id);
  if (!result.ok) return json({ error: result.error }, result.status);

  return json(result.game);
};
