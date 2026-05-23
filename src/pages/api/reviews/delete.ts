import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const POST: APIRoute = async (context) => {
  // User client — only used for the session/auth check
  const supabase = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { review_id } = await context.request.json();
  if (!review_id) return json({ error: "Missing review_id" }, 400);

  // Admin client — bypasses RLS for the ownership check and the update
  const db = getSupabaseAdmin() as any;

  // Resolve the caller's profile id
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) return json({ error: "Profile not found" }, 404);

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

  return json({ success: true });
};
