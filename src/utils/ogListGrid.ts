import { h, OG_ACCENT, OG_BG, scoreColor, hexToRgba, truncate } from "./og";

export interface ListGridEntry {
  /** Pre-cropped to exactly CELL_W × COVER_H by the endpoint. */
  coverDataUri: string | null;
  rank: number;
  gameTitle: string;
  score: number | null;
  hoursPlayed: number | null;
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
export const COLS = 5;
const PAD = 22;
const GAP = 10;
const HEADER_H = 148;
const FOOTER_H = 36;
// Info area below each cover: rank + title (+ optional hours)
const INFO_H = 68;

export const CELL_W = Math.floor((CANVAS_W - PAD * 2 - (COLS - 1) * GAP) / COLS); // 200px
export const COVER_H = Math.round(CELL_W * (4 / 3)); // 267px — standard game cover

export function buildListGridTree(data: ListGridData): { tree: any; height: number } {
  const entries = data.entries.slice(0, 20);
  const rows = Math.max(1, Math.ceil(entries.length / COLS));
  const cellH = COVER_H + GAP / 2 + INFO_H;
  const gridH = rows * cellH + (rows - 1) * GAP;
  const canvasH = HEADER_H + gridH + FOOTER_H;

  // ── Individual game cells ─────────────────────────────────────────────────
  const cells = entries.map((entry) => {
    const sc = entry.score !== null ? scoreColor(entry.score) : null;

    // Cover art
    const cover = entry.coverDataUri
      ? h("div", {
          style: {
            width: CELL_W,
            height: COVER_H,
            borderRadius: 8,
            backgroundImage: `url(${entry.coverDataUri})`,
            backgroundSize: "100% 100%", // image is pre-cropped to exact size
            display: "flex",
            flexShrink: 0,
          },
        })
      : h("div", {
          style: {
            width: CELL_W,
            height: COVER_H,
            borderRadius: 8,
            background: "#18181b",
            display: "flex",
            flexShrink: 0,
          },
        });

    // Info row: rank (left) + score badge (right)
    const infoTopChildren: any[] = [];

    if (data.isRanked) {
      infoTopChildren.push(
        h("div", {
          style: {
            fontSize: 13,
            fontWeight: 700,
            color: "rgba(240,237,232,0.45)",
            display: "flex",
            letterSpacing: 0.3,
          },
        }, `#${entry.rank}`)
      );
    }

    // Spacer pushes score to the right
    infoTopChildren.push(h("div", { style: { flex: 1, display: "flex" } }));

    if (sc !== null && entry.score !== null) {
      infoTopChildren.push(
        h("div", {
          style: {
            display: "flex",
            alignItems: "center",
            gap: 4,
            background: hexToRgba(sc, 0.12),
            border: `1px solid ${hexToRgba(sc, 0.35)}`,
            borderRadius: 6,
            padding: "2px 7px",
          },
        }, [
          h("div", { style: { width: 5, height: 5, borderRadius: 3, background: sc, display: "flex", flexShrink: 0 } }),
          h("div", { style: { fontSize: 12, fontWeight: 700, color: sc, display: "flex" } }, String(entry.score)),
        ])
      );
    }

    // Game title (up to 2 lines)
    const titleEl = h("div", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: "#e8e5e0",
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 2,
        overflow: "hidden",
        textOverflow: "ellipsis",
        lineHeight: 1.35,
        marginTop: 4,
      },
    }, truncate(entry.gameTitle, 45));

    // Hours (very subtle, only if available)
    const hoursEl = entry.hoursPlayed && entry.hoursPlayed > 0
      ? h("div", {
          style: {
            fontSize: 10,
            fontWeight: 500,
            color: "rgba(240,237,232,0.3)",
            display: "flex",
            marginTop: 3,
          },
        }, `${entry.hoursPlayed}h`)
      : null;

    const infoArea = h("div", {
      style: {
        width: CELL_W,
        display: "flex",
        flexDirection: "column",
        paddingTop: 7,
        flexShrink: 0,
      },
    }, [
      h("div", { style: { display: "flex", alignItems: "center", width: CELL_W } }, infoTopChildren),
      titleEl,
      ...(hoursEl ? [hoursEl] : []),
    ]);

    return h("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        width: CELL_W,
        flexShrink: 0,
      },
    }, [cover, infoArea]);
  });

  // ── Grid rows ─────────────────────────────────────────────────────────────
  const gridRows = Array.from({ length: rows }, (_, r) =>
    h("div", { style: { display: "flex", gap: GAP, flexShrink: 0 } },
      cells.slice(r * COLS, (r + 1) * COLS))
  );

  // ── Header ────────────────────────────────────────────────────────────────
  const AVATAR_SIZE = 40;
  const avatar = data.ownerAvatarDataUri
    ? h("div", {
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE,
          borderRadius: AVATAR_SIZE / 2,
          backgroundImage: `url(${data.ownerAvatarDataUri})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          display: "flex", flexShrink: 0,
        },
      })
    : h("div", {
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2,
          background: OG_ACCENT, display: "flex", alignItems: "center",
          justifyContent: "center", color: "#fff", fontSize: 15, fontWeight: 700, flexShrink: 0,
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
    // Branding + owner row
    h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, [
      h("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, [
        h("div", { style: { width: 7, height: 7, borderRadius: 4, background: OG_ACCENT, display: "flex" } }),
        h("div", {
          style: {
            fontSize: 11, fontWeight: 700, letterSpacing: 2.2,
            color: "rgba(240,237,232,0.25)", display: "flex",
          },
        }, "CHEKPOINT"),
      ]),
      h("div", { style: { width: 1, height: 13, background: "rgba(255,255,255,0.08)", display: "flex" } }),
      avatar,
      h("div", {
        style: { fontSize: 14, fontWeight: 600, color: "rgba(240,237,232,0.55)", display: "flex" },
      }, `@${truncate(data.ownerUsername, 30)}`),
    ]),
    // List title
    h("div", {
      style: {
        fontSize: titleSize, fontWeight: 700, color: "#f0ede8",
        fontFamily: "DM Serif Display", display: "flex",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        maxWidth: CANVAS_W - PAD * 2,
      },
    }, truncate(data.title, 55)),
    // Stats
    h("div", { style: { display: "flex", alignItems: "center", gap: 7 } }, statParts),
  ]);

  const footer = h("div", {
    style: {
      height: FOOTER_H, display: "flex", alignItems: "center",
      paddingLeft: PAD, paddingRight: PAD,
      borderTop: "1px solid rgba(255,255,255,0.04)",
      marginTop: 4,
    },
  }, [
    h("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, [
      h("div", { style: { width: 5, height: 5, borderRadius: 3, background: OG_ACCENT, display: "flex" } }),
      h("div", { style: { fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: "rgba(240,237,232,0.2)", display: "flex" } }, "CHEKPOINT.GG"),
    ]),
  ]);

  const tree = h("div", {
    style: {
      width: CANVAS_W, height: canvasH,
      backgroundColor: OG_BG,
      display: "flex", flexDirection: "column",
      fontFamily: "DM Sans",
    },
  }, [
    header,
    h("div", {
      style: {
        display: "flex", flexDirection: "column", gap: GAP,
        paddingLeft: PAD, paddingRight: PAD,
      },
    }, gridRows),
    footer,
  ]);

  return { tree, height: canvasH };
}
