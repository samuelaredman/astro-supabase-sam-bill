import type { APIRoute } from "astro";
import { createSupabaseServerClientFromContext, getSupabaseAdmin } from "../../../utils/database";
import { json } from "../../../utils/api";

// Drives the badge on the Drafts nav item in Layout.astro. Sum of
// draft-status rows across reviews + recommendations for the current user —
// same two tables the /drafts page queries, same shape as
// /api/notifications/count.
export const GET: APIRoute = async (context) => {
  const userClient = createSupabaseServerClientFromContext(context);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ count: 0 });

  const db = getSupabaseAdmin();
  const { data: profile } = await (db as any)
    .from('profiles').select('id').eq('auth_user_id', user.id).single();
  if (!profile) return json({ count: 0 });

  const [{ count: reviewCount }, { count: recCount }] = await Promise.all([
    (db as any).from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile.id)
      .eq('status', 'draft'),
    (db as any).from('recommendations')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profile.id)
      .eq('status', 'draft'),
  ]);

  return json({ count: (reviewCount ?? 0) + (recCount ?? 0) });
};
