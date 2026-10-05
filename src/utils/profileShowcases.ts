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

/** Validates a hidden_showcases / showcase_order value: known keys only, deduped. Null if it isn't a string array. */
export function readShowcaseKeys(value: unknown): ShowcaseKey[] | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !KEYS.has(v))) return null;
  return [...new Set(value as ShowcaseKey[])];
}

/**
 * The full render order: the saved order's known keys first, then any section
 * it doesn't mention (never saved, or added since) in the default order.
 */
export function readShowcaseOrder(value: unknown): ShowcaseKey[] {
  const saved = Array.isArray(value) ? value.filter((v): v is ShowcaseKey => typeof v === 'string' && KEYS.has(v)) : [];
  const order = [...new Set(saved)];
  for (const s of SHOWCASE_SECTIONS) if (!order.includes(s.key)) order.push(s.key);
  return order;
}
