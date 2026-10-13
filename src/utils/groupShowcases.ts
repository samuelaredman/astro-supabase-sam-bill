/**
 * The group Overview's sections, as showcases like a profile's
 * (src/utils/profileShowcases.ts): whoever can edit the group orders them and
 * hides the ones they don't want, in "Customize" on the Overview. Two stacks —
 * the main column and the sidebar — each in its own order; "At a glance" and
 * "Members" stay put.
 *
 * Stored in groups.overview_order / overview_hidden (migration 20261008000000,
 * whose CHECK constraints list the same keys).
 */

export const GROUP_SHOWCASE_SECTIONS = [
  { key: "now_featuring", label: "Now featuring", column: "main" },
  { key: "video", label: "Video", column: "main" },
  { key: "announcements", label: "Announcements", column: "main" },
  { key: "top_games", label: "Most played", column: "main" },
  { key: "top_rated", label: "Top rated", column: "main" },
  { key: "hot_take", label: "Hot take", column: "main" },
  { key: "agreement", label: "Consensus & divisive", column: "main" },
  { key: "hidden_gems", label: "Hidden gems", column: "main" },
  { key: "critic_spectrum", label: "Critic spectrum", column: "main" },
  { key: "score_distribution", label: "Score distribution", column: "main" },
  { key: "recent_reviews", label: "Recent reviews", column: "side" },
  { key: "polls", label: "Polls", column: "side" },
  { key: "want_to_play", label: "Want to play", column: "side" },
] as const;

export type GroupShowcaseKey = (typeof GROUP_SHOWCASE_SECTIONS)[number]["key"];

const KEYS = new Set<string>(GROUP_SHOWCASE_SECTIONS.map((s) => s.key));
const LABELS = new Map<string, string>(GROUP_SHOWCASE_SECTIONS.map((s) => [s.key, s.label]));
const COLUMNS = new Map<string, string>(GROUP_SHOWCASE_SECTIONS.map((s) => [s.key, s.column]));

/** Hidden until a group customizes its Overview: lists that rarely add much. */
export const DEFAULT_HIDDEN_SHOWCASES: GroupShowcaseKey[] = [
  "hot_take", "agreement", "hidden_gems", "critic_spectrum", "score_distribution",
];

/**
 * The old per-section switches in group settings (stats_config.show_*), so a
 * section a group had switched off stays hidden until it customizes.
 */
const LEGACY_FLAGS: Partial<Record<GroupShowcaseKey, string[]>> = {
  announcements: ["show_announcements"],
  top_games: ["show_top_games"],
  top_rated: ["show_top_rated"],
  hot_take: ["show_hot_take"],
  agreement: ["show_consensus", "show_divergent"],
  hidden_gems: ["show_hidden_gems"],
  critic_spectrum: ["show_critic_spectrum"],
  score_distribution: ["show_score_distribution"],
  recent_reviews: ["show_recent_reviews"],
  polls: ["show_polls"],
  want_to_play: ["show_watchlist"],
};

export function groupShowcaseLabel(key: string): string {
  return LABELS.get(key) ?? key;
}

/** Validates an overview_order / overview_hidden value: known keys only, deduped. Null if it isn't a string array. */
export function readGroupShowcaseKeys(value: unknown): GroupShowcaseKey[] | null {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || !KEYS.has(v))) return null;
  return [...new Set(value as GroupShowcaseKey[])];
}

/**
 * The full render order: the saved order's known keys first, then any section
 * it doesn't mention (never saved, or added since) in the default order.
 */
export function readGroupShowcaseOrder(value: unknown): GroupShowcaseKey[] {
  const saved = Array.isArray(value)
    ? value.filter((v): v is GroupShowcaseKey => typeof v === "string" && KEYS.has(v))
    : [];
  const order = [...new Set(saved)];
  for (const s of GROUP_SHOWCASE_SECTIONS) if (!order.includes(s.key)) order.push(s.key);
  return order;
}

/** The order of one column's sections. */
export function showcaseColumn(order: GroupShowcaseKey[], column: "main" | "side"): GroupShowcaseKey[] {
  return order.filter((k) => COLUMNS.get(k) === column);
}

/**
 * The hidden sections: what the group saved, or — before it ever customizes —
 * the defaults plus anything switched off in its old settings.
 */
export function readGroupShowcaseHidden(
  saved: unknown,
  statsConfig: Record<string, unknown> | null | undefined,
): Set<GroupShowcaseKey> {
  if (saved != null) return new Set(readGroupShowcaseKeys(saved) ?? []);
  const hidden = new Set<GroupShowcaseKey>(DEFAULT_HIDDEN_SHOWCASES);
  for (const [key, flags] of Object.entries(LEGACY_FLAGS) as [GroupShowcaseKey, string[]][]) {
    if (flags.every((f) => statsConfig?.[f] === false)) hidden.add(key);
  }
  return hidden;
}

/**
 * The group owner's linked YouTube channel — the "latest upload" for the
 * Overview video comes from it. The owner is the member with role 'owner'
 * (groups.created_by doesn't follow an ownership transfer).
 */
export async function groupOwnerYouTube(
  db: any,
  groupId: string,
): Promise<{ username: string; youtubeUrl: string | null } | null> {
  const { data, error } = await db
    .from("group_members")
    .select("profiles ( username, youtube_url )")
    .eq("group_id", groupId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  if (error) console.error("[groupShowcases] owner lookup:", JSON.stringify(error));
  const p = data?.profiles;
  return p ? { username: p.username, youtubeUrl: p.youtube_url ?? null } : null;
}
