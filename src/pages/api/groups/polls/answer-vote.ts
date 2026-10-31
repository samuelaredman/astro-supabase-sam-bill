import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

/**
 * Set / change / clear the caller's vote on an answer. Members only.
 * Body: { answer_id, vote } where vote ∈ { 1, -1 }. Posting the same
 * direction again removes it (toggle). Switching sign flips the stored row.
 * Returns the answer's new up and down counts.
 */
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const answer_id = body.answer_id;
  const voteIn = Number(body.vote ?? 1);
  if (!answer_id) return json({ error: "answer_id is required" }, 400);
  const vote: 1 | -1 = voteIn === -1 ? -1 : 1;

  const { data: answer } = await db.from("group_poll_answers")
    .select("id, profile_id, group_polls ( group_id )").eq("id", answer_id).maybeSingle();
  if (!answer?.group_polls) return json({ error: "Answer not found" }, 404);
  if (answer.profile_id === profile.id) return json({ error: "You can't vote on your own answer" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("id").eq("group_id", answer.group_polls.group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Join the group to vote" }, 403);

  const { data: existing } = await db.from("group_poll_answer_votes")
    .select("answer_id, vote").eq("answer_id", answer_id).eq("profile_id", profile.id).maybeSingle();

  let error: any = null;
  if (!existing) {
    const ins = await db.from("group_poll_answer_votes")
      .insert({ answer_id, profile_id: profile.id, vote } as any);
    error = ins.error;
  } else if ((existing as any).vote === vote) {
    // Same direction tapped again — remove the vote
    const del = await db.from("group_poll_answer_votes").delete()
      .eq("answer_id", answer_id).eq("profile_id", profile.id);
    error = del.error;
  } else {
    // Switching direction — flip the row
    const upd = await db.from("group_poll_answer_votes").update({ vote } as any)
      .eq("answer_id", answer_id).eq("profile_id", profile.id);
    error = upd.error;
  }
  if (error && error.code !== "23505") {
    console.error("[groups/polls/answer-vote] write error:", JSON.stringify(error));
    return json({ error: "Failed to save your vote" }, 500);
  }

  // Return fresh counts so the client can update without a reload if it wants to
  const { data: rows } = await db.from("group_poll_answer_votes")
    .select("vote").eq("answer_id", answer_id);
  const up = (rows ?? []).filter((r: any) => r.vote === 1).length;
  const down = (rows ?? []).filter((r: any) => r.vote === -1).length;
  return json({ up, down });
};
