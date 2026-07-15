import { h, OG_ACCENT, OG_BG, truncate } from "./og";

export interface ListGridEntry {
  coverDataUri: string | null;
  rank: number;
}

export interface ListGridData {
  title: string;
  isRanked: boolean;
  entries: ListGridEntry[];
}

const CANVAS_W = 1000;
const COLS = 5;
const PAD_X = 20;
const GAP = 10;
const HEADER_H = 130;
const FOOTER_PAD = 24;

// Video game covers are 3:4 portrait — compute cell dimensions from column width.
const CELL_W = Math.floor((CANVAS_W - PAD_X * 2 - (COLS - 1) * GAP) / COLS); // 184
const COVER_H = Math.round(CELL_W * (4 / 3)); // 245

/**
 * Builds the Satori element tree for the shareable grid image.
 * Returns both the tree and the canvas height (dynamic based on row count).
 */
export function buildListGridTree(data: ListGridData): { tree: any; height: number } {
  const RANK_H = data.isRanked ? 38 : 0;
  const CELL_H = COVER_H + RANK_H;

  const entries = data.entries.slice(0, 20);
  const rows = Math.max(1, Math.ceil(entries.length / COLS));
  const gridH = rows * CELL_H + (rows - 1) * GAP;
  const canvasH = Math.max(600, HEADER_H + gridH + FOOTER_PAD);

  const cells = entries.map((entry) => {
    const cover = entry.coverDataUri
      ? h("div", {
          style: {
            width: CELL_W,
            height: COVER_H,
            borderRadius: 8,
            backgroundImage: `url(${entry.coverDataUri})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            flexShrink: 0,
            display: "flex",
          },
        })
      : h("div", {
          style: {
            width: CELL_W,
            height: COVER_H,
            borderRadius: 8,
            background: "#1e1e20",
            display: "flex",
            flexShrink: 0,
          },
        });

    const rankLabel = data.isRanked
      ? h("div", {
          style: {
            height: RANK_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            fontWeight: 700,
            color: "rgba(240,237,232,0.55)",
            letterSpacing: 0.3,
            fontFamily: "DM Sans",
          },
        }, String(entry.rank))
      : null;

    return h("div", {
      style: { display: "flex", flexDirection: "column", width: CELL_W, flexShrink: 0 },
    }, rankLabel ? [cover, rankLabel] : [cover]);
  });

  const gridRows: any[] = [];
  for (let r = 0; r < rows; r++) {
    const rowCells = cells.slice(r * COLS, (r + 1) * COLS);
    gridRows.push(
      h("div", { style: { display: "flex", gap: GAP, flexShrink: 0 } }, rowCells)
    );
  }

  const titleFontSize = data.title.length > 36 ? 28 : data.title.length > 24 ? 34 : 42;

  const tree = h("div", {
    style: {
      width: CANVAS_W,
      height: canvasH,
      backgroundColor: OG_BG,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      fontFamily: "DM Sans",
    },
  }, [
    // Header: branding + title
    h("div", {
      style: {
        height: HEADER_H,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        width: CANVAS_W,
        paddingLeft: PAD_X,
        paddingRight: PAD_X,
      },
    }, [
      // Branding row
      h("div", {
        style: { display: "flex", alignItems: "center", gap: 7 },
      }, [
        h("div", {
          style: { width: 7, height: 7, borderRadius: 4, background: OG_ACCENT, display: "flex" },
        }),
        h("div", {
          style: {
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 2.5,
            color: "rgba(240,237,232,0.35)",
            textTransform: "uppercase",
            display: "flex",
          },
        }, "CHEKPOINT.GG"),
      ]),
      // List title
      h("div", {
        style: {
          fontSize: titleFontSize,
          fontWeight: 700,
          color: "#f0ede8",
          display: "flex",
          textAlign: "center",
          maxWidth: CANVAS_W - PAD_X * 2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        },
      }, truncate(data.title, 55)),
    ]),
    // Grid
    h("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: GAP,
        paddingLeft: PAD_X,
        paddingRight: PAD_X,
      },
    }, gridRows),
  ]);

  return { tree, height: canvasH };
}
