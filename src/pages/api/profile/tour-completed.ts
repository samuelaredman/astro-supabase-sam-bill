import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

// Marks the chained profile→review tour complete. Also stamps
// onboarding_completed_at so legacy code paths that still check that column
// see this user as fully onboarded, and so the historical grandfather semantic
// (onboarding_completed_at IS NOT NULL ⇒ fully-set-up user) stays consistent.
// Called once, from TourManager's chained-tour terminal onDone.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const now = new Date().toISOString();
  const { error } = await db
    .from('profiles')
    .update({ tour_completed_at: now, onboarding_completed_at: now })
    .eq('id', profile.id)
    .is('tour_completed_at', null);

  if (error) {
    console.error('[tour-completed] update error:', JSON.stringify(error));
    return json({ error: "Failed to mark tour complete." }, 500);
  }

  return json({ success: true });
};
