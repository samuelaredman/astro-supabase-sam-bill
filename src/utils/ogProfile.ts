import { h, truncate, scoreColor, hexToRgba, OG_ACCENT, OG_BG } from "./og";

export interface ProfileOgData {
  username: string;
  avatarDataUri: string | null;
  bannerDataUri: string | null;
  bannerPosition: string | null;
  reviewCount: number;
  avgScore: number | null;
  topGenre: string | null;
}

const WIDTH = 1200;
const HEIGHT = 630;
const ACCENT = OG_ACCENT;
const BG = OG_BG;
const AVATAR_SIZE = 148;

// The username is a handle, not a headline — always a single line (never
// wrapped), just scaled down a tier as it gets longer so it never crowds
// the stats caption line below it.
function usernameFontSize(username: string): number {
  if (username.length <= 12) return 74;
  if (username.length <= 20) return 60;
  return 48;
}

export function buildProfileOgTree(data: ProfileOgData): any {
  const children: any[] = [];

  if (data.bannerDataUri) {
    children.push(
      // A real <img> with objectFit/objectPosition, not a div with a
      // backgroundImage — satori renders background-position on a div
      // unreliably (same bug already found and fixed on covers/avatars
      // elsewhere in these OG builders).
      h("img", {
        src: data.bannerDataUri,
        style: {
          position: "absolute", top: 0, left: 0, width: WIDTH, height: HEIGHT,
          objectFit: "cover", objectPosition: data.bannerPosition ?? "center", display: "flex",
        },
      }),
      // Thin top vignette so the corner tags stay legible over bright banners.
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, top: 0, height: 140, display: "flex",
          backgroundImage: `linear-gradient(to bottom, rgba(9,9,10,0.55) 0%, rgba(9,9,10,0) 100%)`,
        },
      }),
      // Bottom scrim for the avatar/username/stats block.
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, bottom: 0, height: 360, display: "flex",
          backgroundImage: `linear-gradient(to top, rgba(9,9,10,0.96) 0%, rgba(9,9,10,0.8) 38%, rgba(9,9,10,0.32) 68%, rgba(9,9,10,0) 100%)`,
        },
      })
    );
  } else {
    // No banner — solid brand background with a soft accent glow, same
    // fallback convention as the empty-list OG card.
    children.push(
      h("div", {
        style: {
          position: "absolute", top: -160, right: -120, width: 560, height: 560, borderRadius: 280,
          backgroundImage: `radial-gradient(circle, ${hexToRgba(ACCENT, 0.22)} 0%, ${hexToRgba(ACCENT, 0)} 70%)`,
          display: "flex",
        },
      })
    );
  }

  // Small "PROFILE" tag mirrors the list card's "LIST" tag — same corner,
  // same chip style — so every OG card type in this family is identifiable
  // at a glance the same way.
  children.push(
    h("div", {
      style: {
        position: "absolute", top: 24, left: 32, display: "flex", alignItems: "center", gap: 9,
        background: "rgba(9,9,10,0.45)", borderRadius: 20, padding: "8px 16px 8px 14px",
      },
    }, [
      h("div", { style: { width: 9, height: 9, borderRadius: 5, background: ACCENT, display: "flex" } }),
      h("div", {
        style: { fontSize: 16, fontWeight: 700, letterSpacing: 2, color: "rgba(240,237,232,0.95)", textTransform: "uppercase" },
      }, "Profile"),
    ])
  );

  children.push(
    h("div", {
      style: {
        position: "absolute", top: 24, right: 32, display: "flex", alignItems: "center", gap: 9,
        background: "rgba(9,9,10,0.45)", borderRadius: 20, padding: "8px 16px 8px 14px",
      },
    }, [
      h("div", { style: { width: 9, height: 9, borderRadius: 5, background: ACCENT, display: "flex" } }),
      h("div", { style: { fontSize: 21, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.95)" } }, "CHEKPOINT"),
    ])
  );

  const avatar = data.avatarDataUri
    ? h("img", {
        src: data.avatarDataUri,
        style: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, objectFit: "cover", display: "flex", flexShrink: 0 },
      })
    : h("div", {
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, background: ACCENT, display: "flex",
          alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 54, fontWeight: 700, flexShrink: 0,
        },
      }, data.username.slice(0, 2).toUpperCase());

  // Caption line: review count always shows; avg score and top genre join in
  // only when there's data for them, so a brand-new profile's card doesn't
  // read as broken with empty stats.
  const captionParts: any[] = [];
  captionParts.push(h("div", { style: { fontSize: 21, color: "#c9c6c0", display: "flex" } },
    `${data.reviewCount} game${data.reviewCount === 1 ? "" : "s"} reviewed`));
  if (data.avgScore !== null) {
    const c = scoreColor(data.avgScore);
    captionParts.push(h("div", { style: { fontSize: 21, color: "#6a6866", display: "flex" } }, "·"));
    captionParts.push(
      h("div", {
        style: {
          display: "flex", alignItems: "center", gap: 6, fontSize: 19, fontWeight: 700, color: c,
          background: hexToRgba(c, 0.14), border: `1px solid ${hexToRgba(c, 0.4)}`,
          borderRadius: 8, padding: "3px 11px",
        },
      }, [
        h("div", { style: { width: 6, height: 6, borderRadius: 3, background: c, display: "flex" } }),
        h("div", { style: { display: "flex" } }, `Avg ${data.avgScore.toFixed(1)}`),
      ])
    );
  }
  if (data.topGenre) {
    captionParts.push(h("div", { style: { fontSize: 21, color: "#6a6866", display: "flex" } }, "·"));
    captionParts.push(h("div", { style: { fontSize: 21, color: "#c9c6c0", display: "flex" } }, `Mostly ${data.topGenre}`));
  }

  children.push(
    h("div", {
      style: {
        position: "absolute", left: 56, right: 56, bottom: 48, display: "flex",
        flexDirection: "column", gap: 18,
      },
    }, [
      h("div", { style: { display: "flex", alignItems: "center", gap: 28 } }, [
        avatar,
        h("div", {
          style: {
            fontFamily: "DM Serif Display", fontSize: usernameFontSize(data.username), color: "#f8f6f2",
            lineHeight: 1.1, display: "flex", minWidth: 0, maxWidth: WIDTH - 112 - AVATAR_SIZE - 28,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textShadow: "0 2px 16px rgba(0,0,0,0.6)",
          },
        }, `@${truncate(data.username, 24)}`),
      ]),
      h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, captionParts),
    ])
  );

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, children);
}
