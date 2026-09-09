import {
  siSteam,
  siPlaystation,
  siTwitch,
  siYoutube,
  siDiscord,
  siX,
  siInstagram,
  siTiktok,
  siBluesky,
  siRetroachievements,
} from "simple-icons";

/**
 * Profile social / gamer links. Rendered as icon-only brand tiles on the
 * profile (see .social-tile in reviewers/[username].astro) and next to each
 * input in the profile editor. Column names match `profiles.*_url` and the
 * `urlFields` allow-list in src/pages/api/profile/update.ts.
 *
 * Every field is host-locked: `pattern` is the only URL shape update.ts will
 * store, so each tile always points at the right place. `example` is shown in
 * the validation error. Common rules baked into every pattern:
 *   - https only
 *   - the exact host (a lookalike like `x.com.evil.com` fails the `\.` + `/`)
 *   - one profile/identifier segment, optional trailing slash
 *   - no query string, no fragment, no extra path segments
 */

type SimpleIcon = { path: string };

// Wrap a Simple Icons path (24x24 viewBox, single path) as an inline SVG.
// fill=currentColor so the tile can set the glyph colour (white on brand fill).
const wrap = (path: string) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;

const icon = (si: SimpleIcon) => wrap(si.path);

// Xbox isn't in Simple Icons (brand removed) — hand-drawn to the same 24x24 grid.
const XBOX = wrap(
  "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 2c1.74 0 3.36.5 4.73 1.36C14.71 6.49 12 9 12 9S9.29 6.49 7.27 5.36A7.94 7.94 0 0 1 12 4zM5.36 6.73C7.5 8.5 10 11.5 12 15c-2.5 3.5-5 6-6.5 4.5C4.5 18 4 15.5 4 12c0-1.9.5-3.7 1.36-5.27zm13.28 0C19.5 8.3 20 10.1 20 12c0 3.5-.5 6-1.5 7.5-1.5 1.5-4-1-6.5-4.5 2-3.5 4.5-6.5 6.64-8.27z"
);

// One non-empty path segment: no slash, whitespace, query or fragment.
const SEG = "[^/?#\\s]+";

export interface SocialPlatform {
  key: string; // profiles column name
  label: string; // tooltip / aria-label
  color: string; // tile background (brand)
  placeholder: string; // editor input hint
  example: string; // canonical form, shown in the "invalid link" error
  pattern: RegExp; // the only URL shape update.ts will accept/store
  icon: string; // inline SVG markup
}

