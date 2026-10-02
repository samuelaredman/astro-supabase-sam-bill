/**
 * Custom group links: chekpoint.gg/c/<slug> → the group. Same rule as the
 * groups_slug_format constraint: lowercase letters, digits and inner hyphens,
 * 3–32 characters.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

export function normalizeGroupSlug(
  input: string
): { ok: true; slug: string } | { ok: false; error: string } {
  const slug = input.trim().toLowerCase().replace(/^\/?c\//, "");
  if (!SLUG_RE.test(slug)) {
    return {
      ok: false,
      error: "Use 3–32 lowercase letters, numbers or hyphens, starting and ending with a letter or number.",
    };
  }
  return { ok: true, slug };
}

/** The path to share for a group: its custom link if it has one. */
export function groupPath(group: { id: string; slug?: string | null }): string {
  return group.slug ? `/c/${group.slug}` : `/groups/${group.id}`;
}
