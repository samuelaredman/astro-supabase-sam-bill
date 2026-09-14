import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";
import { siteDay } from "../../../../utils/groupFeed";

/**
 * Take a side in the group's disagreement of the day.
 *
 * The day's pairing is re-derived here rather than trusted from the request: the
 * client sends which member it thinks it is siding with, and a vote only counts
 * if that member really is one of today's two sides for this group. Otherwise a
 * hand-written request could stuff the tally for any profile it liked.
 */
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json().catch(() => null);
  const groupId = body?.group_id;
  const votedFor = body?.voted_for;
  if (!groupId || !votedFor) return json({ error: "group_id and voted_for are required." }, 400);

  // Voting is for members — a site admin moderating a group they haven't joined
  // would otherwise skew the group's own tally.
  const { data: membership } = await db
    .from("group_members").select("id")
    .eq("group_id", groupId).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Join the group to take a side." }, 403);

  const { data: group } = await db
    .from("groups").select("stats_config").eq("id", groupId).maybeSingle();
  if (!group) return json({ error: "Group not found." }, 404);

  const statsConf = (group.stats_config ?? {}) as {
    focus_genre_id?: string | null; focus_platform_id?: string | null;
  };
  const day = siteDay();

  const { data: pick, error: pickError } = await db
    .rpc("group_daily_disagreement", {
      p_group_id: groupId,
      p_day: day,
      p_genre_id: statsConf.focus_genre_id ?? undefined,
      p_platform_id: statsConf.focus_genre_id ? undefined : statsConf.focus_platform_id ?? undefined,
    })
    .maybeSingle();
  if (pickError) {
    console.error("[disagreement/vote] pick error:", JSON.stringify(pickError));
    return json({ error: "Couldn't load today's disagreement." }, 500);
  }
  if (!pick) return json({ error: "There's no disagreement today." }, 409);

  const sides = [pick.high_profile_id, pick.low_profile_id];
  if (!sides.includes(votedFor)) return json({ error: "That isn't a side in today's disagreement." }, 400);
  if (votedFor === profile.id) return json({ error: "You can't side with yourself." }, 400);

  // One vote per member per day — changing your mind updates it
  const { error } = await db
    .from("group_disagreement_votes")
    .upsert(
      { group_id: groupId, day, game_id: pick.game_id, voted_for: votedFor, profile_id: profile.id },
      { onConflict: "group_id,day,profile_id" }
    );
  if (error) {
    console.error("[disagreement/vote] upsert error:", JSON.stringify(error));
    return json({ error: "Couldn't save your vote." }, 500);
  }

  const { data: tally, error: tallyError } = await db
    .rpc("group_disagreement_tally", { p_group_id: groupId, p_day: day });
  if (tallyError) console.error("[disagreement/vote] tally error:", JSON.stringify(tallyError));

  const votesFor = (id: string) =>
    (tally ?? []).find((t: any) => t.voted_for === id)?.votes ?? 0;

  return json({
    success: true,
    voted_for: votedFor,
    high: { profile_id: pick.high_profile_id, votes: votesFor(pick.high_profile_id) },
    low: { profile_id: pick.low_profile_id, votes: votesFor(pick.low_profile_id) },
  });
};
