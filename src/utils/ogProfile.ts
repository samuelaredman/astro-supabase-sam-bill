import { h, truncate, scoreColor, hexToRgba, OG_ACCENT, OG_BG } from "./og";

export interface ProfileOgData {
  username: string;
  avatarDataUri: string | null;
  // Pre-cropped by fetchAndCropCover to exactly the card's canvas size —
  // never sized/positioned again here (see that function's doc comment for
  // why doing the crop in the layout tree instead crashes resvg).
  bannerDataUri: string | null;
  reviewCount: number;
  avgScore: number | null;
  topGenre: string | null;
}

const WIDTH = 1200;
// Shorter than the 1200x630 review/list cards on purpose — a sleeker, more
// banner-like strip for a profile share, not a poster.
const HEIGHT = 500;
const ACCENT = OG_ACCENT;
const BG = OG_BG;
const AVATAR_SIZE = 168;

// The username is a handle, not a headline — always a single line (never
// wrapped), just scaled down a tier as it gets longer. It's the largest text
// on the card, bigger than any of the stat values below it.
function usernameFontSize(username: string): number {
  if (username.length <= 12) return 104;
  if (username.length <= 20) return 82;
  return 64;
}

interface StatTile {
  value: string;
  label: string;
  color?: string;
}

export function buildProfileOgTree(data: ProfileOgData): any {
  const children: any[] = [];

  if (data.bannerDataUri) {
    children.push(
      // Already cropped to exactly WIDTHxHEIGHT server-side (fetchAndCropCover) —
      // just a plain full-bleed image, no fit/position logic needed here.
      h("img", {
        src: data.bannerDataUri,
        style: { position: "absolute", top: 0, left: 0, width: WIDTH, height: HEIGHT, display: "flex" },
      }),
      // Thin top vignette so the corner tags stay legible over bright banners.
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, top: 0, height: 110, display: "flex",
          backgroundImage: `linear-gradient(to bottom, rgba(9,9,10,0.55) 0%, rgba(9,9,10,0) 100%)`,
        },
      }),
      // Bottom scrim for the avatar/username/stats block.
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, bottom: 0, height: 360, display: "flex",
          backgroundImage: `linear-gradient(to top, rgba(9,9,10,0.97) 0%, rgba(9,9,10,0.85) 42%, rgba(9,9,10,0.35) 72%, rgba(9,9,10,0) 100%)`,
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
          alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 60, fontWeight: 700, flexShrink: 0,
        },
      }, data.username.slice(0, 2).toUpperCase());

  // The three stats are their own tile row now, not a caption line — each is
  // a (value, label) pair per the stat-tile contract: value in the plain sans
  // (never the serif display face reserved for the username headline),
  // label small/muted/uppercase underneath. Avg score's value keeps the
  // site's semantic score color; the other two stay plain text — color
  // signals status, not decoration. Tiles only appear when there's real data
  // for them, so a brand-new profile's card doesn't show empty/placeholder stats.
  const tiles: StatTile[] = [
    { value: String(data.reviewCount), label: data.reviewCount === 1 ? "game reviewed" : "games reviewed" },
  ];
  if (data.avgScore !== null) {
    tiles.push({ value: data.avgScore.toFixed(1), label: "avg score", color: scoreColor(data.avgScore) });
  }
  if (data.topGenre) {
    tiles.push({ value: truncate(data.topGenre, 26), label: "top genre" });
  }

  const statRowChildren: any[] = [];
  tiles.forEach((tile, i) => {
    if (i > 0) {
      statRowChildren.push(
        h("div", { style: { width: 1, height: 64, background: "rgba(255,255,255,0.18)", display: "flex", flexShrink: 0 } })
      );
    }
    statRowChildren.push(
      h("div", { style: { display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 } }, [
        h("div", {
          style: {
            fontSize: 52, fontWeight: 700, color: tile.color ?? "#f8f6f2", display: "flex",
            lineHeight: 1, textShadow: "0 2px 16px rgba(0,0,0,0.6)",
          },
        }, tile.value),
        h("div", {
          style: { fontSize: 16, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "#9a9793", display: "flex" },
        }, tile.label),
      ])
    );
  });

  children.push(
    h("div", {
      style: {
        position: "absolute", left: 56, right: 56, bottom: 44, display: "flex",
        flexDirection: "column", gap: 28,
      },
    }, [
      h("div", { style: { display: "flex", alignItems: "center", gap: 30 } }, [
        avatar,
        h("div", {
          style: {
            fontFamily: "DM Serif Display", fontSize: usernameFontSize(data.username), color: "#f8f6f2",
            lineHeight: 1.1, display: "flex", minWidth: 0, maxWidth: WIDTH - 112 - AVATAR_SIZE - 30,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textShadow: "0 2px 16px rgba(0,0,0,0.6)",
          },
        }, `@${truncate(data.username, 24)}`),
      ]),
      h("div", { style: { display: "flex", alignItems: "center", gap: 28 } }, statRowChildren),
    ])
  );

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, children);
}
