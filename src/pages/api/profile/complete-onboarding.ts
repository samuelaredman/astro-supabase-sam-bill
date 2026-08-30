import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { error } = await db
    .from('profiles')
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq('id', profile.id);

  if (error) {
    console.error('[complete-onboarding] update error:', JSON.stringify(error));
    return json({ error: "Failed to mark onboarding complete." }, 500);
  }

  return json({ success: true });
};
