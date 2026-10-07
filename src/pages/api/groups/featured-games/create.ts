import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { importGameByIgdbId } from "../../../../utils/games";
import { readYouTubeField } from "../../../../utils/youtube";
import { canFeatureGames, createFeaturedPoll, readFeaturedNote, readFeaturedPoll, FEATURED_GAMES_MAX } from "../../../../utils/groupFeaturedGames";

/**
 * Feature a game on a group's Games tab, with an optional video, note and poll.
 * The game is either one already on Chekpoint (game_id) or an IGDB search result
 * (igdb_id), imported first.
 */
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { group_id, game_id, igdb_id } = body;
  if (!group_id || (!game_id && !igdb_id)) return json({ error: "group_id and a game are required" }, 400);

  const video = readYouTubeField(body);
  if ("error" in video) return json({ error: video.error }, 400);
  const note = readFeaturedNote(body);
  if ("error" in note) return json({ error: note.error }, 400);
  const poll = readFeaturedPoll(body.poll);
  if ("error" in poll) return json({ error: poll.error }, 400);

  if (!(await canFeatureGames(db, group_id, profile.id)))
    return json({ error: "Your role does not have permission to feature games" }, 403);

  const { count } = await db.from("group_featured_games")
    .select("id", { count: "exact", head: true }).eq("group_id", group_id);
  if ((count ?? 0) >= FEATURED_GAMES_MAX)
    return json({ error: `A group can feature up to ${FEATURED_GAMES_MAX} games. Remove one first.` }, 400);

  let gameId: string = game_id;
  if (!gameId) {
    const imported = await importGameByIgdbId(db, Number(igdb_id));
    if (!imported.ok) return json({ error: imported.error }, imported.status);
    gameId = imported.game.id;
  }

  const { data: featured, error } = await db.from("group_featured_games").insert({
    group_id,
    game_id: gameId,
    youtube_video_id: video.present ? video.id : null,
    note: note.present ? note.note : null,
    created_by: profile.id,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return json({ error: "That game is already featured in this group" }, 409);
    if (error.code === "23503") return json({ error: "Game not found" }, 404);
    console.error("[groups/featured-games/create] insert error:", JSON.stringify(error));
    return json({ error: "Failed to feature the game" }, 500);
  }

  if (poll.poll) {
    const pollError = await createFeaturedPoll(db, group_id, featured.id, profile.id, poll.poll);
    if (pollError) {
      // Don't leave a featured game behind without the poll that was asked for
      await db.from("group_featured_games").delete().eq("id", featured.id);
      return json({ error: "Failed to create the poll" }, 500);
    }
  }

  return json({ id: featured.id });
};
