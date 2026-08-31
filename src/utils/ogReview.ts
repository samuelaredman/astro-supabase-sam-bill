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

const WIDTH    = 1200;
const HEIGHT   = 630;
const LEFT_W   = 380;
const RIGHT_W  = WIDTH - LEFT_W; // 820
const PAD      = 52;
const BADGE_SIZE = 150;

function gameTitleFontSize(title: string): number {
  const len = title.length;
  if (len <= 18) return 58;
  if (len <= 30) return 50;
  if (len <= 50) return 42;
  return 36;
}

export function buildReviewOgTree(data: ReviewOgData): any {
  const badgeBg   = scoreBadgeBg(data.score);
  const badgeText = scoreBadgeText(data.score);

  // ── Left panel: cover art centred on a purple-glow backdrop ──────────────
  const coverW = 270;
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

  // ── Game title ────────────────────────────────────────────────────────────
  const titleMaxW = RIGHT_W - PAD * 2 - BADGE_SIZE - 24;
  const gameTitleBlock = h("div", {
    style: {
      fontFamily: "DM Serif Display", fontSize: gameTitleFontSize(data.gameTitle),
      color: "#f8f6f2", lineHeight: 1.2, minWidth: 0, maxWidth: titleMaxW,
      display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3,
      overflow: "hidden", textOverflow: "ellipsis",
    },
  }, truncate(data.gameTitle, 200));

  const scoreRow = h("div", {
    style: { display: "flex", alignItems: "center", gap: 24 },
  }, [scoreBadgeWrap, gameTitleBlock]);

  // ── Review body excerpt ───────────────────────────────────────────────────
  const excerpt = data.reviewBody
    ? truncate(data.reviewBody.replace(/\n+/g, " ").trim(), 200)
    : null;

  const divider = h("div", {
    style: { height: 1, background: "rgba(255,255,255,0.08)", display: "flex" },
  });

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

  const reviewerRowChildren: any[] = [
    avatar,
    h("div", {
      style: {
        fontSize: 22, fontWeight: 700, color: "#c9c6c0",
        display: "flex", flexShrink: 0,
        maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      },
    }, `@${truncate(data.reviewerUsername, 22)}`),
  ];

  if (data.reviewTitle) {
    reviewerRowChildren.push(
      h("div", { style: { width: 1, height: 24, background: "rgba(255,255,255,0.2)", display: "flex", flexShrink: 0 } }),
      h("div", {
        style: {
          fontSize: 18, color: "#7a7872", fontStyle: "italic",
          display: "flex", minWidth: 0, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
        },
      }, truncate(data.reviewTitle, 48)),
    );
  }

  const reviewerRow = h("div", {
    style: { display: "flex", alignItems: "center", gap: 14 },
  }, reviewerRowChildren);

  // ── Right panel: vertical column, centred ─────────────────────────────────
  const rightPanelItems: any[] = [scoreRow];
  if (excerpt) {
    rightPanelItems.push(
      divider,
      h("div", {
        style: {
          fontSize: 19, color: "rgba(210,206,200,0.72)", lineHeight: 1.65,
          fontStyle: "italic", display: "-webkit-box",
          WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
          overflow: "hidden", textOverflow: "ellipsis",
        },
      }, `"${excerpt}"`),
    );
  }
  rightPanelItems.push(divider, reviewerRow);

  const rightPanel = h("div", {
    style: {
      width: RIGHT_W, height: HEIGHT, display: "flex", flexDirection: "column",
      justifyContent: "center", padding: PAD, gap: 22,
    },
  }, rightPanelItems);

  // ── CHEKPOINT wordmark ────────────────────────────────────────────────────
  const wordmark = h("div", {
    style: {
      position: "absolute", top: 24, right: 32,
      display: "flex", alignItems: "center", gap: 9,
      background: "rgba(9,9,10,0.45)", borderRadius: 20,
      padding: "8px 16px 8px 14px",
    },
  }, [
    h("div", { style: { width: 9, height: 9, borderRadius: 5, background: OG_ACCENT, display: "flex" } }),
    h("div", {
      style: { fontSize: 21, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.95)", display: "flex" },
    }, "CHEKPOINT"),
  ]);

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative",
      overflow: "hidden", backgroundColor: OG_BG, fontFamily: "DM Sans",
    },
  }, [leftPanel, rightPanel, wordmark]);
}
