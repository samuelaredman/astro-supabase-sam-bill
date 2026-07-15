import { h, OG_ACCENT, OG_BG, scoreColor, scoreBadgeBg, scoreBadgeText, hexToRgba, truncate } from "./og";

export interface ListGridEntry {
  /** Pre-cropped to exactly CELL_W × COVER_H by the endpoint. */
  coverDataUri: string | null;
  rank: number;
  gameTitle: string;
  score: number | null;
  hoursPlayed: number | null;
  notes: string | null;
}

export interface ListGridData {
  title: string;
  ownerUsername: string;
  ownerAvatarDataUri: string | null;
  isRanked: boolean;
  totalGames: number;
  avgScore: number | null;
  entries: ListGridEntry[];
}

export const CANVAS_W = 1080;
export const AVATAR_SIZE = 40;
const HEADER_H = 148;

/** Returns layout constants that depend on how many games are in the list. */
export function getGridDimensions(count: number) {
  const is10Col = count > 50;
  const COLS   = is10Col ? 10 : 5;
  const PAD    = is10Col ? 14 : 22;
  const GAP    = is10Col ? 5  : 10;
  const CELL_W = Math.floor((CANVAS_W - PAD * 2 - (COLS - 1) * GAP) / COLS);
  const COVER_H = Math.round(CELL_W * (4 / 3));
  // 10-col: rank only; 5-col: rank + 2-line title + 2-line notes
  const INFO_H     = is10Col ? 20 : 110;
  const BADGE_SIZE = is10Col ? 22 : 32;
  const BADGE_FONT = is10Col ? 11 : 15;
  const HOURS_FONT = is10Col ? 9  : 12;
  return { is10Col, COLS, PAD, GAP, CELL_W, COVER_H, INFO_H, BADGE_SIZE, BADGE_FONT, HOURS_FONT };
}

