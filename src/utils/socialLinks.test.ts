import { describe, expect, it } from "vitest";
import { SOCIAL_KEYS, validateSocialUrl } from "./socialLinks";

const OK: Record<string, string[]> = {
  steam_url: [
    "https://steamcommunity.com/id/gabelogannewell",
    "https://steamcommunity.com/id/gaben/",
    "https://steamcommunity.com/profiles/76561197960287930",
    "HTTPS://STEAMCOMMUNITY.COM/id/Caps",
  ],
  psn_url: ["https://psnprofiles.com/username", "https://www.psnprofiles.com/user-name/"],
  xbox_url: ["https://xboxgamertag.com/search/Major%20Nelson", "https://www.xboxgamertag.com/search/tag"],
  twitch_url: ["https://twitch.tv/shroud", "https://www.twitch.tv/pokimane/"],
  youtube_url: [
    "https://youtube.com/@MrBeast",
    "https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA",
    "https://youtube.com/c/LinusTechTips",
    "https://youtube.com/user/PewDiePie",
  ],
  discord_url: ["https://discord.gg/abc123", "https://discord.com/invite/abc123"],
  twitter_url: ["https://x.com/jack", "https://twitter.com/jack", "https://www.x.com/jack/"],
  instagram_url: ["https://instagram.com/nasa", "https://www.instagram.com/nasa/"],
  tiktok_url: ["https://tiktok.com/@charlidamelio", "https://www.tiktok.com/@khaby.lame"],
  bluesky_url: ["https://bsky.app/profile/dril.bsky.social", "https://bsky.app/profile/did:plc:abcd"],
  retroachievements_url: ["https://retroachievements.org/user/Scott", "https://retroachievements.org/user/Scott/"],
};

const BAD: Record<string, string[]> = {
  steam_url: [
    "https://steamcommunity.com/gabelogannewell",
    "http://steamcommunity.com/id/gaben",
    "https://steamcommunity.com.evil.com/id/gaben",
    "https://steamcommunity.com/id/gaben/games",
  ],
  psn_url: ["https://psnprofiles.com/", "https://psnprofiles.evil.com/user", "https://psnprofiles.com/user?x=1"],
  xbox_url: ["https://xboxgamertag.com/gamertag", "https://account.xbox.com/profile?gamertag=x"],
  twitch_url: ["https://twitch.tv/shroud/videos", "https://twitch.tv/shroud?tt_medium=x", "twitch.tv/shroud"],
  youtube_url: ["https://youtube.com/watch?v=abc", "https://youtu.be/abc", "https://youtube.com/MrBeast"],
  discord_url: ["https://discord.com/users/123", "https://discord.gg/", "https://discordapp.com/invite/x"],
  twitter_url: ["https://x.com/jack/status/1", "https://nitter.net/jack"],
  instagram_url: ["https://instagram.com/p/abc/", "https://instagr.am/nasa"],
  tiktok_url: ["https://tiktok.com/charlidamelio", "https://tiktok.com/@user/video/123"],
  bluesky_url: ["https://bsky.app/dril", "https://staging.bsky.app/profile/x"],
  retroachievements_url: [
    "https://retroachievements.org/user/",
    "http://retroachievements.org/user/Scott",
    "https://www.retroachievements.org/user/Scott",
    "https://retroachievements.org/user/Scott?tab=feed",
    "https://retroachievements.org.evil.com/user/Scott",
  ],
};

describe("validateSocialUrl", () => {
  it("every platform has good + bad fixtures", () => {
    for (const key of SOCIAL_KEYS) {
      expect(OK[key], key).toBeTruthy();
      expect(BAD[key], key).toBeTruthy();
    }
  });

  for (const [key, urls] of Object.entries(OK)) {
    it(`accepts canonical ${key} links`, () => {
      for (const u of urls) expect(validateSocialUrl(key, u), u).toEqual({ ok: true });
    });
  }

  for (const [key, urls] of Object.entries(BAD)) {
    it(`rejects non-canonical ${key} links`, () => {
      for (const u of urls) expect(validateSocialUrl(key, u).ok, u).toBe(false);
    });
  }

  it("rejects an unknown key", () => {
    expect(validateSocialUrl("myspace_url", "https://myspace.com/x").ok).toBe(false);
  });

  it("no longer has the generic website field", () => {
    expect(SOCIAL_KEYS).not.toContain("website_url");
  });
});
