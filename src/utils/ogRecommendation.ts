import { h, truncate, OG_BG, OG_ACCENT } from "./og";

const WIDTH = 1200;
const HEIGHT = 630;
const COVER_W = 200;
const COVER_H = 267; // 3:4

export interface RecOgData {
  sourceGameTitle: string;
  sourceGameCoverUri: string | null;
  targetGameTitle: string;
  targetGameCoverUri: string | null;
  body: string;
  ownerUsername: string;
  ownerAvatarUri: string | null;
}

function coverBox(uri: string | null): any {
  return h(
    "div",
    {
      style: {
        width: COVER_W, height: COVER_H, borderRadius: 12, overflow: "hidden",
        border: "1px solid rgba(255,255,255,0.1)", background: "#1a1a1e",
        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      },
    },
    uri
      ? h("img", { src: uri, width: COVER_W, height: COVER_H, style: { objectFit: "cover" } })
      : h("div", { style: { fontSize: 36, display: "flex" } }, "🎮")
  );
}

function gameSlot(label: string, labelColor: string, uri: string | null, title: string): any {
  return h(
    "div",
    {
      style: {
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 14, padding: "0 48px",
      },
    },
    [
      h("div", {
        style: {
          fontSize: 11, fontWeight: 700, letterSpacing: "0.09em",
          textTransform: "uppercase", color: labelColor, display: "flex",
        },
      }, label),
      coverBox(uri),
      h("div", {
        style: {
          fontSize: 14, fontWeight: 600, color: "#dddad4",
          textAlign: "center", lineHeight: 1.4, display: "flex",
          maxWidth: COVER_W + 32,
        },
      }, truncate(title, 36)),
    ]
  );
}

export function buildRecOgTree(data: RecOgData): any {
  const bodyExcerpt = truncate(data.body.replace(/\n+/g, " "), 160);

  const avatarEl = data.ownerAvatarUri
    ? h("div", {
        style: {
          width: 36, height: 36, borderRadius: 18, overflow: "hidden",
          border: "2px solid rgba(255,255,255,0.15)", display: "flex", flexShrink: 0,
        },
      }, h("img", { src: data.ownerAvatarUri, width: 36, height: 36, style: { objectFit: "cover" } }))
    : h("div", {
        style: {
          width: 36, height: 36, borderRadius: 18, flexShrink: 0,
          background: "rgba(139,123,240,0.18)", border: "2px solid rgba(139,123,240,0.35)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 700, color: OG_ACCENT,
        },
      }, data.ownerUsername.slice(0, 2).toUpperCase());

  return h(
    "div",
    {
      style: {
        width: WIDTH, height: HEIGHT, background: OG_BG,
        display: "flex", flexDirection: "column", fontFamily: '"DM Sans"',
      },
    },
    [
      // ── Game pair ──
      h("div", {
        style: {
          display: "flex", flex: 1, alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        },
      }, [
        gameSlot("If you liked", "#a0a09a", data.sourceGameCoverUri, data.sourceGameTitle),
        h("div", {
          style: {
            width: 72, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", flexShrink: 0,
          },
        }, [
          h("div", { style: { fontSize: 52, color: OG_ACCENT, display: "flex", lineHeight: 1 } }, "→"),
        ]),
        gameSlot("Play next", "#7ac47f", data.targetGameCoverUri, data.targetGameTitle),
      ]),

      // ── Body excerpt ──
      h("div", {
        style: {
          padding: "0 64px", height: 86,
          display: "flex", alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
        },
      }, [
        h("div", {
          style: {
            fontSize: 15, color: "#7a7872", lineHeight: 1.55,
            fontStyle: "italic", display: "flex",
          },
        }, `"${bodyExcerpt}"`),
      ]),

      // ── Bottom bar ──
      h("div", {
        style: {
          display: "flex", alignItems: "center", padding: "0 64px", height: 68, gap: 12,
        },
      }, [
        avatarEl,
        h("div", { style: { fontSize: 15, fontWeight: 600, color: "#c9c6c0", display: "flex" } },
          `@${data.ownerUsername}`),
        h("div", { style: { flex: 1, display: "flex" } }),
        h("div", {
          style: {
            display: "flex", alignItems: "center",
            background: "rgba(139,123,240,0.1)", border: "1px solid rgba(139,123,240,0.25)",
            borderRadius: 8, padding: "5px 14px",
          },
        }, [
          h("div", {
            style: { fontSize: 9, fontFamily: '"Press Start 2P"', color: OG_ACCENT, display: "flex" },
          }, "CHEKPOINT"),
        ]),
      ]),
    ]
  );
}
