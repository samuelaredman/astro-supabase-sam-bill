import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { joinGroup } from "../../../utils/groupJoin";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const body = await context.request.json();
  const { group_id, invite_code } = body;

  // Join rules (public / approval / private invite code) live in joinGroup
  const outcome = await joinGroup(db, profile.id, { groupId: group_id, inviteCode: invite_code });
  if (!outcome.ok) {
    return json(outcome.code ? { error: outcome.error, code: outcome.code } : { error: outcome.error }, outcome.status);
  }

  return json({ id: outcome.groupId });
};
