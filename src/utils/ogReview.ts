import { h, truncate, scoreColor, hexToRgba, bigTitleFontSize, OG_ACCENT, OG_BG } from "./og";

export interface ReviewOgData {
  gameTitle: string;
  coverDataUri: string | null;
  score: number;
  reviewerUsername: string;
  reviewerAvatarDataUri: string | null;
  timeAgoLabel: string;
}

const WIDTH = 1200;
const HEIGHT = 630;
const ACCENT = OG_ACCENT;
const BG = OG_BG;
const PAD = 56;
const COVER_W = 340;
const COVER_H = Math.round(COVER_W * (374 / 264));
const COVER_X = 64;

// Cover art keeps its real aspect ratio (a full-bleed crop of portrait box art
// can chop off the part that actually identifies the game — tried it, looked
// bad). Score + reviewer become a single floating chip bottom-left, not a
// paragraph — a preview thumbnail (Discord, iMessage, Twitter cards) scales
// this whole 1200x630 canvas down to a few hundred px wide, so only a short
// label or a big chip reads at that size, never body-text-sized prose.
export function buildReviewOgTree(data: ReviewOgData): any {
  const children: any[] = [
    h("div", {
      style: {
        position: "absolute", top: -160, right: -160, width: 560, height: 560, borderRadius: 280,
        backgroundImage: `radial-gradient(circle, ${hexToRgba(ACCENT, 0.16)} 0%, ${hexToRgba(ACCENT, 0)} 70%)`,
        display: "flex",
      },
    }),
  ];

  // ── Cover art / poster ──
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

  children.push(
    h("div", {
      style: {
        position: "absolute", left: COVER_X, top: (HEIGHT - COVER_H) / 2 - 8,
        width: COVER_W + 16, height: COVER_H + 16, borderRadius: 20,
        background: hexToRgba(ACCENT, 0.14), display: "flex", alignItems: "center", justifyContent: "center",
      },
    }, [posterInner])
  );

  // ── Right of the poster: label + game title only, kept large and simple ──
  const textX = COVER_X + COVER_W + 56;
  const textW = WIDTH - PAD - textX;
  children.push(
    h("div", {
      style: {
        position: "absolute", left: textX, top: 0, height: HEIGHT, width: textW,
        display: "flex", flexDirection: "column", justifyContent: "center", gap: 16,
      },
    }, [
      h("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, [
        h("div", { style: { width: 8, height: 8, borderRadius: 4, background: ACCENT, display: "flex" } }),
        h("div", { style: { fontSize: 18, fontWeight: 700, letterSpacing: 2, color: ACCENT, textTransform: "uppercase", display: "flex" } }, "Review"),
      ]),
      h("div", {
        style: {
          fontFamily: "DM Serif Display", fontSize: bigTitleFontSize(data.gameTitle), color: "#f8f6f2",
          lineHeight: 1.12, display: "flex", maxWidth: textW,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        },
      }, truncate(data.gameTitle, 40)),
    ])
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

  // ── Floating score + reviewer chip, bottom-left ──
  const c = scoreColor(data.score);
  const scorePill = h("div", {
    style: {
      display: "flex", alignItems: "center", gap: 7, fontSize: 20, fontWeight: 700, color: c,
      background: hexToRgba(c, 0.18), border: `1px solid ${hexToRgba(c, 0.5)}`,
      borderRadius: 9, padding: "5px 13px",
    },
  }, [
    h("div", { style: { width: 7, height: 7, borderRadius: 4, background: c, display: "flex" } }),
    h("div", { style: { display: "flex" } }, `${data.score}/10`),
  ]);

  const avatar = data.reviewerAvatarDataUri
    ? h("div", {
        style: {
          width: 32, height: 32, borderRadius: 16, backgroundImage: `url(${data.reviewerAvatarDataUri})`,
          backgroundSize: "cover", backgroundPosition: "center", display: "flex", flexShrink: 0,
        },
      })
    : h("div", {
        style: {
          width: 32, height: 32, borderRadius: 16, background: ACCENT, display: "flex",
          alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0,
        },
      }, data.reviewerUsername.slice(0, 2).toUpperCase());

  children.push(
    h("div", {
      style: {
        position: "absolute", left: 40, bottom: 40, display: "flex", alignItems: "center", gap: 12,
        background: "rgba(9,9,10,0.55)", borderRadius: 16, padding: "10px 18px 10px 12px",
        border: "1px solid rgba(255,255,255,0.08)",
      },
    }, [
      avatar,
      h("div", { style: { fontSize: 19, fontWeight: 700, color: "#f0ede8", display: "flex" } }, `@${data.reviewerUsername}`),
      h("div", { style: { fontSize: 19, color: "#6a6866", display: "flex" } }, "·"),
      h("div", { style: { fontSize: 17, color: "#c9c6c0", display: "flex" } }, data.timeAgoLabel),
      h("div", { style: { fontSize: 19, color: "#6a6866", display: "flex" } }, "·"),
      scorePill,
    ])
  );

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, children);
}
