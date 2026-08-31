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
const PAD_V      = 40;               // top/bottom padding — tighter to fill height
const PAD_H      = 48;               // left/right padding
const BADGE_SIZE = 150;
const GAP        = 16;               // gap between flex items
// usable content width inside the right panel
const CONTENT_W  = RIGHT_W - PAD_H * 2; // 724px

function gameTitleFontSize(title: string): number {
  const len = title.length;
  if (len <= 16) return 54;
  if (len <= 28) return 46;
  if (len <= 44) return 40;
  return 34;
}

export function buildReviewOgTree(data: ReviewOgData): any {
  const badgeBg   = scoreBadgeBg(data.score);
  const badgeText = scoreBadgeText(data.score);

  // ── Left panel: cover art centred on a purple-glow backdrop ──────────────
  const coverW = 272;
  const coverH = Math.round(coverW * (374 / 264));

  const leftChildren: any[] = [
    h("div", {
      style: {
        position: "absolute", top: -150, left: -150,
        width: 500, height: 500, borderRadius: 250, display: "flex",
        backgroundImage: `radial-gradient(circle, ${hexToRgba(OG_ACCENT, 0.22)} 0%, transparent 68%)`,
      },
    }),
  ];

  if (data.coverDataUri) {
    leftChildren.push(
      h("div", {
        style: {
          width: coverW + 16, height: coverH + 16, borderRadius: 20,
          background: hexToRgba(OG_ACCENT, 0.18),
          display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("img", {
          src: data.coverDataUri,
          style: { width: coverW, height: coverH, borderRadius: 14, objectFit: "contain", display: "flex" },
        }),
      ])
    );
  } else {
    leftChildren.push(
      h("div", {
        style: {
          width: coverW, height: coverH, borderRadius: 14,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("div", {
          style: { fontFamily: "DM Serif Display", fontSize: 80, color: "rgba(240,237,232,0.2)", display: "flex" },
        }, data.gameTitle.slice(0, 1).toUpperCase()),
      ])
    );
  }

  const leftPanel = h("div", {
    style: {
      position: "relative", width: LEFT_W, height: HEIGHT, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
    },
  }, leftChildren);

  // ── Score badge with score-coloured glow ──────────────────────────────────
  const glowSize = BADGE_SIZE + 110;
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
        width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: 24, background: badgeBg,
        display: "flex", alignItems: "center", justifyContent: "center",
      },
    }, [
      h("div", {
        style: {
          fontFamily: "DM Serif Display", fontSize: 86, fontWeight: 700,
          color: badgeText, display: "flex", lineHeight: 1,
        },
      }, String(data.score)),
    ]),
  ]);

  // ── Game title (beside the score badge) ───────────────────────────────────
  const titleMaxW = CONTENT_W - BADGE_SIZE - 24;
  const gameTitleBlock = h("div", {
    style: {
      fontFamily: "DM Serif Display", fontSize: gameTitleFontSize(data.gameTitle),
      color: "#f8f6f2", lineHeight: 1.2, minWidth: 0, maxWidth: titleMaxW,
      display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
      overflow: "hidden", textOverflow: "ellipsis",
    },
  }, truncate(data.gameTitle, 200));

  const scoreRow = h("div", {
    style: { display: "flex", alignItems: "center", gap: 24 },
  }, [scoreBadgeWrap, gameTitleBlock]);

  // ── Review title — prominent, sits directly below the score row ───────────
  const reviewTitleBlock = data.reviewTitle
    ? h("div", {
        style: {
          fontFamily: "DM Serif Display", fontSize: 28, color: "#d6d2ca",
          lineHeight: 1.3, display: "-webkit-box",
          WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
          overflow: "hidden", textOverflow: "ellipsis",
        },
      }, `"${truncate(data.reviewTitle, 120)}"`)
    : null;

  // ── Divider ───────────────────────────────────────────────────────────────
  const divider = h("div", {
    style: { height: 1, background: "rgba(255,255,255,0.09)", display: "flex" },
  });

  // ── Review body — 5 lines, large enough to read in previews ──────────────
  const excerpt = data.reviewBody
    ? truncate(data.reviewBody.replace(/\n+/g, " ").trim(), 260)
    : null;

  const bodyBlock = excerpt
    ? h("div", {
        style: {
          fontSize: 24, color: "rgba(218,213,206,0.78)", lineHeight: 1.6,
          fontStyle: "italic", display: "-webkit-box",
          WebkitLineClamp: 5, WebkitBoxOrient: "vertical",
          overflow: "hidden", textOverflow: "ellipsis",
        },
      }, `"${excerpt}"`)
    : null;

  // ── Reviewer row ──────────────────────────────────────────────────────────
  const AVATAR_SIZE = 46;
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
          justifyContent: "center", fontSize: 16, fontWeight: 700, color: "#fff", flexShrink: 0,
        },
      }, data.reviewerUsername.slice(0, 2).toUpperCase());

  const reviewerRow = h("div", {
    style: { display: "flex", alignItems: "center", gap: 14 },
  }, [
    avatar,
    h("div", {
      style: {
        fontSize: 22, fontWeight: 700, color: "#b8b4ac",
        display: "flex", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      },
    }, `@${truncate(data.reviewerUsername, 24)}`),
  ]);

  // ── Right panel ───────────────────────────────────────────────────────────
  const items: any[] = [scoreRow];
  if (reviewTitleBlock) items.push(reviewTitleBlock);
  if (bodyBlock)        items.push(divider, bodyBlock);
  items.push(divider, reviewerRow);

  const rightPanel = h("div", {
    style: {
      width: RIGHT_W, height: HEIGHT,
      display: "flex", flexDirection: "column", justifyContent: "center",
      paddingTop: PAD_V, paddingBottom: PAD_V,
      paddingLeft: PAD_H, paddingRight: PAD_H,
      gap: GAP,
    },
  }, items);

  // ── CHEKPOINT wordmark ────────────────────────────────────────────────────
  const wordmark = h("div", {
    style: {
      position: "absolute", top: 22, right: 28,
      display: "flex", alignItems: "center", gap: 9,
      background: "rgba(9,9,10,0.45)", borderRadius: 20,
      padding: "7px 14px 7px 12px",
    },
  }, [
    h("div", { style: { width: 8, height: 8, borderRadius: 4, background: OG_ACCENT, display: "flex" } }),
    h("div", {
      style: { fontSize: 19, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.9)", display: "flex" },
    }, "CHEKPOINT"),
  ]);

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative",
      overflow: "hidden", backgroundColor: OG_BG, fontFamily: "DM Sans",
    },
  }, [leftPanel, rightPanel, wordmark]);
}
