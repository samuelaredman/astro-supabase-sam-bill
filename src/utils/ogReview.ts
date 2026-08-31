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
const RIGHT_W    = WIDTH - LEFT_W;  // 820
const PAD_V      = 40;              // top/bottom — shared by left + right panels
const PAD_H      = 48;              // left/right padding on right panel
const BADGE_SIZE = 150;
const GAP        = 16;
const COVER_W    = 240;
const COVER_H    = Math.round(COVER_W * (374 / 264)); // ≈ 340px  (3:4 box art)
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

  // ── Avatar (reused in username row) ──────────────────────────────────────
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

  // ── Left panel ─────────────────────────────────────────────────────────
  // Cover is top-pinned (matching score badge top). Username is bottom-pinned.
  const coverFrameLeft = Math.round((LEFT_W - (COVER_W + 16)) / 2);

  const leftChildren: any[] = [
    // Purple glow behind cover
    h("div", {
      style: {
        position: "absolute", top: -120, left: -120,
        width: 460, height: 460, borderRadius: 230, display: "flex",
        backgroundImage: `radial-gradient(circle, ${hexToRgba(OG_ACCENT, 0.20)} 0%, transparent 68%)`,
      },
    }),
  ];

  // Cover art — top-aligned with score badge (top: PAD_V)
  if (data.coverDataUri) {
    leftChildren.push(
      h("div", {
        style: {
          position: "absolute", top: PAD_V, left: coverFrameLeft,
          width: COVER_W + 16, height: COVER_H + 16,
          borderRadius: 18, background: hexToRgba(OG_ACCENT, 0.18),
          display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("img", {
          src: data.coverDataUri,
          style: { width: COVER_W, height: COVER_H, borderRadius: 12, objectFit: "contain", display: "flex" },
        }),
      ])
    );
  } else {
    leftChildren.push(
      h("div", {
        style: {
          position: "absolute", top: PAD_V,
          left: Math.round((LEFT_W - COVER_W) / 2),
          width: COVER_W, height: COVER_H,
          borderRadius: 12, background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center",
        },
      }, [
        h("div", {
          style: { fontFamily: "DM Serif Display", fontSize: 72, color: "rgba(240,237,232,0.18)", display: "flex" },
        }, data.gameTitle.slice(0, 1).toUpperCase()),
      ])
    );
  }

  // Username row — bottom-pinned at PAD_V
  leftChildren.push(
    h("div", {
      style: {
        position: "absolute", bottom: PAD_V, left: 20,
        display: "flex", alignItems: "center", gap: 12,
      },
    }, [
      avatar,
      h("div", {
        style: {
          fontSize: 20, fontWeight: 700, color: "#b8b4ac",
          display: "flex", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", maxWidth: 270,
        },
      }, `@${truncate(data.reviewerUsername, 22)}`),
    ])
  );

  const leftPanel = h("div", {
    style: {
      position: "relative", width: LEFT_W, height: HEIGHT, flexShrink: 0, overflow: "hidden",
    },
  }, leftChildren);

  // ── Score badge with score-coloured glow ─────────────────────────────────
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
        width: BADGE_SIZE, height: BADGE_SIZE, borderRadius: 22, background: badgeBg,
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
  const titleMaxW = RIGHT_W - PAD_H * 2 - BADGE_SIZE - 24;
  const gameTitleBlock = h("div", {
    style: {
      fontFamily: "DM Serif Display", fontSize: gameTitleFontSize(data.gameTitle),
      color: "#f8f6f2", lineHeight: 1.2, minWidth: 0, maxWidth: titleMaxW,
      display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
      overflow: "hidden", textOverflow: "ellipsis",
    },
  }, truncate(data.gameTitle, 200));

  const scoreRow = h("div", {
    style: { display: "flex", alignItems: "center", gap: 24, flexShrink: 0 },
  }, [scoreBadgeWrap, gameTitleBlock]);

  // ── Review title — prominent serif block ──────────────────────────────────
  const reviewTitleBlock = data.reviewTitle
    ? h("div", {
        style: {
          fontFamily: "DM Serif Display", fontSize: 27, color: "#ccc8c0",
          lineHeight: 1.3, flexShrink: 0,
          display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
          overflow: "hidden", textOverflow: "ellipsis",
        },
      }, `"${truncate(data.reviewTitle, 120)}"`)
    : null;

  // ── Divider ───────────────────────────────────────────────────────────────
  const divider = h("div", {
    style: { height: 1, background: "rgba(255,255,255,0.09)", display: "flex", flexShrink: 0 },
  });

  // ── Review body — fills remaining height down to PAD_V ───────────────────
  // flex: 1 makes this wrapper grow to fill all remaining right-panel height,
  // aligning its bottom with the username row in the left panel (both at PAD_V).
  const excerpt = data.reviewBody
    ? truncate(data.reviewBody.replace(/\n+/g, " ").trim(), 400)
    : null;

  const bodyBlock = excerpt
    ? h("div", {
        style: { flex: 1, overflow: "hidden", display: "flex", alignItems: "flex-start" },
      }, [
        h("div", {
          style: {
            fontSize: 23, color: "rgba(215,210,203,0.80)", lineHeight: 1.65,
            fontStyle: "italic",
            display: "-webkit-box", WebkitLineClamp: 14, WebkitBoxOrient: "vertical",
            overflow: "hidden", textOverflow: "ellipsis",
          },
        }, `"${excerpt}"`),
      ])
    : null;

  // ── Right panel: flex column, top-aligned, body fills remaining space ─────
  const rightPanelItems: any[] = [scoreRow];
  if (reviewTitleBlock) rightPanelItems.push(reviewTitleBlock);
  if (bodyBlock)        rightPanelItems.push(divider, bodyBlock);

  const rightPanel = h("div", {
    style: {
      width: RIGHT_W, height: HEIGHT,
      display: "flex", flexDirection: "column", justifyContent: "flex-start",
      paddingTop: PAD_V, paddingBottom: PAD_V,
      paddingLeft: PAD_H, paddingRight: PAD_H,
      gap: GAP,
    },
  }, rightPanelItems);

  // ── CHEKPOINT wordmark ────────────────────────────────────────────────────
  const wordmark = h("div", {
    style: {
      position: "absolute", top: 20, right: 26,
      display: "flex", alignItems: "center", gap: 8,
      background: "rgba(9,9,10,0.45)", borderRadius: 18,
      padding: "7px 13px 7px 11px",
    },
  }, [
    h("div", { style: { width: 8, height: 8, borderRadius: 4, background: OG_ACCENT, display: "flex" } }),
    h("div", {
      style: { fontSize: 18, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.9)", display: "flex" },
    }, "CHEKPOINT"),
  ]);

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative",
      overflow: "hidden", backgroundColor: OG_BG, fontFamily: "DM Sans",
    },
  }, [leftPanel, rightPanel, wordmark]);
}
