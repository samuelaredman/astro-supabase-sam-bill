import {
  h, truncate, OG_BG, OG_ACCENT,
  BOTTOM_TITLE_WRAP_THRESHOLD, bottomTitleFontSize, bottomTitleFontSizeShort,
} from "./og";

const WIDTH = 1200;
const HEIGHT = 630;
// Each game cover fills half the canvas with a 4px gap between them
export const COVER_W = 598;
export const COVER_H = 630;

export interface RecOgData {
  sourceGameTitle: string;
  sourceGameCoverUri: string | null;
  targetGameTitle: string;
  targetGameCoverUri: string | null;
  body: string;
  ownerUsername: string;
  ownerAvatarUri: string | null;
}

export function buildRecOgTree(data: RecOgData): any {
  const bodyExcerpt = truncate(data.body.replace(/\n+/g, " "), 80);
  const isLongBody = bodyExcerpt.length > BOTTOM_TITLE_WRAP_THRESHOLD;

  const captionText = `${truncate(data.sourceGameTitle, 28)} → ${truncate(data.targetGameTitle, 28)}`;

  const AVATAR_SIZE = 84;
  const avatar = data.ownerAvatarUri
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
          justifyContent: "center", color: "#fff", fontSize: 30, fontWeight: 700, flexShrink: 0,
        },
      }, data.ownerUsername.slice(0, 2).toUpperCase());

  const bodyEl = isLongBody
    ? h("div", {
        style: {
          fontFamily: "DM Serif Display", fontStyle: "italic",
          fontSize: bottomTitleFontSize(bodyExcerpt), color: "#f8f6f2",
          lineHeight: 1.22, minWidth: 0, flex: 1,
          display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
          overflow: "hidden", textOverflow: "ellipsis",
          textShadow: "0 2px 16px rgba(0,0,0,0.6)",
        },
      }, `"${bodyExcerpt}"`)
    : h("div", {
        style: {
          fontFamily: "DM Serif Display", fontStyle: "italic",
          fontSize: bottomTitleFontSizeShort(bodyExcerpt), color: "#f8f6f2",
          lineHeight: 1.08, display: "flex", minWidth: 0, flex: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textShadow: "0 2px 16px rgba(0,0,0,0.6)",
        },
      }, `"${bodyExcerpt}"`);

  const children: any[] = [];

  // ── Left game cover ──
  if (data.sourceGameCoverUri) {
    children.push(
      h("img", {
        src: data.sourceGameCoverUri,
        style: {
          position: "absolute", left: 0, top: 0, width: COVER_W, height: COVER_H,
          objectFit: "cover", display: "flex",
        },
      })
    );
  } else {
    children.push(
      h("div", {
        style: {
          position: "absolute", left: 0, top: 0, width: COVER_W, height: COVER_H,
          background: "#1a1822", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 64,
        },
      }, "🎮")
    );
  }

  // ── Right game cover ──
  if (data.targetGameCoverUri) {
    children.push(
      h("img", {
        src: data.targetGameCoverUri,
        style: {
          position: "absolute", left: 602, top: 0, width: COVER_W, height: COVER_H,
          objectFit: "cover", display: "flex",
        },
      })
    );
  } else {
    children.push(
      h("div", {
        style: {
          position: "absolute", left: 602, top: 0, width: COVER_W, height: COVER_H,
          background: "#1a1822", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 64,
        },
      }, "🎮")
    );
  }

  // ── Centre gap arrow ──
  children.push(
    h("div", {
      style: {
        position: "absolute", left: 570, top: 0, width: 60, height: HEIGHT,
        background: OG_BG, display: "flex", alignItems: "center", justifyContent: "center",
      },
    }, [
      h("div", {
        style: {
          fontSize: 28, color: OG_ACCENT, fontWeight: 700,
          textShadow: `0 0 20px ${OG_ACCENT}88`, display: "flex",
        },
      }, "→"),
    ])
  );

  // ── Top vignette (for chip legibility over cover art) ──
  children.push(
    h("div", {
      style: {
        position: "absolute", left: 0, right: 0, top: 0, height: 130, display: "flex",
        backgroundImage: "linear-gradient(to bottom, rgba(9,9,10,0.62) 0%, rgba(9,9,10,0) 100%)",
      },
    })
  );

  // ── Bottom vignette ──
  children.push(
    h("div", {
      style: {
        position: "absolute", left: 0, right: 0, bottom: 0,
        height: isLongBody ? 360 : 320, display: "flex",
        backgroundImage: "linear-gradient(to top, rgba(9,9,10,0.97) 0%, rgba(9,9,10,0.78) 32%, rgba(9,9,10,0.28) 62%, rgba(9,9,10,0) 100%)",
      },
    })
  );

  // ── "REC" chip — top-left ──
  children.push(
    h("div", {
      style: {
        position: "absolute", top: 24, left: 32, display: "flex", alignItems: "center", gap: 9,
        background: "rgba(9,9,10,0.45)", borderRadius: 20, padding: "8px 16px 8px 14px",
      },
    }, [
      h("div", { style: { width: 9, height: 9, borderRadius: 5, background: OG_ACCENT, display: "flex" } }),
      h("div", {
        style: { fontSize: 16, fontWeight: 700, letterSpacing: 2, color: "rgba(240,237,232,0.95)", textTransform: "uppercase" },
      }, "Rec"),
    ])
  );

  // ── "CHEKPOINT" chip — top-right ──
  children.push(
    h("div", {
      style: {
        position: "absolute", top: 24, right: 32, display: "flex", alignItems: "center", gap: 9,
        background: "rgba(9,9,10,0.45)", borderRadius: 20, padding: "8px 16px 8px 14px",
      },
    }, [
      h("div", { style: { width: 9, height: 9, borderRadius: 5, background: OG_ACCENT, display: "flex" } }),
      h("div", {
        style: { fontSize: 21, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.95)" },
      }, "CHEKPOINT"),
    ])
  );

  // ── Bottom text block ──
  children.push(
    h("div", {
      style: {
        position: "absolute", left: 56, right: 56,
        bottom: isLongBody ? 40 : 44,
        display: "flex", flexDirection: "column", gap: 10,
      },
    }, [
      // Caption: source → target game names
      h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, [
        h("div", { style: { fontSize: 19, color: "#c9c6c0", display: "flex" } }, captionText),
      ]),
      // Main row: avatar + @username + divider + body excerpt
      h("div", {
        style: { display: "flex", alignItems: isLongBody ? "center" : "baseline", gap: 18 },
      }, [
        avatar,
        h("div", {
          style: {
            fontSize: 42, fontWeight: 700, color: "#f0ede8", display: "flex", flexShrink: 0,
            maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          },
        }, `@${truncate(data.ownerUsername, 24)}`),
        h("div", {
          style: { width: 1, height: isLongBody ? 78 : 52, background: "rgba(255,255,255,0.18)", display: "flex", flexShrink: 0 },
        }),
        bodyEl,
      ]),
    ])
  );

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative",
      overflow: "hidden", backgroundColor: OG_BG, fontFamily: "DM Sans",
    },
  }, children);
}
