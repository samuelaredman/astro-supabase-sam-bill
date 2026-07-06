import { h, truncate, scoreColor, scoreBadgeBg, scoreBadgeText, hexToRgba, OG_ACCENT, OG_BG } from "./og";

// Right-panel title block loses width to the score badge, so it needs its own
// (smaller) scale than a full-width title like ogList's.
function gameTitleFontSize(title: string): number {
  if (title.length <= 16) return 44;
  if (title.length <= 28) return 36;
  if (title.length <= 42) return 28;
  return 23;
}

export interface ReviewOgData {
  gameTitle: string;
  coverDataUri: string | null;
  score: number;
  reviewTitle: string | null;
  body: string;
  containsSpoilers: boolean;
  reviewerUsername: string;
  reviewerAvatarDataUri: string | null;
  timeAgoLabel: string;
}

const WIDTH = 1200;
const HEIGHT = 630;
const ACCENT = OG_ACCENT;
const BG = OG_BG;
const LEFT_W = 420;
const RIGHT_W = WIDTH - LEFT_W;
const PAD = 56;
const BADGE_SIZE = 128;

export function buildReviewOgTree(data: ReviewOgData): any {
  const badgeBg = scoreBadgeBg(data.score);
  const badgeText = scoreBadgeText(data.score);

  // ── Left panel: poster-style cover art on a softly lit backdrop ──
  const coverW = 300;
  const coverH = Math.round(coverW * (374 / 264));
  const leftChildren: any[] = [
    h("div", {
      style: {
        position: "absolute", top: -140, left: -140, width: 480, height: 480, borderRadius: 240,
        backgroundImage: `radial-gradient(circle, ${hexToRgba(ACCENT, 0.20)} 0%, ${hexToRgba(ACCENT, 0)} 70%)`,
        display: "flex",
      },
    }),
  ];
  if (data.coverDataUri) {
    leftChildren.push(
      // Slightly oversized soft-tinted rect behind the cover reads as a frame/glow
      // without relying on box-shadow, which satori/resvg render inconsistently.
      h("div", {
        style: {
          width: coverW + 16, height: coverH + 16, borderRadius: 20,
          background: hexToRgba(ACCENT, 0.16), display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("div", {
          style: {
            width: coverW, height: coverH, borderRadius: 14,
            backgroundImage: `url(${data.coverDataUri})`, backgroundSize: "cover", backgroundPosition: "center",
            display: "flex",
          },
        }),
      ])
    );
  } else {
    // No cover art — fall back to a monogram, same convention as the
    // avatar-initials fallback below (satori has no emoji font loaded, so an
    // actual game-controller glyph would render as a missing-character box).
    leftChildren.push(
      h("div", {
        style: {
          width: coverW, height: coverH, borderRadius: 14, background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("div", {
          style: { fontFamily: "DM Serif Display", fontSize: 88, color: "rgba(240,237,232,0.25)", display: "flex" },
        }, data.gameTitle.slice(0, 1).toUpperCase()),
      ])
    );
  }

  const leftPanel = h("div", {
    style: {
      position: "relative", width: LEFT_W, height: HEIGHT, display: "flex", alignItems: "center",
      justifyContent: "center", overflow: "hidden", backgroundColor: "rgba(255,255,255,0.015)",
    },
  }, leftChildren);

  // ── Right panel: reviewer, score, title, and a readable body snippet ──
  const metaRow = h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, [
    data.reviewerAvatarDataUri
      ? h("div", {
          style: {
            width: 30, height: 30, borderRadius: 15, backgroundImage: `url(${data.reviewerAvatarDataUri})`,
            backgroundSize: "cover", backgroundPosition: "center", display: "flex", flexShrink: 0,
          },
        })
      : h("div", {
          style: {
            width: 30, height: 30, borderRadius: 15, background: ACCENT, display: "flex",
            alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0,
          },
        }, data.reviewerUsername.slice(0, 2).toUpperCase()),
    h("div", { style: { fontSize: 19, fontWeight: 700, color: "#f0ede8", display: "flex" } }, `@${data.reviewerUsername}`),
    h("div", { style: { fontSize: 19, color: "#6a6866", display: "flex" } }, "·"),
    h("div", { style: { fontSize: 19, color: "#928f89", display: "flex" } }, data.timeAgoLabel),
  ]);

  const titleBlockChildren: any[] = [
    h("div", {
      style: {
        fontFamily: "DM Serif Display", fontSize: gameTitleFontSize(data.gameTitle), color: "#f8f6f2",
        lineHeight: 1.1, display: "flex", maxWidth: RIGHT_W - PAD * 2 - BADGE_SIZE - 24,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      },
    }, truncate(data.gameTitle, 48)),
  ];
  if (data.reviewTitle) {
    titleBlockChildren.push(
      h("div", {
        style: {
          fontSize: 21, fontStyle: "italic", color: ACCENT, display: "flex",
          maxWidth: RIGHT_W - PAD * 2 - BADGE_SIZE - 24,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        },
      }, `"${truncate(data.reviewTitle, 44)}"`)
    );
  }

  const scoreBadge = h("div", {
    style: {
      width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: 22, background: badgeBg,
      border: `2px solid ${hexToRgba(scoreColor(data.score), 0.5)}`,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
  }, [
    h("div", { style: { fontFamily: "DM Serif Display", fontSize: 52, fontWeight: 700, color: badgeText, display: "flex", lineHeight: 1 } }, String(data.score)),
    h("div", { style: { fontSize: 15, fontWeight: 600, color: hexToRgba(badgeText, 0.75), display: "flex", marginTop: 2 } }, "/ 10"),
  ]);

  const scoreRow = h("div", { style: { display: "flex", alignItems: "center", gap: 24 } }, [
    scoreBadge,
    h("div", { style: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 } }, titleBlockChildren),
  ]);

  const bodyMaxChars = data.reviewTitle ? 190 : 260;
  const bodyBlock = data.containsSpoilers
    ? h("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, [
        h("div", {
          style: {
            display: "flex", alignSelf: "flex-start", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700,
            letterSpacing: 1, textTransform: "uppercase", color: "#fb923c",
            background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.35)",
            borderRadius: 20, padding: "4px 12px 4px 10px",
          },
        }, [
          // Plain triangle built from a rotated square, not a glyph — satori has
          // no emoji font loaded, so a literal ⚠ character renders as a tofu box.
          h("div", {
            style: {
              width: 8, height: 8, background: "#fb923c", borderRadius: 2,
              transform: "rotate(45deg)", display: "flex", flexShrink: 0,
            },
          }),
          h("div", { style: { display: "flex" } }, "Spoilers"),
        ]),
        h("div", {
          style: { fontSize: 21, fontStyle: "italic", color: "#928f89", lineHeight: 1.5, display: "flex", maxWidth: RIGHT_W - PAD * 2 },
        }, "Body hidden to avoid spoiling it — read the full review on Chekpoint."),
      ])
    : h("div", {
        style: { fontSize: 21, color: "#c9c6c0", lineHeight: 1.55, display: "flex", maxWidth: RIGHT_W - PAD * 2 },
      }, truncate(data.body, bodyMaxChars));

  const rightPanel = h("div", {
    style: {
      width: RIGHT_W, height: HEIGHT, display: "flex", flexDirection: "column", justifyContent: "center",
      padding: PAD, gap: 28,
    },
  }, [
    metaRow,
    scoreRow,
    h("div", { style: { width: "100%", height: 1, background: "rgba(255,255,255,0.08)", display: "flex" } }),
    bodyBlock,
  ]);

  const wordmark = h("div", {
    style: {
      position: "absolute", top: 24, right: 32, display: "flex", alignItems: "center", gap: 9,
      background: "rgba(9,9,10,0.45)", borderRadius: 20, padding: "8px 16px 8px 14px",
    },
  }, [
    h("div", { style: { width: 9, height: 9, borderRadius: 5, background: ACCENT, display: "flex" } }),
    h("div", { style: { fontSize: 21, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.95)" } }, "CHEKPOINT"),
  ]);

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, [leftPanel, rightPanel, wordmark]);
}
