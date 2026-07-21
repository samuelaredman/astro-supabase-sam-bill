import { h, truncate, OG_BG, OG_ACCENT } from "./og";

const WIDTH  = 1200;
const HEIGHT = 630;

export const COVER_W = 240;
export const COVER_H = 320; // 3:4

// Each game half; 40px centre strip for the bidirectional arrow.
const HALF_W  = 580;
const GAP_W   = 40;
const RIGHT_X = HALF_W + GAP_W; // 620

const CHIPS_H     = 68;
const BOTTOM_H    = 118;
const CONTENT_TOP = CHIPS_H;
const CONTENT_BOT = HEIGHT - BOTTOM_H; // 512
const CONTENT_H   = CONTENT_BOT - CONTENT_TOP; // 444

export interface RecOgData {
  sourceGameTitle: string;
  sourceGameCoverUri: string | null;
  targetGameTitle: string;
  targetGameCoverUri: string | null;
  body: string;
  ownerUsername: string;
  ownerAvatarUri: string | null;
}

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
      gap: 16,
    },
  }, [
    h("div", {
      style: {
        fontSize: 13, fontWeight: 700, letterSpacing: "0.1em",
        textTransform: "uppercase", color: labelColor, display: "flex",
      },
    }, label),
    coverEl(coverUri),
    h("div", {
      style: {
        fontSize: 18, fontWeight: 600, color: "#dddad4",
        lineHeight: 1.35, display: "-webkit-box",
        WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        overflow: "hidden", textOverflow: "ellipsis",
        textAlign: "center", maxWidth: COVER_W + 60,
      },
    }, truncate(title, 44)),
  ]);
}

export function buildRecOgTree(data: RecOgData): any {
  const bodyExcerpt = truncate(data.body.replace(/\n+/g, " "), 110);

  const AVATAR_SIZE = 44;
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
          justifyContent: "center", fontSize: 15, fontWeight: 700,
          color: "#fff", flexShrink: 0,
        },
      }, data.ownerUsername.slice(0, 2).toUpperCase());

  const children: any[] = [];

  // ── Radial glow behind each cover to soften the dead horizontal space ──
  const glowStyle = (cx: number) => ({
    position: "absolute",
    left: cx - 260, top: Math.round(HEIGHT / 2) - 260,
    width: 520, height: 520, borderRadius: 260, display: "flex",
    backgroundImage: `radial-gradient(circle, rgba(139,123,240,0.10) 0%, transparent 68%)`,
  });
  children.push(h("div", { style: glowStyle(Math.round(HALF_W / 2)) }));
  children.push(h("div", { style: glowStyle(RIGHT_X + Math.round(HALF_W / 2)) }));

  // ── Game slots ──
  children.push(gameSlot(0,       "If you liked", "#a09fa0", data.sourceGameCoverUri, data.sourceGameTitle));
  children.push(gameSlot(RIGHT_X, "Play next",    "#7ac47f", data.targetGameCoverUri, data.targetGameTitle));

  // ── Bidirectional arrow in the centre strip ──
  children.push(h("div", {
    style: {
      position: "absolute",
      left: HALF_W, top: CONTENT_TOP,
      width: GAP_W, height: CONTENT_H,
      display: "flex", alignItems: "center", justifyContent: "center",
    },
  }, [
    h("div", { style: { fontSize: 32, fontWeight: 700, color: OG_ACCENT, display: "flex", lineHeight: 1 } }, "↔"),
  ]));

  // ── Separator ──
  children.push(h("div", {
    style: {
      position: "absolute", left: 56, right: 56, top: CONTENT_BOT,
      height: 1, background: "rgba(255,255,255,0.08)", display: "flex",
    },
  }));

  // ── Author + body in one compact row ──
  children.push(h("div", {
    style: {
      position: "absolute",
      left: 64, right: 64,
      top: CONTENT_BOT + 18,
      display: "flex", alignItems: "flex-start", gap: 14,
    },
  }, [
    avatarEl,
    h("div", {
      style: { display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 },
    }, [
      h("div", {
        style: { fontSize: 18, fontWeight: 700, color: "#c9c6c0", display: "flex" },
      }, `@${truncate(data.ownerUsername, 28)}`),
      h("div", {
        style: {
          fontSize: 17, color: "#7a7872", lineHeight: 1.5,
          fontStyle: "italic", display: "-webkit-box",
          WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden",
        },
      }, `"${bodyExcerpt}"`),
    ]),
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
      style: { fontSize: 17, fontWeight: 700, letterSpacing: 2,
               textTransform: "uppercase", color: "rgba(240,237,232,0.95)", display: "flex" },
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
      style: { fontSize: 22, fontWeight: 700, letterSpacing: 3,
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
