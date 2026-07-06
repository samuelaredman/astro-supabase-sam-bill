import { h, truncate, scoreColor, scoreBadgeBg, scoreBadgeText, bigTitleFontSize, hexToRgba, OG_ACCENT, OG_BG } from "./og";

// Right-panel game title loses width to the score badge, so it needs its own
// (smaller) scale than a full-width title like ogList's/the review title's.
function gameTitleFontSize(title: string): number {
  if (title.length <= 16) return 42;
  if (title.length <= 28) return 34;
  if (title.length <= 42) return 27;
  return 22;
}

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
const LEFT_W = 420;
const RIGHT_W = WIDTH - LEFT_W;
const PAD = 56;
const BADGE_SIZE = 200;
// Both the profile chip (over the cover) and the review title (in the right
// panel) anchor to this same bottom offset so they read as one row, "next
// to" each other, even though they sit in two different panels.
const BOTTOM_ROW_OFFSET = 100;

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

  // ── Right panel: a big, centered score badge + game title — the card's main event ──
  const scoreBadge = h("div", {
    style: {
      width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: 32, background: badgeBg,
      border: `3px solid ${hexToRgba(scoreColor(data.score), 0.5)}`,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
  }, [
    h("div", {
      style: { fontFamily: "DM Serif Display", fontSize: 110, fontWeight: 700, color: badgeText, display: "flex", lineHeight: 1 },
    }, String(data.score)),
  ]);

  const gameTitleBlock = h("div", {
    style: {
      fontFamily: "DM Serif Display", fontSize: gameTitleFontSize(data.gameTitle), color: "#f8f6f2",
      lineHeight: 1.15, display: "flex", maxWidth: RIGHT_W - PAD * 2 - BADGE_SIZE - 32,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    },
  }, truncate(data.gameTitle, 40));

  const scoreRow = h("div", { style: { display: "flex", alignItems: "center", gap: 32 } }, [
    scoreBadge,
    gameTitleBlock,
  ]);

  const rightPanel = h("div", {
    style: {
      position: "relative", width: RIGHT_W, height: HEIGHT, display: "flex", flexDirection: "column",
      justifyContent: "center", padding: PAD,
    },
  }, [scoreRow]);

  const wordmark = h("div", {
    style: {
      position: "absolute", top: 24, right: 32, display: "flex", alignItems: "center", gap: 9,
      background: "rgba(9,9,10,0.45)", borderRadius: 20, padding: "8px 16px 8px 14px",
    },
  }, [
    h("div", { style: { width: 9, height: 9, borderRadius: 5, background: ACCENT, display: "flex" } }),
    h("div", { style: { fontSize: 21, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.95)" } }, "CHEKPOINT"),
  ]);

  // ── Profile chip, overlaid on the bottom of the cover art ──
  const avatar = data.reviewerAvatarDataUri
    ? h("div", {
        style: {
          width: 40, height: 40, borderRadius: 20, backgroundImage: `url(${data.reviewerAvatarDataUri})`,
          backgroundSize: "cover", backgroundPosition: "center", display: "flex", flexShrink: 0,
        },
      })
    : h("div", {
        style: {
          width: 40, height: 40, borderRadius: 20, background: ACCENT, display: "flex",
          alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 15, fontWeight: 700, flexShrink: 0,
        },
      }, data.reviewerUsername.slice(0, 2).toUpperCase());

  const profileChip = h("div", {
    style: {
      position: "absolute", left: 40, bottom: BOTTOM_ROW_OFFSET, display: "flex", alignItems: "center", gap: 12,
      background: "rgba(9,9,10,0.6)", borderRadius: 16, padding: "10px 20px 10px 10px",
      border: "1px solid rgba(255,255,255,0.08)",
    },
  }, [
    avatar,
    h("div", {
      style: {
        fontSize: 21, fontWeight: 700, color: "#f0ede8", display: "flex", maxWidth: LEFT_W - 120,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      },
    }, `@${truncate(data.reviewerUsername, 20)}`),
  ]);

  // ── The review's own title — displayed like a list title, next to the profile chip ──
  const reviewTitleEl = data.reviewTitle
    ? h("div", {
        style: {
          position: "absolute", left: LEFT_W + PAD, right: PAD, bottom: BOTTOM_ROW_OFFSET,
          fontFamily: "DM Serif Display", fontSize: bigTitleFontSize(data.reviewTitle), color: "#f8f6f2",
          lineHeight: 1.1, display: "flex", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textShadow: "0 2px 16px rgba(0,0,0,0.5)",
        },
      }, truncate(data.reviewTitle, 60))
    : null;

  const children = [leftPanel, rightPanel, wordmark, profileChip];
  if (reviewTitleEl) children.push(reviewTitleEl);

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, children);
}
