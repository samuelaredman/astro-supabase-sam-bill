// Showcase sections on a profile's Overview tab that the owner can hide.
// Hidden sections aren't shown to visitors, or to the owner outside Edit
// profile, where they can be shown again. Keys are stored in
// profiles.hidden_showcases (the migration's CHECK constraint lists the same keys).

export const SHOWCASE_SECTIONS = [
  { key: 'favorite_game', label: 'Favorite game' },
  { key: 'featured_group', label: 'Join my community' },
  { key: 'video', label: 'Video' },
  { key: 'games', label: 'Game showcase' },
  { key: 'achievements', label: 'Achievement showcase' },
] as const;

export type ShowcaseKey = (typeof SHOWCASE_SECTIONS)[number]['key'];

const KEYS = new Set<string>(SHOWCASE_SECTIONS.map((s) => s.key));

/** Validates a hidden_showcases value: known keys only, deduped. Null if it isn't a string array. */
export function readHiddenShowcases(value: unknown): ShowcaseKey[] | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !KEYS.has(v))) return null;
  return [...new Set(value as ShowcaseKey[])];
}
