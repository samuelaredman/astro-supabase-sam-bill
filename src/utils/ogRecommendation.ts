import { h, truncate, OG_BG, OG_ACCENT } from "./og";

const WIDTH  = 1200;
const HEIGHT = 630;

// Portrait covers — 3:4 ratio, large enough to dominate each half but not
// so large they need landscape cropping.
export const COVER_W = 220;
export const COVER_H = 293;

export interface RecOgData {
  sourceGameTitle: string;
  sourceGameCoverUri: string | null;
  targetGameTitle: string;
  targetGameCoverUri: string | null;
  body: string;
  ownerUsername: string;
  ownerAvatarUri: string | null;
}

// Each game half is 582px wide (36px centre gap for the arrow).
const HALF_W = 582;
const GAP_W  = 36; // arrow strip
const RIGHT_X = HALF_W + GAP_W; // 618

// Vertical regions
const CHIPS_H      = 68;          // top bar where the chips live
const BOTTOM_H     = 150;         // body + author section
const CONTENT_TOP  = CHIPS_H;     // y where game slots start
const CONTENT_BOT  = HEIGHT - BOTTOM_H; // 480
const CONTENT_H    = CONTENT_BOT - CONTENT_TOP; // 412

function coverEl(uri: string | null): any {
  return h("div", {
    style: {
      width: COVER_W, height: COVER_H,
      borderRadius: 12, overflow: "hidden",
      border: "1.5px solid rgba(255,255,255,0.12)",
      background: "#1c1a28",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    },
  }, uri
    ? h("img", { src: uri, width: COVER_W, height: COVER_H,
        style: { objectFit: "cover", display: "flex" } })
    : h("div", { style: { fontSize: 44, display: "flex" } }, "🎮")
  );
}

function gameSlot(
  leftX: number,
  label: string,
  labelColor: string,
  coverUri: string | null,
  title: string,
): any {
  return h("div", {
    style: {
      position: "absolute",
      left: leftX, top: CONTENT_TOP,
      width: HALF_W, height: CONTENT_H,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 14,
    },
  }, [
    h("div", {
      style: {
        fontSize: 11, fontWeight: 700, letterSpacing: "0.1em",
        textTransform: "uppercase", color: labelColor, display: "flex",
      },
    }, label),
    coverEl(coverUri),
    h("div", {
      style: {
        fontSize: 15, fontWeight: 600, color: "#dddad4",
        lineHeight: 1.4, display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        overflow: "hidden", textOverflow: "ellipsis",
        textAlign: "center", maxWidth: COVER_W + 40,
      },
    }, truncate(title, 44)),
  ]);
}

export function buildRecOgTree(data: RecOgData): any {
  const bodyExcerpt = truncate(data.body.replace(/\n+/g, " "), 130);

  const AVATAR_SIZE = 36;
  const avatarEl = data.ownerAvatarUri
    ? h("img", {
        src: data.ownerAvatarUri,
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
          objectFit: "cover", display: "flex", flexShrink: 0,
        },
      })
    : h("div", {
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
          background: OG_ACCENT, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 13, fontWeight: 700,
          color: "#fff", flexShrink: 0,
        },
      }, data.ownerUsername.slice(0, 2).toUpperCase());

  const children: any[] = [];

  // ── Subtle radial glow behind each cover to fill the horizontal space ──
  children.push(h("div", {
    style: {
      position: "absolute",
      left: Math.round(HALF_W / 2) - 260, top: Math.round(HEIGHT / 2) - 260,
      width: 520, height: 520, borderRadius: 260, display: "flex",
      backgroundImage: `radial-gradient(circle, rgba(139,123,240,0.09) 0%, transparent 70%)`,
    },
  }));
  children.push(h("div", {
    style: {
      position: "absolute",
      left: RIGHT_X + Math.round(HALF_W / 2) - 260, top: Math.round(HEIGHT / 2) - 260,
      width: 520, height: 520, borderRadius: 260, display: "flex",
      backgroundImage: `radial-gradient(circle, rgba(139,123,240,0.09) 0%, transparent 70%)`,
    },
  }));

  // ── Vertical divider between halves ──
  children.push(h("div", {
    style: {
      position: "absolute", left: HALF_W, top: CHIPS_H,
      width: GAP_W, height: CONTENT_H,
      display: "flex", alignItems: "center", justifyContent: "center",
    },
  }, [
    h("div", {
      style: { fontSize: 28, fontWeight: 700, color: OG_ACCENT, display: "flex", lineHeight: 1 },
    }, "→"),
  ]));

  // ── Game slots ──
  children.push(gameSlot(0, "If you liked", "#a09fa0", data.sourceGameCoverUri, data.sourceGameTitle));
  children.push(gameSlot(RIGHT_X, "Play next", "#7ac47f", data.targetGameCoverUri, data.targetGameTitle));

  // ── Separator line above body ──
  children.push(h("div", {
    style: {
      position: "absolute", left: 56, right: 56, top: CONTENT_BOT,
      height: 1, background: "rgba(255,255,255,0.08)", display: "flex",
    },
  }));

  // ── Body excerpt ──
  children.push(h("div", {
    style: {
      position: "absolute",
      left: 64, right: 64, top: CONTENT_BOT + 20,
      fontSize: 16, lineHeight: 1.55, fontStyle: "italic",
      color: "#7a7872", display: "flex",
    },
  }, `"${bodyExcerpt}"`));

  // ── Author row ──
  children.push(h("div", {
    style: {
      position: "absolute", left: 64, right: 64, bottom: 36,
      display: "flex", alignItems: "center", gap: 10,
    },
  }, [
    avatarEl,
    h("div", {
      style: { fontSize: 15, fontWeight: 600, color: "#c9c6c0", display: "flex" },
    }, `@${truncate(data.ownerUsername, 28)}`),
  ]));

  // ── "Rec" chip — top-left ──
  children.push(h("div", {
    style: {
      position: "absolute", top: 24, left: 32,
      display: "flex", alignItems: "center", gap: 9,
      background: "rgba(9,9,10,0.5)", borderRadius: 20,
      padding: "8px 16px 8px 14px",
    },
  }, [
    h("div", { style: { width: 9, height: 9, borderRadius: 5, background: OG_ACCENT, display: "flex" } }),
    h("div", {
      style: { fontSize: 16, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
               color: "rgba(240,237,232,0.95)", display: "flex" },
    }, "Rec"),
  ]));

  // ── "CHEKPOINT" chip — top-right ──
  children.push(h("div", {
    style: {
      position: "absolute", top: 24, right: 32,
      display: "flex", alignItems: "center", gap: 9,
      background: "rgba(9,9,10,0.5)", borderRadius: 20,
      padding: "8px 16px 8px 14px",
    },
  }, [
    h("div", { style: { width: 9, height: 9, borderRadius: 5, background: OG_ACCENT, display: "flex" } }),
    h("div", {
      style: { fontSize: 21, fontWeight: 700, letterSpacing: 3,
               color: "rgba(240,237,232,0.95)", display: "flex" },
    }, "CHEKPOINT"),
  ]));

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative",
      overflow: "hidden", backgroundColor: OG_BG, fontFamily: "DM Sans",
    },
  }, children);
}
