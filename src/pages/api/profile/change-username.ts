export const prerender = false;
import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { validateName } from "../../../utils/moderation/nameRules";
import { likeEscape } from "../../../utils/usernameHistory";

const DAY_MS = 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * DAY_MS; // between real renames
const SETTLING_MS = 48 * 60 * 60 * 1000; // free corrections after the first rename of a cycle
const HOLD_MS = 31 * DAY_MS; // reclaim reservation on the name you leave
const TENURE_MS = 30 * DAY_MS; // must have held a name this long to earn a hold on it
const SETTLING_MAX = 5; // hard cap on hops inside the settling window

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile: authProfile, db } = auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const desired = typeof body?.username === "string" ? body.username.trim() : "";
  if (!desired) return json({ error: "Enter a username." }, 400);

  // Full username state for this profile.
  const { data: me, error: meErr } = await (db as any)
    .from("profiles")
    .select(
      "id, username, username_changed_at, username_since, username_prev, username_prev_until, username_settling_count, username_locked"
    )
    .eq("id", authProfile.id)
    .single();
  if (meErr || !me) return json({ error: "Profile not found." }, 404);

  if (me.username_locked)
    return json(
      { error: "Username changes are disabled for this account. Contact support." },
      403
    );

  const currentName = String(me.username);
  if (desired === currentName) return json({ error: "That's already your username." }, 400);

  // Pure capitalization fix (same letters, different case): no cooldown, no
  // reclaim hold, no format re-check — it's the name they already have. Just
  // update the string and leave a history row so old-case links still redirect.
  if (desired.toLowerCase() === currentName.toLowerCase()) {
    const { error: caseErr } = await (db as any)
      .from("profiles")
      .update({ username: desired })
      .eq("id", me.id);
    if (caseErr) {
      if ((caseErr as any).code === "23505")
        return json({ error: "That name was just taken. Try another." }, 409);
      console.error("[profile/change-username] case-update error:", JSON.stringify(caseErr));
      return json({ error: "Could not change your username." }, 500);
    }
    const { error: caseHistErr } = await (db as any)
      .from("username_history")
      .insert({ profile_id: me.id, old_username: currentName });
    if (caseHistErr)
      console.error(
        "[profile/change-username] case history insert error (non-fatal):",
        JSON.stringify(caseHistErr)
      );
    return json({ ok: true, username: desired });
  }

  // Format + content gate — the exact same rules signup enforces.
  const check = validateName(desired);
  if (!check.ok) return json({ error: check.error }, 400);

  const now = Date.now();
  const changedAt = me.username_changed_at ? new Date(me.username_changed_at).getTime() : null;
  const firstEver = changedAt === null;
  const inSettling = changedAt !== null && now - changedAt < SETTLING_MS;

  // Cooldown — bypassed on the very first rename and inside the 48h settling window.
  if (!firstEver && !inSettling && now - changedAt < COOLDOWN_MS) {
    const daysLeft = Math.ceil((COOLDOWN_MS - (now - changedAt)) / DAY_MS);
    return json(
      { error: `You can change your username again in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` },
      429
    );
  }

  if (inSettling && (me.username_settling_count ?? 0) >= SETTLING_MAX)
    return json(
      { error: "Too many username changes in a short time. Try again after the cooldown." },
      429
    );

  // Availability — live username, case-insensitive.
  const { data: taken } = await (db as any)
    .from("profiles")
    .select("id")
    .ilike("username", likeEscape(desired))
    .maybeSingle();
  if (taken && taken.id !== me.id) return json({ error: "That name isn't available." }, 409);

  // Availability — an active reclaim hold owned by someone else.
  const { data: heldByOther } = await (db as any)
    .from("profiles")
    .select("id")
    .ilike("username_prev", likeEscape(desired))
    .gt("username_prev_until", new Date(now).toISOString())
    .maybeSingle();
  if (heldByOther && heldByOther.id !== me.id)
    return json({ error: "That name is reserved by another user." }, 409);

  // ---- all gates passed: compute the next state ----
  const sinceAt = me.username_since ? new Date(me.username_since).getTime() : now;
  const tenureMs = now - sinceAt;

  const update: Record<string, any> = {
    username: desired,
    username_since: new Date(now).toISOString(),
  };

  if (inSettling) {
    // Clock stays pinned to the first rename of this cycle; hops earn no hold.
    update.username_settling_count = (me.username_settling_count ?? 0) + 1;
  } else {
    update.username_changed_at = new Date(now).toISOString();
    update.username_settling_count = 1;
  }

  // Reclaim hold on the name we're leaving. Only for a real rename, only if we
  // held it long enough, and only if we've never reclaimed it once already.
  let placeHold = false;
  if (!inSettling && tenureMs >= TENURE_MS) {
    const { data: priorReclaim } = await (db as any)
      .from("username_history")
      .select("id")
      .eq("profile_id", me.id)
      .ilike("old_username", likeEscape(currentName))
      .not("reclaimed_at", "is", null)
      .maybeSingle();
    placeHold = !priorReclaim;
  }

  if (placeHold) {
    update.username_prev = currentName;
    update.username_prev_until = new Date(now + HOLD_MS).toISOString();
  } else if (!inSettling) {
    // One hold slot only, and this release didn't earn one — clear any stale hold.
    update.username_prev = null;
    update.username_prev_until = null;
  }

  // If we're taking back our own reserved name, the reservation is now spent.
  if (
    me.username_prev &&
    String(me.username_prev).toLowerCase() === desired.toLowerCase()
  ) {
    update.username_prev = null;
    update.username_prev_until = null;
  }

  const { error: updErr } = await (db as any)
    .from("profiles")
    .update(update)
    .eq("id", me.id);
  if (updErr) {
    if ((updErr as any).code === "23505")
      return json({ error: "That name was just taken. Try another." }, 409);
    console.error("[profile/change-username] update error:", JSON.stringify(updErr));
    return json({ error: "Could not change your username." }, 500);
  }

  // Rename trail for 301 redirects from stale links.
  const { error: histErr } = await (db as any)
    .from("username_history")
    .insert({ profile_id: me.id, old_username: currentName });
  if (histErr)
    console.error(
      "[profile/change-username] history insert error (non-fatal):",
      JSON.stringify(histErr)
    );

  // If this rename is us reclaiming a name we previously left, stamp that
  // history row so it can never earn a second hold for us.
  const { error: reclaimErr } = await (db as any)
    .from("username_history")
    .update({ reclaimed_at: new Date(now).toISOString() })
    .eq("profile_id", me.id)
    .ilike("old_username", likeEscape(desired))
    .is("reclaimed_at", null);
  if (reclaimErr)
    console.error(
      "[profile/change-username] reclaim stamp error (non-fatal):",
      JSON.stringify(reclaimErr)
    );

  return json({ ok: true, username: desired });
};
