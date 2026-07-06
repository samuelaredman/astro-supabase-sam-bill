import { h, truncate, scoreBadgeBg, scoreBadgeText, bigTitleFontSize, hexToRgba, OG_ACCENT, OG_BG } from "./og";

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
      // The cover is a real <img> with objectFit "contain", not a div with a
      // backgroundImage — satori's backgroundSize:"contain" is broken (renders
      // an unscaled, top-left-anchored corner of the image instead of scaling
      // it to fit); <img>+objectFit doesn't have that bug and box art isn't
      // reliably exactly 264:374, so plain "cover" would crop some games.
      h("div", {
        style: {
          width: coverW + 16, height: coverH + 16, borderRadius: 20,
          background: hexToRgba(ACCENT, 0.16), display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("img", {
          src: data.coverDataUri,
          style: { width: coverW, height: coverH, borderRadius: 14, objectFit: "contain", display: "flex" },
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
      justifyContent: "center", overflow: "hidden",
    },
  }, leftChildren);

  // ── Right panel: a big, centered score badge + game title — the only text
  // in the card itself, so the title is sized like a headline, not a caption.
  const scoreBadge = h("div", {
    style: {
      // No border: satori/resvg render border+large-borderRadius as a subtle
      // (unwanted) vertical gradient across the fill, most visible on the
      // white score-10 badge. A flat fill reads cleanly without it.
      width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: 32, background: badgeBg,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
  }, [
    h("div", {
      style: { fontFamily: "DM Serif Display", fontSize: 110, fontWeight: 700, color: badgeText, display: "flex", lineHeight: 1 },
    }, String(data.score)),
  ]);

  const gameTitleBlock = h("div", {
    style: {
      fontFamily: "DM Serif Display", fontSize: bigTitleFontSize(data.gameTitle), color: "#f8f6f2",
      lineHeight: 1.1, display: "flex", minWidth: 0, maxWidth: RIGHT_W - PAD * 2 - BADGE_SIZE - 32,
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

  // ── Bottom overlay: profile + username, with the review's own title next
  // to them in the same row — all laid over the full card (cover + score +
  // game title), with a gradient scrim behind for legibility.
  const AVATAR_SIZE = 84;
  const avatar = data.reviewerAvatarDataUri
    // A real <img> with objectFit, not a div with a backgroundImage — satori
    // renders backgroundSize/backgroundPosition on a div unreliably (visibly
    // off-center crops, confirmed against a plain square test image), the
    // same bug already found and fixed on the cover art.
    ? h("img", {
        src: data.reviewerAvatarDataUri,
        style: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, objectFit: "cover", display: "flex", flexShrink: 0 },
      })
    : h("div", {
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, background: ACCENT, display: "flex",
          alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 30, fontWeight: 700, flexShrink: 0,
        },
      }, data.reviewerUsername.slice(0, 2).toUpperCase());

  const bottomRowChildren: any[] = [
    avatar,
    h("div", {
      style: {
        fontSize: 42, fontWeight: 700, color: "#f0ede8", display: "flex", flexShrink: 0,
        maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      },
    }, `@${truncate(data.reviewerUsername, 24)}`),
  ];
  if (data.reviewTitle) {
    bottomRowChildren.push(
      h("div", { style: { width: 1, height: 52, background: "rgba(255,255,255,0.18)", display: "flex", flexShrink: 0 } }),
      h("div", {
        style: {
          fontFamily: "DM Serif Display", fontSize: bigTitleFontSize(data.reviewTitle), color: "#f8f6f2",
          lineHeight: 1.08, display: "flex", minWidth: 0, flex: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textShadow: "0 2px 16px rgba(0,0,0,0.6)",
        },
      }, truncate(data.reviewTitle, 60))
    );
  }

  const bottomOverlay: any[] = [
    // Gradient scrim over the poster only — that's the only region where
    // legibility depends on the cover art underneath. Letting this span the
    // full canvas width used to fade into the bottom of the score badge too,
    // since the badge sits well within the scrim's height range.
    h("div", {
      style: {
        position: "absolute", left: 0, width: LEFT_W + 40, bottom: 0, height: 280, display: "flex",
        backgroundImage: `linear-gradient(to top, rgba(9,9,10,0.96) 0%, rgba(9,9,10,0.8) 38%, rgba(9,9,10,0.32) 68%, rgba(9,9,10,0) 100%)`,
      },
    }),
    h("div", {
      style: {
        position: "absolute", left: 56, right: 56, bottom: 44, display: "flex", alignItems: "baseline", gap: 18,
      },
    }, bottomRowChildren),
  ];

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, [leftPanel, rightPanel, wordmark, ...bottomOverlay]);
}
