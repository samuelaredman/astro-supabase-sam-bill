import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../../utils/api";

// POST {} -> mark the one-time onboarding "import from Backloggd" step as done,
// so it never shows again. Called on skip and on first import completion.
export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { error } = await db
    .from("profiles")
    .update({ backloggd_import_done_at: new Date().toISOString() })
    .eq("id", profile.id);

  if (error) {
    console.error("[import/backloggd/skip-onboarding] error:", JSON.stringify(error));
    return json({ error: "Could not save." }, 500);
  }
  return json({ success: true });
};
