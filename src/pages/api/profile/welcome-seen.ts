import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

// Marks the /welcome showcase as seen so Layout stops redirecting the user
// there. Called by both the primary CTA (Start your tour) and the Skip link.
// Safe to call repeatedly — the Layout redirect only fires when the column is
// NULL, so a second POST is a no-op in practice; kept idempotent on the write
// side anyway (we don't overwrite an existing timestamp).
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { error } = await db
    .from('profiles')
    .update({ welcome_seen_at: new Date().toISOString() })
    .eq('id', profile.id)
    .is('welcome_seen_at', null);

  if (error) {
    console.error('[welcome-seen] update error:', JSON.stringify(error));
    return json({ error: "Failed to mark welcome as seen." }, 500);
  }

  return json({ success: true });
};
