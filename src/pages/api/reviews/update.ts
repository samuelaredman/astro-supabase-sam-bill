import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { classifyText } from "../../../utils/moderation/openaiModeration";
import { fileAutoReport } from "../../../utils/moderation/autoReport";
import { finalizePublishedReview } from "../../../utils/reviewPublish";
import { readYouTubeField } from "../../../utils/youtube";
import { attachReviewVideos } from "../../../utils/reviewVideos";
import { resolveCanonicalGameId, isReviewableGameCategory } from "../../../utils/games";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const requestBody = await context.request.json();
  const { review_id, score, title, body: reviewBody, platform_played_on, play_time_hours, contains_spoilers, status } =
    requestBody;

  if (!review_id) return json({ error: "Missing review id." }, 400);

  // Absent key = older client; don't touch the stored value. Explicit null or
  // empty string clears it. A number must be an integer 1–10.
  const difficultyKeyPresent = Object.prototype.hasOwnProperty.call(requestBody, "difficulty");
  let difficultyColumn: { difficulty?: number | null } = {};
  if (difficultyKeyPresent) {
    const raw = requestBody.difficulty;
    if (raw === null || raw === undefined || raw === "") {
      difficultyColumn = { difficulty: null };
    } else {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
        return json({ error: "Difficulty must be an integer between 1 and 10." }, 400);
      }
      difficultyColumn = { difficulty: parsed };
    }
  }

  // completion_status + plat-only fields follow the same "absent key = don't
  // touch" rule. If the status is being changed away from 'platinum', the plat
  // fields are nulled in the same update (the DB CHECK constraint requires it).
  const completionKeyPresent = Object.prototype.hasOwnProperty.call(requestBody, "completion_status");
  const completionColumns: Record<string, unknown> = {};
  let demotingFromPlatinum = false;
  if (completionKeyPresent) {
    const raw = requestBody.completion_status;
    let newStatus: "dnf" | "main" | "extras" | "platinum" | null = null;
    if (raw !== null && raw !== undefined && raw !== "") {
      if (raw !== "dnf" && raw !== "main" && raw !== "extras" && raw !== "platinum") {
        return json({ error: "Invalid completion status." }, 400);
      }
      newStatus = raw;
    }
    completionColumns.completion_status = newStatus;
    if (newStatus !== "platinum") demotingFromPlatinum = true;
  }

  const parsePlatField = (
    key: "platinum_hours" | "platinum_difficulty" | "platinum_enjoyment",
    label: string,
    min: number,
    max: number,
  ): { present: boolean; value: number | null } | { error: string } => {
    if (!Object.prototype.hasOwnProperty.call(requestBody, key)) return { present: false, value: null };
    const r = requestBody[key];
    if (r === null || r === undefined || r === "") return { present: true, value: null };
    const n = Number(r);
    if (!Number.isInteger(n) || n < min || n > max) {
      return { error: `${label} must be an integer${min === 0 ? " 0 or greater" : ` between ${min} and ${max}`}.` };
    }
    return { present: true, value: n };
  };

  if (demotingFromPlatinum) {
    // Any plat value posted in the same request is ignored on a demotion —
    // staying consistent with the CHECK constraint is more important than
    // preserving a value the client no longer has a way to display.
    completionColumns.platinum_hours = null;
    completionColumns.platinum_difficulty = null;
    completionColumns.platinum_enjoyment = null;
  } else {
    const ph = parsePlatField("platinum_hours", "Platinum hours", 0, 99999);
    if ("error" in ph) return json({ error: ph.error }, 400);
    if (ph.present) completionColumns.platinum_hours = ph.value;
    const pd = parsePlatField("platinum_difficulty", "Platinum difficulty", 1, 10);
    if ("error" in pd) return json({ error: pd.error }, 400);
    if (pd.present) completionColumns.platinum_difficulty = pd.value;
    const pe = parsePlatField("platinum_enjoyment", "Platinum enjoyment", 1, 10);
    if ("error" in pe) return json({ error: pe.error }, 400);
    if (pe.present) completionColumns.platinum_enjoyment = pe.value;
  }

  // Absent key (e.g. an older client) leaves the stored video untouched.
  const youtube = readYouTubeField(requestBody);
  if ("error" in youtube) return json({ error: youtube.error }, 400);
  // Clearing (empty field) only writes the column when the review actually has a
  // video, so edits of video-less reviews never touch it.
  let youtubeColumn: { youtube_video_id?: string | null } = {};
  if (youtube.present && youtube.id) {
    youtubeColumn = { youtube_video_id: youtube.id };
  } else if (youtube.present) {
    const [current] = await attachReviewVideos(db, [{ id: review_id as string }]);
    if ((current as any)?.youtube_video_id) youtubeColumn = { youtube_video_id: null };
  }

  // Verify ownership + current state
  const { data: review } = await db
    .from("reviews").select("id, profile_id, game_id, status").eq("id", review_id).maybeSingle();
  if (!review) return json({ error: "Review not found." }, 404);
  if (review.profile_id !== profile.id) return json({ error: "Forbidden." }, 403);

  // Target status: explicit param wins; otherwise keep the row's current status
  // (so the EditModal path — which sends no status — behaves exactly as before).
  const targetStatus = status === "draft" || status === "published" ? status : review.status ?? "published";

  // ── Saving draft edits: only a body is required. ──
  if (targetStatus === "draft") {
    if (!reviewBody?.trim()) return json({ error: "Write something before saving a draft." }, 400);

    const { error: draftError } = await db
      .from("reviews")
      .update({
        score: score ?? null,
        title: title?.trim() || null,
        body: reviewBody.trim(),
        platform_played_on: platform_played_on || null,
        play_time_hours: play_time_hours ? parseInt(play_time_hours) : null,
        contains_spoilers: contains_spoilers ?? false,
        ...difficultyColumn,
        ...completionColumns,
        ...youtubeColumn,
        status: "draft",
      })
      .eq("id", review_id);

    if (draftError) {
      console.error("[reviews/update] draft save error:", JSON.stringify(draftError));
      return json({ error: draftError.message }, 500);
    }
    return json({ success: true, status: "draft" });
  }

  // ── Published path (an ordinary edit, or a draft being published) ──
  if (!score || !title || !reviewBody)
    return json({ error: "Missing required fields." }, 400);
  if (parseFloat(score) < 0.1 || parseFloat(score) > 10)
    return json({ error: "Score must be between 0.1 and 10." }, 400);
  if (reviewBody.length > 10000)
    return json({ error: "Review must be at most 10000 characters." }, 400);

  const publishing = review.status !== "published";

  // If the stored game_id is a collapsed edition (draft created before the
  // canonical backfill, or via a stale client), publishing it needs to land on
  // the canonical row — otherwise the dupe check below sees a different
  // game_id than the user's other canonical review and misses the conflict.
  const canonicalGameId = publishing
    ? await resolveCanonicalGameId(db, review.game_id)
    : review.game_id;

  // Defensive reviewability gate — mirrors /api/reviews/create. Blocks a draft
  // from being published against a non-reviewable category (mod/episode/
  // season/fork). Won't fire for ordinary edits of existing published reviews
  // because the target can't change here.
  if (publishing) {
    const { data: targetGame } = await db
      .from("games").select("igdb_category").eq("id", canonicalGameId).maybeSingle();
    if (!targetGame) return json({ error: "Game not found." }, 404);
    if (!isReviewableGameCategory(targetGame.igdb_category)) {
      return json({ error: "This game can't be reviewed directly — try reviewing the base game instead." }, 400);
    }
  }

  // Enforce one published review per canonical game before flipping status
  // (friendlier than letting the reviews_one_published_per_revision unique
  // index throw on finalize).
  if (publishing) {
    const { data: existingPublished } = await db
      .from("reviews").select("id")
      .eq("profile_id", profile.id).eq("game_id", canonicalGameId).eq("status", "published")
      .neq("id", review_id).maybeSingle();
    if (existingPublished) return json({ error: "You've already published a review for this game." }, 409);
  }

  const updatePayload: Record<string, unknown> = {
    score: parseFloat(score),
    title: title.trim(),
    body: reviewBody.trim(),
    platform_played_on: platform_played_on || null,
    play_time_hours: play_time_hours ? parseInt(play_time_hours) : null,
    contains_spoilers: contains_spoilers ?? false,
    ...difficultyColumn,
    ...completionColumns,
    ...youtubeColumn,
  };
  if (publishing) {
    updatePayload.status = "published";
    updatePayload.published_at = new Date().toISOString();
    // Pin the row to the canonical game when publishing a draft that was
    // created on an edition row.
    if (canonicalGameId !== review.game_id) updatePayload.game_id = canonicalGameId;
  }

  const { error: updateError } = await db.from("reviews").update(updatePayload).eq("id", review_id);
  if (updateError) {
    console.error("[reviews/update] update error:", JSON.stringify(updateError));
    return json({ error: updateError.message }, 500);
  }

  // A plain edit of an already-published review keeps the original behaviour:
  // no re-notification, no moderation re-screen, no reveal card.
  if (!publishing) return json({ success: true });

  // Publishing a draft: screen the text, then run the shared publish side-effects.
  const moderationDone = classifyText(`${title}\n${reviewBody}`)
    .then((result) => {
      if (result.flagged) {
        return fileAutoReport(db, { targetType: "review", targetId: review_id, categories: result.categories });
      }
    })
    .catch((e) => console.error("[reviews/update] moderation error (non-fatal):", e));

  const reveal = await finalizePublishedReview(db, {
    reviewId: review_id,
    gameId: canonicalGameId,
    profileId: profile.id,
    score: parseFloat(score),
  });

  await moderationDone;

  return json({ success: true, status: "published", ...reveal });
};
