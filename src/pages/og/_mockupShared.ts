// Shared helpers for the dev-only outreach mockup routes (mockup.jpg.ts,
// mockup-group.jpg.ts). Underscore-prefixed, so Astro's file-based router
// ignores this — it's a plain module, not a route.
import { getSupabase } from "../../utils/database";
import { igdbImage } from "../../utils/format";

/**
 * Resolves a free-text game title or exact slug to { title, coverUrl } via
 * the games table (slug match, falling back to a fuzzy title match) — same
 * lookup mockup.jpg.ts already used, factored out so mockup-group.jpg.ts can
 * resolve a whole list of games the same way.
 */
export async function resolveGameCover(
  gameQuery: string,
  coverOverrideUrl: string | null
): Promise<{ title: string; coverUrl: string | null }> {
  if (coverOverrideUrl) {
    return { title: gameQuery, coverUrl: coverOverrideUrl };
  }

  const db = getSupabase();
  const { data: exact } = await db
    .from("games").select("title, cover_img_url").eq("slug", gameQuery).maybeSingle();
  if (exact) {
    return { title: exact.title, coverUrl: exact.cover_img_url ? igdbImage(exact.cover_img_url, "t_cover_big") : null };
  }

  const { data: fuzzy } = await db
    .from("games").select("title, cover_img_url").ilike("title", `%${gameQuery}%`).limit(1).maybeSingle();
  if (fuzzy) {
    return { title: fuzzy.title, coverUrl: fuzzy.cover_img_url ? igdbImage(fuzzy.cover_img_url, "t_cover_big") : null };
  }

  return { title: gameQuery, coverUrl: null };
}
