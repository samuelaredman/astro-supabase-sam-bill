import { h, truncate, scoreColor, hexToRgba, OG_ACCENT, OG_BG } from "./og";

export interface ReviewOgData {
  gameTitle: string;
  coverDataUri: string | null;
  score: number;
  reviewTitle: string | null;
  reviewerUsername: string;
  reviewerAvatarDataUri: string | null;
}

const WIDTH = 1200;
const HEIGHT = 630;
const ACCENT = OG_ACCENT;
const BG = OG_BG;
const PAD = 64;
// Card content (cover + score + game title) gets the top band; the reviewer
// strip is a distinct overlay confined to the bottom band so it never covers
// the card itself.
const MAIN_H = 500;
const OVERLAY_H = HEIGHT - MAIN_H;
const COVER_H = 380;
const COVER_W = Math.round(COVER_H * (264 / 374));

function cardTitleFontSize(title: string): number {
  if (title.length <= 16) return 56;
  if (title.length <= 28) return 46;
  if (title.length <= 42) return 36;
  return 28;
}

export function buildReviewOgTree(data: ReviewOgData): any {
  const c = scoreColor(data.score);

  const children: any[] = [
    h("div", {
      style: {
        position: "absolute", top: -160, right: -160, width: 560, height: 560, borderRadius: 280,
        backgroundImage: `radial-gradient(circle, ${hexToRgba(ACCENT, 0.14)} 0%, ${hexToRgba(ACCENT, 0)} 70%)`,
        display: "flex",
      },
    }),
  ];

  // ── The card: cover, score, and title are the main event ──
  const posterInner = data.coverDataUri
    ? h("div", {
        style: {
          width: COVER_W, height: COVER_H, borderRadius: 16,
          backgroundImage: `url(${data.coverDataUri})`, backgroundSize: "cover", backgroundPosition: "center",
          display: "flex",
        },
      })
    : h("div", {
        style: {
          width: COVER_W, height: COVER_H, borderRadius: 16, background: "rgba(255,255,255,0.04)",
          display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("div", {
          style: { fontFamily: "DM Serif Display", fontSize: 100, color: "rgba(240,237,232,0.22)", display: "flex" },
        }, data.gameTitle.slice(0, 1).toUpperCase()),
      ]);

  const poster = h("div", {
    style: {
      flexShrink: 0, width: COVER_W + 16, height: COVER_H + 16, borderRadius: 20,
      background: hexToRgba(ACCENT, 0.14), display: "flex", alignItems: "center", justifyContent: "center",
    },
  }, [posterInner]);

  // Big colored score, with a soft glow of the same color behind it — the
  // score reads as a graded stat, not a caption.
  const scoreBox = h("div", {
    style: { position: "relative", width: 240, height: 190, display: "flex", alignItems: "center", flexShrink: 0 },
  }, [
    h("div", {
      style: {
        position: "absolute", top: -5, left: 10, width: 220, height: 200, borderRadius: 110, display: "flex",
        backgroundImage: `radial-gradient(circle, ${hexToRgba(c, 0.32)} 0%, ${hexToRgba(c, 0)} 72%)`,
      },
    }),
    h("div", {
      style: {
        position: "relative", fontFamily: "DM Serif Display", fontSize: 190, fontWeight: 700,
        color: c, lineHeight: 1, display: "flex",
      },
    }, String(data.score)),
  ]);

  const titleBlock = h("div", {
    style: {
      fontFamily: "DM Serif Display", fontSize: cardTitleFontSize(data.gameTitle), color: "#f8f6f2",
      lineHeight: 1.15, display: "flex", minWidth: 0, width: "100%",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    },
  }, truncate(data.gameTitle, 40));

  const scoreAndTitle = h("div", {
    style: { display: "flex", flexDirection: "column", justifyContent: "center", gap: 12, minWidth: 0, flex: 1 },
  }, [scoreBox, titleBlock]);

  children.push(
    h("div", {
      style: {
        position: "absolute", top: 0, left: 0, right: 0, height: MAIN_H, display: "flex",
        alignItems: "center", paddingLeft: PAD, paddingRight: PAD, gap: 56,
      },
    }, [poster, scoreAndTitle])
  );

  // ── Wordmark, top-right ──
  children.push(
    h("div", {
      style: {
        position: "absolute", top: 24, right: 32, display: "flex", alignItems: "center", gap: 9,
        background: "rgba(9,9,10,0.5)", borderRadius: 20, padding: "8px 16px 8px 14px",
      },
    }, [
      h("div", { style: { width: 9, height: 9, borderRadius: 5, background: ACCENT, display: "flex" } }),
      h("div", { style: { fontSize: 21, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.95)" } }, "CHEKPOINT"),
    ])
  );

  // ── Reviewer overlay strip, confined to the bottom band ──
  const avatar = data.reviewerAvatarDataUri
    ? h("div", {
        style: {
          width: 46, height: 46, borderRadius: 23, backgroundImage: `url(${data.reviewerAvatarDataUri})`,
          backgroundSize: "cover", backgroundPosition: "center", display: "flex", flexShrink: 0,
        },
      })
    : h("div", {
        style: {
          width: 46, height: 46, borderRadius: 23, background: ACCENT, display: "flex",
          alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 17, fontWeight: 700, flexShrink: 0,
        },
      }, data.reviewerUsername.slice(0, 2).toUpperCase());

  const captionLines: any[] = [
    h("div", { style: { fontSize: 22, fontWeight: 700, color: "#f0ede8", display: "flex" } }, `@${data.reviewerUsername}`),
  ];
  if (data.reviewTitle) {
    captionLines.push(
      h("div", {
        style: {
          fontSize: 21, color: "#c9c6c0", display: "flex", maxWidth: WIDTH - PAD * 2 - 46 - 20,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        },
      }, truncate(data.reviewTitle, 64))
    );
  }

  children.push(
    h("div", {
      style: {
        position: "absolute", left: 0, right: 0, bottom: 0, height: OVERLAY_H, display: "flex",
        alignItems: "center", paddingLeft: PAD, paddingRight: PAD, gap: 18,
        backgroundImage: `linear-gradient(to top, rgba(9,9,10,0.94) 0%, rgba(9,9,10,0.8) 55%, rgba(9,9,10,0) 100%)`,
      },
    }, [
      avatar,
      h("div", { style: { display: "flex", flexDirection: "column", gap: 5, minWidth: 0 } }, captionLines),
    ])
  );

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, children);
}

