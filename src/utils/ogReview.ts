import {
  h, truncate, scoreBadgeBg, scoreBadgeText, scoreColor, hexToRgba, OG_ACCENT, OG_BG,
} from "./og";

export interface ReviewOgData {
  gameTitle: string;
  coverDataUri: string | null;
  score: number;
  reviewTitle: string | null;
  reviewBody: string;
  reviewerUsername: string;
  reviewerAvatarDataUri: string | null;
}

const WIDTH      = 1200;
const HEIGHT     = 630;
const LEFT_W     = 380;
const RIGHT_W    = WIDTH - LEFT_W;   // 820
const PAD_V      = 40;               // top/bottom padding — same on both panels & username
const PAD_H      = 48;               // left/right padding on right panel
const BADGE_SIZE = 118;
const GAP        = 16;
const COVER_W    = 258;
const COVER_H    = Math.round(COVER_W * (374 / 264)); // ≈ 366px
const AVATAR_SIZE = 44;

function gameTitleFontSize(title: string): number {
  const len = title.length;
  if (len <= 16) return 52;
  if (len <= 28) return 44;
  if (len <= 44) return 38;
  return 32;
}

export function buildReviewOgTree(data: ReviewOgData): any {
  const badgeBg   = scoreBadgeBg(data.score);
  const badgeText = scoreBadgeText(data.score);

  // ── Root-level absolutes (satori only supports absolute on root children) ─

  // Purple glow centred behind the cover in the left panel
  const glow = h("div", {
    style: {
      position: "absolute", top: 85, left: -45,
      width: 460, height: 460, borderRadius: 230, display: "flex",
      backgroundImage: `radial-gradient(circle, ${hexToRgba(OG_ACCENT, 0.22)} 0%, transparent 68%)`,
    },
  });

  // Username row — absolute on root, bottom-left, aligned with right-panel bottom padding
  const avatar = data.reviewerAvatarDataUri
    ? h("img", {
        src: data.reviewerAvatarDataUri,
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
          objectFit: "cover", display: "flex", flexShrink: 0,
        },
      })
    : h("div", {
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
          background: OG_ACCENT, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0,
        },
      }, data.reviewerUsername.slice(0, 2).toUpperCase());

  const usernameRow = h("div", {
    style: {
      position: "absolute", bottom: 24, left: 26,
      display: "flex", alignItems: "center", gap: 12,
    },
  }, [
    avatar,
    h("div", {
      style: {
        fontSize: 20, fontWeight: 700, color: "#b8b4ac",
        display: "flex", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", maxWidth: 280,
      },
    }, `@${truncate(data.reviewerUsername, 22)}`),
  ]);

  // CHEKPOINT.GG wordmark — purple gradient pill matching the list share card style
  const wordmark = h("div", {
    style: {
      position: "absolute", top: 22, right: 26,
      display: "flex", alignItems: "center", gap: 8,
      background: "linear-gradient(135deg, rgba(96,80,200,0.55) 0%, rgba(139,123,240,0.35) 100%)",
      border: "1px solid rgba(139,123,240,0.45)",
      borderRadius: 20, padding: "7px 14px 7px 11px",
    },
  }, [
    h("div", { style: { width: 8, height: 8, borderRadius: 4, background: OG_ACCENT, display: "flex", flexShrink: 0 } }),
    h("div", {
      style: { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: "#f0ede8", display: "flex" },
    }, "CHEKPOINT.GG"),
  ]);

  // ── Left panel: cover art top-aligned (paddingTop matches right panel's PAD_V) ─
  const coverEl = data.coverDataUri
    ? h("div", {
        style: {
          width: COVER_W + 16, height: COVER_H + 16, borderRadius: 18,
          background: hexToRgba(OG_ACCENT, 0.18),
          display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("img", {
          src: data.coverDataUri,
          style: { width: COVER_W, height: COVER_H, borderRadius: 12, objectFit: "contain", display: "flex" },
        }),
      ])
    : h("div", {
        style: {
          width: COVER_W, height: COVER_H, borderRadius: 12,
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)",
          display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("div", {
          style: { fontFamily: "DM Serif Display", fontSize: 72, color: "rgba(240,237,232,0.18)", display: "flex" },
        }, data.gameTitle.slice(0, 1).toUpperCase()),
      ]);

  const leftPanel = h("div", {
    style: {
      width: LEFT_W, height: HEIGHT, flexShrink: 0,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      overflow: "hidden",
    },
  }, [coverEl]);

  // ── Score badge with score-coloured glow ─────────────────────────────────
  const glowSize = BADGE_SIZE + 90;
  const scoreBadgeWrap = h("div", { style: { position: "relative", display: "flex", flexShrink: 0 } }, [
    h("div", {
      style: {
        position: "absolute",
        top: -(glowSize - BADGE_SIZE) / 2, left: -(glowSize - BADGE_SIZE) / 2,
        width: glowSize, height: glowSize, borderRadius: glowSize / 2, display: "flex",
        backgroundImage: `radial-gradient(circle, ${hexToRgba(scoreColor(data.score), 0.32)} 0%, transparent 68%)`,
      },
    }),
    h("div", {
      style: {
        width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: 18, background: badgeBg,
        display: "flex", alignItems: "center", justifyContent: "center",
      },
    }, [
      h("div", {
        style: {
          fontFamily: "DM Serif Display", fontSize: 70, fontWeight: 700,
          color: badgeText, display: "flex", lineHeight: 1,
        },
      }, String(data.score)),
    ]),
  ]);

  // ── Game title ────────────────────────────────────────────────────────────
  const titleMaxW = RIGHT_W - PAD_H * 2 - BADGE_SIZE - 24;
  const gameTitle = h("div", {
    style: {
      fontFamily: "DM Serif Display", fontSize: gameTitleFontSize(data.gameTitle),
      color: "#f8f6f2", lineHeight: 1.2, minWidth: 0, maxWidth: titleMaxW,
      display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
      overflow: "hidden", textOverflow: "ellipsis",
    },
  }, truncate(data.gameTitle, 200));

  const scoreRow = h("div", {
    style: { display: "flex", alignItems: "center", gap: 24, flexShrink: 0 },
  }, [scoreBadgeWrap, gameTitle]);

  // ── Review title — prominent serif, sits under score row ─────────────────
  const reviewTitleBlock = data.reviewTitle
    ? h("div", {
        style: {
          fontFamily: "DM Serif Display", fontSize: 27, color: "#cdc9c1",
          lineHeight: 1.3, flexShrink: 0,
          display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
          overflow: "hidden", textOverflow: "ellipsis",
        },
      }, `"${truncate(data.reviewTitle, 120)}"`)
    : null;

  // ── Divider ───────────────────────────────────────────────────────────────
  const divider = h("div", {
    style: { height: 1, background: "rgba(255,255,255,0.09)", flexShrink: 0, display: "flex" },
  });

  // ── Review body — clamp sized to fill to bottom padding ──────────────────
  // Approx available height: HEIGHT - PAD_V(top) - 150(score) - gaps - optional_title - PAD_V(bottom)
  // ~315-360px → 8-9 lines at 23px × 1.65
  const bodyClamp = data.reviewTitle ? 8 : 9;
  const excerpt = data.reviewBody
    ? truncate(data.reviewBody.replace(/\n+/g, " ").trim(), 380)
    : null;

  const bodyBlock = excerpt
    ? h("div", {
        style: {
          fontSize: 23, color: "rgba(215,210,203,0.80)", lineHeight: 1.65,
          fontStyle: "italic",
          display: "-webkit-box", WebkitLineClamp: bodyClamp, WebkitBoxOrient: "vertical",
          overflow: "hidden", textOverflow: "ellipsis",
        },
      }, `"${excerpt}"`)
    : null;

  // ── Right panel: top-aligned flex column ──────────────────────────────────
  const rightItems: any[] = [scoreRow];
  if (reviewTitleBlock) rightItems.push(reviewTitleBlock);
  if (bodyBlock)        rightItems.push(divider, bodyBlock);

  const rightPanel = h("div", {
    style: {
      width: RIGHT_W, height: HEIGHT,
      display: "flex", flexDirection: "column", justifyContent: "center",
      paddingTop: PAD_V, paddingBottom: PAD_V,
      paddingLeft: PAD_H, paddingRight: PAD_H,
      gap: GAP,
    },
  }, rightItems);

  // ── Root ─────────────────────────────────────────────────────────────────
  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative",
      overflow: "hidden", backgroundColor: OG_BG, fontFamily: "DM Sans",
    },
  }, [glow, leftPanel, rightPanel, usernameRow, wordmark]);
}
