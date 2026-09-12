import type { SupabaseAdmin } from "./api";
import { getSupabaseAdmin } from "./database";
import { groupPath } from "./groupSlug";

export type JoinOutcome =
  | { ok: true; groupId: string }
  | { ok: false; status: number; error: string; code?: "PRIVATE_GROUP" | "REQUIRES_APPROVAL" | "ALREADY_MEMBER" };

/**
 * Adds the profile to a group as a member, if the group lets them in without
 * approval: a public group that doesn't require approval, or a private group
 * with its current invite code. The single set of join rules — used by the
 * Join button (/api/groups/join) and by the join after signup.
 */
export async function joinGroup(
  db: SupabaseAdmin,
  profileId: string,
  target: { groupId?: string | null; inviteCode?: string | null }
): Promise<JoinOutcome> {
  const inviteCode = target.inviteCode ? target.inviteCode.toUpperCase() : null;

  // Resolve the group — by invite code if there is one, else by id
  let groupQuery = db.from("groups").select("id, visibility, invite_code, requires_approval");
  if (inviteCode) {
    groupQuery = groupQuery.eq("invite_code", inviteCode);
  } else if (target.groupId) {
    groupQuery = groupQuery.eq("id", target.groupId);
  } else {
    return { ok: false, status: 400, error: "group_id or invite_code required" };
  }

  const { data: group } = await groupQuery.maybeSingle();
  if (!group) return { ok: false, status: 404, error: "Group not found" };

  // Private groups: only joinable via a valid admin-sent invite code
  if (group.visibility === "private") {
    if (!inviteCode || group.invite_code !== inviteCode) {
      return { ok: false, status: 403, error: "This group is private. Request to join or use an invite link.", code: "PRIVATE_GROUP" };
    }
  } else if (group.requires_approval) {
    return { ok: false, status: 403, error: "This group requires approval to join. Submit a join request instead.", code: "REQUIRES_APPROVAL" };
  }

  const { data: existing } = await db.from("group_members")
    .select("id").eq("group_id", group.id).eq("profile_id", profileId).maybeSingle();
  if (existing) return { ok: false, status: 409, error: "Already a member", code: "ALREADY_MEMBER" };

  const { error } = await db.from("group_members").insert({
    group_id: group.id,
    profile_id: profileId,
    role: "member",
  });
  if (error) {
    console.error("[groupJoin] insert error:", JSON.stringify(error));
    return { ok: false, status: 500, error: error.message };
  }

  // Mark the direct invite as accepted if one exists
  if (inviteCode) {
    await db.from("group_invites")
      .update({ status: "accepted" })
      .eq("group_id", group.id)
      .eq("invited_profile_id", profileId);
  }

  return { ok: true, groupId: group.id };
}

// ── Join after signup ────────────────────────────────────────────────────
// Signing up from a group page stores the group in the new user's metadata
// (auth.users.raw_user_meta_data.pending_group) — the one place that survives
// the email round trip, even when the link is opened on another device.
// /auth/confirm (and set-session, for its hash-fragment branch) calls
// landingAfterConfirm once the session exists: it joins the group, removes the
// key, and sends them to the group instead of the feed. Users can write their
// own metadata, so the join goes through joinGroup's rules like any other.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_RE = /^[A-Za-z0-9]{1,16}$/;

export interface PendingGroup {
  id: string;
  code: string | null;
}

/** Validated pending-group value for signup metadata, or null if the input isn't one. */
export function toPendingGroup(groupId: unknown, inviteCode: unknown): PendingGroup | null {
  if (typeof groupId !== "string" || !UUID_RE.test(groupId)) return null;
  const code = typeof inviteCode === "string" && CODE_RE.test(inviteCode) ? inviteCode : null;
  return { id: groupId.toLowerCase(), code };
}

export interface PendingGroupResult {
  group: { id: string; name: string; slug: string | null };
  joined: boolean;
}

/**
 * Joins the group a user signed up from, once, and clears it from their
 * metadata whatever the outcome. Returns null when there was nothing to do.
 * `joined` is true when they're now a member (including if they already were);
 * false means the group needs a request or an invite, so send them to it.
 */
export async function consumePendingGroup(
  db: SupabaseAdmin,
  user: { id: string; user_metadata?: Record<string, any> | null },
  profileId: string
): Promise<PendingGroupResult | null> {
  const raw = user.user_metadata?.pending_group;
  if (!raw) return null;

  // Clear first so a failure below can't retry on every sign-in. GoTrue merges
  // user_metadata and deletes keys set to null, so username etc. are kept.
  const { error: clearError } = await db.auth.admin.updateUserById(user.id, {
    user_metadata: { pending_group: null },
  });
  if (clearError) {
    console.error("[groupJoin] clear pending_group error:", JSON.stringify(clearError));
    return null;
  }

  const pending = toPendingGroup(raw?.id, raw?.code);
  if (!pending) return null;

  const { data: group } = await db
    .from("groups").select("id, name, slug").eq("id", pending.id).maybeSingle();
  if (!group) return null;

  const outcome = await joinGroup(db, profileId, { groupId: pending.id, inviteCode: pending.code });
  const joined = outcome.ok || outcome.code === "ALREADY_MEMBER";
  if (!joined) console.log("[groupJoin] pending group not joined:", group.id, outcome.status, outcome.code ?? outcome.error);

  return { group, joined };
}

/**
 * Where to send someone who has just confirmed their email: the group they
 * signed up from — joined if its rules allow, otherwise its page, where they
 * can request to join — or null for the usual landing. Never throws: a
 * failure here must not break confirmation.
 */
export async function landingAfterConfirm(
  user: { id: string; user_metadata?: Record<string, any> | null } | null | undefined
): Promise<string | null> {
  if (!user?.user_metadata?.pending_group) return null;
  try {
    const db = getSupabaseAdmin();
    const { data: profile } = await db
      .from("profiles").select("id").eq("auth_user_id", user.id).maybeSingle();
    if (!profile) return null;
    const pending = await consumePendingGroup(db, user, profile.id);
    return pending ? groupPath(pending.group) : null;
  } catch (e) {
    console.error("[groupJoin] landingAfterConfirm error (non-fatal):", e);
    return null;
  }
}
