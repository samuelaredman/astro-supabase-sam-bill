export const prerender = false;
import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { fetchAccount, isXboxAuthInvalid, looksLikeApiKey } from "../../../utils/xbox";

// Manual Xbox connect flow — paste your personal OpenXBL API key.
//
// We used to run OpenXBL's "Sign in with Xbox" OAuth flow in
// /api/auth/xbox-connect, but OpenXBL rebuilt their site and the
// `/app/auth/<key>` OAuth endpoint it depended on now returns 404.
// Until they publish a replacement URL, this endpoint lets a user paste
// their personal OpenXBL API key (generated at xbl.io after signing in
// with Microsoft) and link their Xbox profile that way. The already-live
// /api/xbox/sync-* endpoints work the same regardless of which flow
// stored the key.
//
// POST { api_key: string }
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  let body: any;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const apiKeyRaw = typeof body?.api_key === "string" ? body.api_key.trim() : "";
  if (!apiKeyRaw) return json({ error: "Paste your OpenXBL API key." }, 400);
  if (!looksLikeApiKey(apiKeyRaw))
    return json({ error: "That doesn't look like an OpenXBL API key — copy the whole thing from your xbl.io dashboard." }, 400);

  // Validate against api.xbl.io/v2/account — returns XUID + gamertag.
  let account: { xuid: string; gamertag: string | null } | null;
  try {
    account = await fetchAccount(apiKeyRaw);
  } catch (e) {
    if (isXboxAuthInvalid(e))
      return json({ error: "OpenXBL rejected that API key. Double-check it on your xbl.io dashboard." }, 400);
    console.error("[xbox/connect-manual] fetchAccount error:", e);
    return json({ error: "Couldn't reach OpenXBL right now. Try again in a moment." }, 502);
  }
  if (!account?.xuid)
    return json({ error: "OpenXBL couldn't resolve an Xbox account for that key." }, 400);

  const { error, data: updated } = await (db as any)
    .from("profiles")
    .update({
      xbox_xuid: account.xuid,
      xbox_gamertag: account.gamertag,
      xbox_api_key: apiKeyRaw,
    })
    .eq("id", profile.id)
    .select("xbox_xuid, xbox_gamertag")
    .single();

  if (error) {
    // Unique constraint on xbox_xuid prevents two profiles from linking
    // the same Xbox account.
    if (error.code === "23505") {
      return json({ error: "That Xbox account is already linked to another Chekpoint profile." }, 409);
    }
    console.error("[xbox/connect-manual] profile update error:", JSON.stringify(error));
    return json({ error: "Couldn't save that key — try again." }, 500);
  }

  return json({ ok: true, gamertag: updated?.xbox_gamertag ?? null, xuid: updated?.xbox_xuid ?? null });
};