export const SOCIAL_PLATFORMS: SocialPlatform[] = [
  {
    key: "steam_url",
    label: "Steam",
    color: "#171a21",
    placeholder: "https://steamcommunity.com/id/…",
    example: "https://steamcommunity.com/id/username",
    // vanity URL (/id/) or the numeric fallback (/profiles/7656119…)
    pattern: new RegExp(`^https://steamcommunity\\.com/(id|profiles)/${SEG}/?$`, "i"),
    icon: icon(siSteam),
  },
  {
    key: "psn_url",
    label: "PlayStation",
    color: "#0070D1",
    placeholder: "https://psnprofiles.com/…",
    example: "https://psnprofiles.com/username",
    pattern: new RegExp(`^https://(www\\.)?psnprofiles\\.com/${SEG}/?$`, "i"),
    icon: icon(siPlaystation),
  },
  {
    key: "xbox_url",
    label: "Xbox",
    color: "#107C10",
    placeholder: "https://xboxgamertag.com/search/…",
    example: "https://xboxgamertag.com/search/gamertag",
    pattern: new RegExp(`^https://(www\\.)?xboxgamertag\\.com/search/${SEG}/?$`, "i"),
    icon: XBOX,
  },
  {
    key: "twitch_url",
    label: "Twitch",
    color: "#9146FF",
    placeholder: "https://twitch.tv/…",
    example: "https://twitch.tv/username",
    pattern: new RegExp(`^https://(www\\.)?twitch\\.tv/${SEG}/?$`, "i"),
    icon: icon(siTwitch),
  },
  {
    key: "youtube_url",
    label: "YouTube",
    color: "#FF0000",
    placeholder: "https://youtube.com/@…",
    example: "https://youtube.com/@handle",
    // @handle, or a legacy channel/ , c/ , user/ path
    pattern: new RegExp(
      `^https://(www\\.)?youtube\\.com/(@${SEG}|channel/${SEG}|c/${SEG}|user/${SEG})/?$`,
      "i"
    ),
    icon: icon(siYoutube),
  },
  {
    key: "discord_url",
    label: "Discord",
    color: "#5865F2",
    placeholder: "https://discord.gg/…",
    example: "https://discord.gg/invitecode",
    pattern: new RegExp(`^https://(discord\\.gg|discord\\.com/invite)/${SEG}/?$`, "i"),
    icon: icon(siDiscord),
  },
  {
    key: "twitter_url",
    label: "X (Twitter)",
    color: "#1a1a1a",
    placeholder: "https://x.com/…",
    example: "https://x.com/username",
    pattern: new RegExp(`^https://(www\\.)?(twitter\\.com|x\\.com)/${SEG}/?$`, "i"),
    icon: icon(siX),
  },
  {
    key: "instagram_url",
    label: "Instagram",
    color: "#E4405F",
    placeholder: "https://instagram.com/…",
    example: "https://instagram.com/username",
    pattern: new RegExp(`^https://(www\\.)?instagram\\.com/${SEG}/?$`, "i"),
    icon: icon(siInstagram),
  },
  {
    key: "tiktok_url",
    label: "TikTok",
    color: "#1a1a1a",
    placeholder: "https://tiktok.com/@…",
    example: "https://tiktok.com/@username",
    pattern: new RegExp(`^https://(www\\.)?tiktok\\.com/@${SEG}/?$`, "i"),
    icon: icon(siTiktok),
  },
  {
    key: "bluesky_url",
    label: "Bluesky",
    color: "#1185FE",
    placeholder: "https://bsky.app/profile/…",
    example: "https://bsky.app/profile/name.bsky.social",
    pattern: new RegExp(`^https://bsky\\.app/profile/${SEG}/?$`, "i"),
    icon: icon(siBluesky),
  },
  {
    key: "retroachievements_url",
    label: "RetroAchievements",
    color: "#1065DF",
    placeholder: "https://retroachievements.org/user/…",
    example: "https://retroachievements.org/user/username",
    pattern: new RegExp(`^https://retroachievements\\.org/user/${SEG}/?$`, "i"),
    icon: icon(siRetroachievements),
  },
];

// Back-compat named export (referenced by tests). Same source as the platform entry.
export const RETROACHIEVEMENTS_URL_RE = SOCIAL_PLATFORMS.find(
  (p) => p.key === "retroachievements_url"
)!.pattern;

export const SOCIAL_KEYS = SOCIAL_PLATFORMS.map((p) => p.key);
export const SOCIAL_ICON_SVG: Record<string, string> = Object.fromEntries(
  SOCIAL_PLATFORMS.map((p) => [p.key, p.icon])
);
export const SOCIAL_LABELS: Record<string, string> = Object.fromEntries(
  SOCIAL_PLATFORMS.map((p) => [p.key, p.label])
);
export const SOCIAL_COLORS: Record<string, string> = Object.fromEntries(
  SOCIAL_PLATFORMS.map((p) => [p.key, p.color])
);

/** Validate one social URL against its platform rule. `raw` should be trimmed. */
export function validateSocialUrl(
  key: string,
  raw: string
): { ok: true } | { ok: false; error: string } {
  const platform = SOCIAL_PLATFORMS.find((p) => p.key === key);
  if (!platform) return { ok: false, error: "Unknown link type." };
  if (!platform.pattern.test(raw))
    return { ok: false, error: `That doesn't look like a ${platform.label} link — use ${platform.example}` };
  return { ok: true };
}
