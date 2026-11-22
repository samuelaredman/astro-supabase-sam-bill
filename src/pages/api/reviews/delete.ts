import type { APIRoute } from "astro";
import { requireAuth, json } from "../../../utils/api";
import { purgeReviewsPublicCache } from "../../../utils/cache";

export const POST: APIRoute = async (context) => {
  const { auth, response } = await requireAuth(context);
  if (!auth) return response;
  const { profile, db } = auth;

  const { review_id } = await context.request.json();
  if (!review_id) return json({ error: "Missing review_id" }, 400);

  // Verify ownership before soft-deleting
  const { data: review } = await db
    .from("reviews")
    .select("id, profile_id")
    .eq("id", review_id)
    .single();

  if (!review) return json({ error: "Review not found" }, 404);
  if (review.profile_id !== profile.id) return json({ error: "Forbidden" }, 403);

  // Soft delete — set status to 'deleted'
  const { error: updateError } = await db
    .from("reviews")
    .update({ status: "deleted" })
    .eq("id", review_id);

  if (updateError) {
    console.error("[delete] update error:", updateError);
    return json({ error: `Failed to delete review: ${updateError.message}` }, 500);
  }

  // Invalidate every anon-cached surface that renders reviews — without this,
  // the home page / game page / profile would keep serving the deleted review
  // from Netlify's shared cache for up to max-age + stale-while-revalidate.
  // Non-fatal: purge failures log and swallow so the delete still returns success.
  await purgeReviewsPublicCache();

  return json({ success: true });
};
