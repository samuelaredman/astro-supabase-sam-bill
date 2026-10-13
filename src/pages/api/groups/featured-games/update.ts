import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { readYouTubeField } from "../../../../utils/youtube";
import { canFeatureGames, createFeaturedPoll, readFeaturedNote, readFeaturedPoll } from "../../../../utils/groupFeaturedGames";

/**
 * Edit a featured game's video and note, or add a poll to one that has none.
 * Fields left out of the body are left alone; an empty youtube_url / note clears
 * it. An existing poll is changed through /api/groups/polls/* instead.
 */
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { id } = body;
  if (!id) return json({ error: "id is required" }, 400);

  const video = readYouTubeField(body);
  if ("error" in video) return json({ error: video.error }, 400);
  const note = readFeaturedNote(body);
  if ("error" in note) return json({ error: note.error }, 400);
  const poll = readFeaturedPoll(body.poll);
  if ("error" in poll) return json({ error: poll.error }, 400);

  const { data: featured } = await db.from("group_featured_games")
    .select("id, group_id").eq("id", id).maybeSingle();
  if (!featured) return json({ error: "Featured game not found" }, 404);

  if (!(await canFeatureGames(db, featured.group_id, profile.id)))
    return json({ error: "Your role does not have permission to feature games" }, 403);

  const updates: { youtube_video_id?: string | null; note?: string | null } = {};
  if (video.present) updates.youtube_video_id = video.id;
  if (note.present) updates.note = note.note;
  if (Object.keys(updates).length > 0) {
    const { error } = await db.from("group_featured_games").update(updates).eq("id", id);
    if (error) {
      console.error("[groups/featured-games/update] update error:", JSON.stringify(error));
      return json({ error: "Failed to update the featured game" }, 500);
    }
  }

  if (poll.poll) {
    const { data: existing } = await db.from("group_polls")
      .select("id").eq("featured_game_id", id).maybeSingle();
    if (existing) return json({ error: "This game already has a poll" }, 409);
    if (await createFeaturedPoll(db, featured.group_id, id, profile.id, poll.poll))
      return json({ error: "Failed to create the poll" }, 500);
  }

  return json({ success: true });
};
