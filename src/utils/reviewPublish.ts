// Side-effects that accompany a review becoming published — shared by the
// create path (new published review) and the update path (a draft being posted).
// Auto-tracks the reviewed game as completed for the author and fans out
// watchlist/follower notifications, then returns the community-context numbers
// used by the post-review reveal card. Non-critical steps never throw.

interface FinalizeArgs {
  reviewId: string;
  gameId: string;
  profileId: string;
  score: number;
}

interface RevealContext {
  gameSlug: string | null;
  gameCover: string | null;
  communityAvg: number;
  reviewCount: number;
}

export async function finalizePublishedReview(
  db: any,
  { reviewId, gameId, profileId, score }: FinalizeArgs,
): Promise<RevealContext> {
  // ── Auto-track the reviewed game as completed (if not already in library) ──
  try {
    await db.from("user_game_status").upsert(
      {
        profile_id: profileId,
        game_id: gameId,
        status: "completed",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,game_id", ignoreDuplicates: true },
    );
  } catch (e) {
    console.error("[reviewPublish] library auto-track error (non-fatal):", e);
  }

  // ── Fire notifications (non-blocking — don't fail the request if this errors) ──
  try {
    // People actively tracking this game (want_to_play or playing), excluding the reviewer
    const { data: watchers } = await db
      .from("user_game_status").select("profile_id")
      .eq("game_id", gameId).in("status", ["want_to_play", "playing"]).neq("profile_id", profileId);

    // People who follow the reviewer with notify = true (excluding the reviewer)
    const { data: notifyFollowers } = await db
      .from("follows").select("follower_id")
      .eq("following_id", profileId).eq("notify", true).neq("follower_id", profileId);

    const notified = new Set<string>();
    const rows: any[] = [];

    for (const w of watchers ?? []) {
      if (!notified.has(w.profile_id)) {
        notified.add(w.profile_id);
        rows.push({ profile_id: w.profile_id, type: "watchlist_review",
          review_id: reviewId, game_id: gameId, actor_profile_id: profileId });
      }
    }
    for (const f of notifyFollowers ?? []) {
      if (!notified.has(f.follower_id)) {
        notified.add(f.follower_id);
        rows.push({ profile_id: f.follower_id, type: "follow_review",
          review_id: reviewId, game_id: gameId, actor_profile_id: profileId });
      }
    }

    if (rows.length > 0) await db.from("notifications").insert(rows);
  } catch (e) {
    console.error("[reviewPublish] notification error (non-fatal):", e);
  }

  // ── Community context for the post-review reveal card ──
  const [{ data: gameData }, { data: communityReviews }] = await Promise.all([
    db.from("games").select("slug, cover_img_url").eq("id", gameId).single(),
    db.from("reviews").select("score").eq("game_id", gameId).eq("status", "published"),
  ]);

  const reviewCount = communityReviews?.length ?? 1;
  const communityAvg = reviewCount > 0
    ? Math.round(((communityReviews ?? []).reduce((s: number, r: any) => s + (r.score ?? 0), 0) / reviewCount) * 10) / 10
    : score;

  return {
    gameSlug: gameData?.slug ?? null,
    gameCover: gameData?.cover_img_url ?? null,
    communityAvg,
    reviewCount,
  };
}
