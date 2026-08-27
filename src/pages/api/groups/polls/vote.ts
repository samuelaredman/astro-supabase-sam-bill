import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { poll_id, option_id } = await context.request.json();
  if (!poll_id || !option_id) return json({ error: "poll_id and option_id are required" }, 400);

  const { data: poll } = await db.from("group_polls")
    .select("id, group_id, closed").eq("id", poll_id).maybeSingle();
  if (!poll) return json({ error: "Poll not found" }, 404);
  if (poll.closed) return json({ error: "This poll is closed" }, 400);

  const { data: option } = await db.from("group_poll_options")
    .select("id").eq("id", option_id).eq("poll_id", poll_id).maybeSingle();
  if (!option) return json({ error: "Invalid option" }, 400);

  const { data: membership } = await db.from("group_members")
    .select("id").eq("group_id", poll.group_id).eq("profile_id", profile.id).maybeSingle();
  if (!membership) return json({ error: "Not a member of this group" }, 403);

  // Upsert so re-voting just moves the member's vote to the new option
  const { error } = await db.from("group_poll_votes").upsert({
    poll_id, option_id, profile_id: profile.id,
  }, { onConflict: "poll_id,profile_id" });
  if (error) {
    console.error("[groups/polls/vote] error:", JSON.stringify(error));
    return json({ error: "Failed to record vote" }, 500);
  }

  return json({ success: true });
};
