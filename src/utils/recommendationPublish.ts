// Fan out "someone you follow posted a recommendation" notifications. Shared by
// the create path (new published recommendation) and the update path (a draft
// being posted). Never throws — a notification failure must not fail the request.

export async function notifyRecommendationPublished(
  db: any,
  { recommendationId, profileId }: { recommendationId: string; profileId: string },
): Promise<void> {
  try {
    const { data: notifyFollowers } = await db
      .from("follows").select("follower_id")
      .eq("following_id", profileId).eq("notify", true).neq("follower_id", profileId);

    const rows = (notifyFollowers ?? []).map((f: any) => ({
      profile_id: f.follower_id,
      type: "follow_recommendation",
      recommendation_id: recommendationId,
      actor_profile_id: profileId,
    }));

    if (rows.length > 0) await db.from("notifications").insert(rows);
  } catch (e) {
    console.error("[recommendationPublish] notification error (non-fatal):", e);
  }
}
