import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { LANDING_CTA_IDS } from "../../../utils/landingCtas";

// Attributes a just-signed-up account to the landing nudge it saw. Called
// client-side from the home page once, after the signup round-trip. It never
// touches the fragile auth flow — it only tags an existing profile.
//
// Guarded so it can only ever write for a genuinely new signup, and only once:
//   - signup_cta IS NULL  → never overwrite an existing attribution
//   - created_at recent   → an older account (e.g. someone who logged out, saw
//                           the nudge, then logged back in) is not attributed
// A stale localStorage value from a long-time user is therefore a harmless
// no-op. profiles.id comes from requireAuth, so a user can only tag their own.
const ATTRIBUTION_WINDOW_MS = 60 * 60 * 1000;

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  let body: { cta?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid body." }, 400);
  }

  const cta = typeof body.cta === "string" ? body.cta : "";
  if (!LANDING_CTA_IDS.includes(cta)) {
    return json({ error: "Unknown cta." }, 400);
  }

  const cutoff = new Date(Date.now() - ATTRIBUTION_WINDOW_MS).toISOString();
  const { error } = await db
    .from("profiles")
    .update({ signup_cta: cta })
    .eq("id", profile.id)
    .is("signup_cta", null)
    .gt("created_at", cutoff);

  if (error) {
    console.error("[signup-cta] update error:", JSON.stringify(error));
    return json({ error: "Failed to record." }, 500);
  }

  // No row match (old account / already set) is a success — nothing to do.
  return json({ success: true });
};