export function buildListGridTree(data: ListGridData): { tree: any; height: number } {
  const entries = data.entries.slice(0, 100);
  const dims = getGridDimensions(entries.length);
  const { is10Col, COLS, PAD, GAP, CELL_W, COVER_H, INFO_H, BADGE_SIZE, BADGE_FONT, HOURS_FONT } = dims;

  const rows  = Math.max(1, Math.ceil(entries.length / COLS));
  const gridH = rows * (COVER_H + INFO_H) + (rows - 1) * GAP;
  const canvasH = HEADER_H + gridH + PAD;

  // ── Individual game cells ─────────────────────────────────────────────────
  const cells = entries.map((entry) => {
    const coverLayers: any[] = [];

    // Cover background (pre-cropped server-side to exact cell size)
    coverLayers.push(
      entry.coverDataUri
        ? h("div", {
            style: {
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              backgroundImage: `url(${entry.coverDataUri})`,
              backgroundSize: "100% 100%",
              display: "flex",
            },
          })
        : h("div", {
            style: {
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              background: "#18181b", display: "flex",
            },
          })
    );

    // Top-left: hours badge
    if (entry.hoursPlayed && entry.hoursPlayed > 0) {
      const pad = is10Col ? "3px 5px" : "4px 8px";
      coverLayers.push(
        h("div", {
          style: {
            position: "absolute", top: 6, left: 6,
            background: "rgba(9,9,10,0.72)",
            borderRadius: 5, padding: pad,
            display: "flex", alignItems: "center",
          },
        }, [
          h("div", {
            style: { fontSize: HOURS_FONT, fontWeight: 700, color: "rgba(240,237,232,0.88)", display: "flex" },
          }, `${entry.hoursPlayed}h`),
        ])
      );
    }

    // Bottom-right: score badge — solid fill + colored glow (matching the site's badges)
    if (entry.score !== null) {
      const bg   = scoreBadgeBg(entry.score);
      const text = scoreBadgeText(entry.score);
      const glow = scoreColor(entry.score);
      coverLayers.push(
        h("div", {
          style: {
            position: "absolute", bottom: 6, right: 6,
            background: bg,
            borderRadius: 6,
            width: BADGE_SIZE, height: BADGE_SIZE,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            boxShadow: `0 0 10px ${hexToRgba(glow, 0.65)}, 0 0 4px ${hexToRgba(glow, 0.35)}`,
          },
        }, [
          h("div", {
            style: { fontSize: BADGE_FONT, fontWeight: 700, color: text, display: "flex" },
          }, String(entry.score)),
        ])
      );
    }

    const coverEl = h("div", {
      style: {
        width: CELL_W, height: COVER_H,
        borderRadius: is10Col ? 6 : 8,
        overflow: "hidden",
        position: "relative", display: "flex", flexShrink: 0,
      },
    }, coverLayers);

    // Info below cover
    const infoChildren: any[] = [];

    if (is10Col) {
      // 10-col: rank only, centered, very small
      if (data.isRanked) {
        infoChildren.push(
          h("div", {
            style: {
              fontSize: 10, fontWeight: 700,
              color: "rgba(240,237,232,0.35)",
              display: "flex", justifyContent: "center",
              width: CELL_W, paddingTop: 4,
            },
          }, `#${entry.rank}`)
        );
      }
    } else {
      // 5-col: rank + 2-line title + 2-line review excerpt
      if (data.isRanked) {
        infoChildren.push(
          h("div", {
            style: {
              fontSize: 14, fontWeight: 700,
              color: "rgba(240,237,232,0.4)",
              display: "flex", marginBottom: 4,
            },
          }, `#${entry.rank}`)
        );
      }
      infoChildren.push(
        h("div", {
          style: {
            fontSize: 14, fontWeight: 700, color: "#f0ede8",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.3,
          },
        }, truncate(entry.gameTitle, 45))
      );
      if (entry.notes) {
        infoChildren.push(
          h("div", {
            style: {
              fontSize: 13, fontWeight: 400, color: "rgba(240,237,232,0.5)",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.4,
              marginTop: 5,
            },
          }, truncate(entry.notes, 100))
        );
      }
    }

    const infoArea = h("div", {
      style: {
        width: CELL_W, height: INFO_H,
        display: "flex", flexDirection: "column",
        paddingTop: is10Col ? 0 : 7,
        flexShrink: 0,
      },
    }, infoChildren);

    return h("div", {
      style: { display: "flex", flexDirection: "column", width: CELL_W, flexShrink: 0 },
    }, [coverEl, infoArea]);
  });

  // ── Grid rows ─────────────────────────────────────────────────────────────
  const gridRows = Array.from({ length: rows }, (_, r) =>
    h("div", { style: { display: "flex", gap: GAP, flexShrink: 0 } },
      cells.slice(r * COLS, (r + 1) * COLS))
  );

  // ── Header ────────────────────────────────────────────────────────────────
  // Avatar is pre-cropped server-side to exactly AVATAR_SIZE×AVATAR_SIZE by
  // fetchAndCropCover — no objectFit needed, the image is already the right
  // square dimensions and just needs borderRadius for the circular clip.
  const avatar = data.ownerAvatarDataUri
    ? h("img", {
        src: data.ownerAvatarDataUri,
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE,
          borderRadius: AVATAR_SIZE / 2,
          display: "flex", flexShrink: 0,
        },
      })
    : h("div", {
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
          background: OG_ACCENT, display: "flex", alignItems: "center",
          justifyContent: "center", color: "#fff", fontSize: 15, fontWeight: 700,
          flexShrink: 0,
        },
      }, data.ownerUsername.slice(0, 2).toUpperCase());

  const statParts: any[] = [
    h("div", { style: { fontSize: 14, color: "rgba(240,237,232,0.4)", display: "flex" } },
      `${data.totalGames} game${data.totalGames === 1 ? "" : "s"}`),
  ];
  if (data.isRanked) {
    statParts.push(
      h("div", { style: { fontSize: 14, color: "rgba(255,255,255,0.12)", display: "flex" } }, "·"),
      h("div", { style: { fontSize: 14, fontWeight: 700, color: OG_ACCENT, display: "flex" } }, "Ranked"),
    );
  }
  if (data.avgScore !== null) {
    const sc = scoreColor(data.avgScore);
    statParts.push(
      h("div", { style: { fontSize: 14, color: "rgba(255,255,255,0.12)", display: "flex" } }, "·"),
      h("div", { style: { fontSize: 14, fontWeight: 700, color: sc, display: "flex" } },
        `avg ${data.avgScore.toFixed(1)}`),
    );
  }

  const titleSize = data.title.length > 44 ? 26 : data.title.length > 32 ? 32 : 40;

  const header = h("div", {
    style: {
      height: HEADER_H, display: "flex", flexDirection: "column",
      justifyContent: "center", paddingLeft: PAD, paddingRight: PAD, gap: 10,
    },
  }, [
    h("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, [
      // Branding pill — purple gradient background so it stands out
      h("div", {
        style: {
          display: "flex", alignItems: "center", gap: 7, flexShrink: 0,
          background: "linear-gradient(135deg, rgba(96,80,200,0.55) 0%, rgba(139,123,240,0.35) 100%)",
          border: "1px solid rgba(139,123,240,0.45)",
          borderRadius: 20, padding: "6px 13px 6px 10px",
        },
      }, [
        h("div", { style: { width: 7, height: 7, borderRadius: 4, background: OG_ACCENT, display: "flex", flexShrink: 0 } }),
        h("div", {
          style: { fontSize: 12, fontWeight: 700, letterSpacing: 1.8, color: "#f0ede8", display: "flex" },
        }, "CHEKPOINT.GG"),
      ]),
      // Avatar + username
      avatar,
      h("div", {
        style: { fontSize: 14, fontWeight: 600, color: "rgba(240,237,232,0.6)", display: "flex" },
      }, `@${truncate(data.ownerUsername, 30)}`),
    ]),
    h("div", {
      style: {
        display: "flex", justifyContent: "center", width: CANVAS_W - PAD * 2,
      },
    }, [
      h("div", {
        style: {
          fontSize: titleSize, fontWeight: 700, color: "#f0ede8",
          fontFamily: "DM Serif Display", display: "flex",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        },
      }, truncate(data.title, 55)),
    ]),
    h("div", { style: { display: "flex", alignItems: "center", gap: 7 } }, statParts),
  ]);

  return {
    tree: h("div", {
      style: {
        width: CANVAS_W, height: canvasH,
        backgroundColor: OG_BG,
        display: "flex", flexDirection: "column",
        fontFamily: "DM Sans",
      },
    }, [
      header,
      h("div", {
        style: { display: "flex", flexDirection: "column", gap: GAP, paddingLeft: PAD, paddingRight: PAD },
      }, gridRows),
    ]),
    height: canvasH,
  };
}
