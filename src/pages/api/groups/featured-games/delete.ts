import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { canFeatureGames } from "../../../../utils/groupFeaturedGames";

/** Remove a game from a group's Games tab. Its poll goes with it (ON DELETE CASCADE). */
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { id } = await context.request.json();
  if (!id) return json({ error: "id is required" }, 400);

  const { data: featured } = await db.from("group_featured_games")
    .select("id, group_id").eq("id", id).maybeSingle();
  if (!featured) return json({ error: "Featured game not found" }, 404);

  if (!(await canFeatureGames(db, featured.group_id, profile.id)))
    return json({ error: "Your role does not have permission to feature games" }, 403);

  const { error } = await db.from("group_featured_games").delete().eq("id", id);
  if (error) {
    console.error("[groups/featured-games/delete] delete error:", JSON.stringify(error));
    return json({ error: "Failed to remove the featured game" }, 500);
  }

  return json({ success: true });
};
