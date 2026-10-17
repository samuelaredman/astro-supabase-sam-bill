// Badge definitions. Add a new entry here to introduce a new assignable badge;
// no migration needed since profile_badges keys by slug text.
//
// The admin assignment UI (src/pages/admin/users/[username].astro) enumerates
// listBadges() to populate its toggles, and ProfileBadge.astro reads getBadge()
// to render a chip for a given slug. Rendering is a no-op for unknown slugs so
// stale slugs in profile_badges don't crash the UI if a badge is retired.

export type BadgeDef = {
  slug: string;
  label: string;
  description: string;
  color: string;   // CSS color — drives chip background, border, text
  icon: string;    // 1-2 char glyph, rendered inline before the label
};

export const BADGES: Record<string, BadgeDef> = {
  "chekpoint-creator": {
    slug: "chekpoint-creator",
    label: "Chekpoint Creator",
    description: "Partnered content creator — featured on Chekpoint.",
    color: "#6050c8",
    icon: "✦",
  },
};

export function getBadge(slug: string): BadgeDef | null {
  return BADGES[slug] ?? null;
}

export function listBadges(): BadgeDef[] {
  return Object.values(BADGES);
}

// Extract badge slugs from a profile row's nested `profile_badges(badge_slug)`
// select. Tolerates missing/null to make call sites forgiving.
export function readBadgeSlugs(row: unknown): string[] {
  if (!row || typeof row !== "object") return [];
  const rec = row as Record<string, unknown>;
  const list = rec.profile_badges;
  if (!Array.isArray(list)) return [];
  return list
    .map((b: any) => (typeof b?.badge_slug === "string" ? b.badge_slug : null))
    .filter((s): s is string => !!s);
}
