import type { SupabaseAdmin } from "./api";

/**
 * The site group ("Chekpoint") is the one group every profile is in, so the
 * group stats work site-wide. It's the row with groups.is_site_group (migration
 * 20260912000003): a trigger adds every new profile to it, and triggers stop its
 * members being deleted and the group itself being deleted. The routes below
 * check first so people get a sentence instead of a database error.
 */

export const SITE_GROUP_LEAVE_ERROR = "Everyone on Chekpoint is in this group, so it can't be left.";
export const SITE_GROUP_REMOVE_ERROR = "Everyone on Chekpoint is in this group, so no one can be removed from it.";
export const SITE_GROUP_DELETE_ERROR = "This is the site-wide group, so it can't be deleted.";

export async function isSiteGroup(db: SupabaseAdmin, groupId: string): Promise<boolean> {
  const { data, error } = await db.from("groups").select("is_site_group").eq("id", groupId).maybeSingle();
  if (error) console.error("[siteGroup] lookup error:", JSON.stringify(error));
  return !!data?.is_site_group;
}
