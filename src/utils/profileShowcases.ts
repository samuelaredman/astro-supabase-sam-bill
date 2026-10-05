// Showcase sections on a profile's Overview tab that the owner can hide.
// Hidden sections aren't rendered for anyone; they're turned back on in
// Settings → Profile showcases. Keys are stored in profiles.hidden_showcases
// (the migration's CHECK constraint lists the same keys).

export const SHOWCASE_SECTIONS = [
  { key: 'favorite_game', label: 'Favorite game', icon: '⭐', desc: 'The one game that defines you.' },
  { key: 'featured_group', label: 'Join my community', icon: '👥', desc: 'A group you invite visitors to join.' },
  { key: 'video', label: 'Video', icon: '🎬', desc: 'Your latest YouTube upload or a featured video.' },
  { key: 'games', label: 'Game showcase', icon: '🎮', desc: 'Three games you want to show off.' },
  { key: 'achievements', label: 'Achievement showcase', icon: '🏆', desc: 'Five achievements you’re proud of.' },
] as const;

export type ShowcaseKey = (typeof SHOWCASE_SECTIONS)[number]['key'];

const KEYS = new Set<string>(SHOWCASE_SECTIONS.map((s) => s.key));

/** Validates a hidden_showcases value: known keys only, deduped. Null if it isn't a string array. */
export function readHiddenShowcases(value: unknown): ShowcaseKey[] | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !KEYS.has(v))) return null;
  return [...new Set(value as ShowcaseKey[])];
}
