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
  { key: "verdict_board", label: "Verdict board", column: "main" },
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

/**
 * The old hot_take / agreement / hidden_gems sections folded into verdict_board.
 * Any one of them appearing in a saved overview_order means "render the verdict
 * board" at that position; after the first, further hits dedupe.
 */
const LEGACY_VERDICT_KEYS = new Set(["hot_take", "agreement", "hidden_gems"]);

/** Hidden until a group customizes its Overview: lists that rarely add much. */
export const DEFAULT_HIDDEN_SHOWCASES: GroupShowcaseKey[] = [
  "verdict_board", "critic_spectrum", "score_distribution",
];

/**
 * The old per-section switches in group settings (stats_config.show_*), so a
 * section a group had switched off stays hidden until it customizes.
 */
const LEGACY_FLAGS: Partial<Record<GroupShowcaseKey, string[]>> = {
  announcements: ["show_announcements"],
  top_games: ["show_top_games"],
  top_rated: ["show_top_rated"],
  // All three fold into verdict_board — only hide it when every rolled-up
  // section was switched off, so a group that turned off only one still sees
  // the strip once it rolls out.
  verdict_board: ["show_hot_take", "show_consensus", "show_divergent", "show_hidden_gems"],
  critic_spectrum: ["show_critic_spectrum"],
  score_distribution: ["show_score_distribution"],
  recent_reviews: ["show_recent_reviews"],
  polls: ["show_polls"],
  want_to_play: ["show_watchlist"],
};

/** Rewrite legacy keys to verdict_board, dedupe, and drop unknown strings. */
function normalizeKeys(raw: unknown): GroupShowcaseKey[] {
  if (!Array.isArray(raw)) return [];
  const out: GroupShowcaseKey[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const key = LEGACY_VERDICT_KEYS.has(v) ? "verdict_board" : v;
    if (!KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key as GroupShowcaseKey);
  }
  return out;
}

export function groupShowcaseLabel(key: string): string {
  return LABELS.get(key) ?? key;
}

/**
 * Validates an overview_order / overview_hidden value: known keys only, deduped,
 * legacy verdict-board keys collapsed. Null if it isn't a string array; empty
 * array is a valid value (means "clear everything").
 */
export function readGroupShowcaseKeys(value: unknown): GroupShowcaseKey[] | null {
  if (!Array.isArray(value)) return null;
  // Reject arrays with non-string entries, but let the normalizer map legacy
  // keys (hot_take / agreement / hidden_gems) onto verdict_board.
  if (value.some((v) => typeof v !== "string")) return null;
  return normalizeKeys(value);
}

/**
 * The full render order: the saved order's known keys first, then any section
 * it doesn't mention (never saved, or added since) in the default order.
 */
export function readGroupShowcaseOrder(value: unknown): GroupShowcaseKey[] {
  const order = normalizeKeys(value);
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
