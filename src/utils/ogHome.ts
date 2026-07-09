import { h, coverGridRows, hexToRgba, OG_ACCENT, OG_BG } from "./og";

export interface HomeOgData {
  reviewCount: number;
  gameCount: number;
  profileCount: number;
  coverDataUris: string[];
}

const WIDTH = 1200;
const HEIGHT = 630;
const ACCENT = OG_ACCENT;
const BG = OG_BG;
const GRID_GAP = 5;

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function buildHomeOgTree(data: HomeOgData): any {
  const { rowCounts, shown } = coverGridRows(data.coverDataUris.length);
  const covers = data.coverDataUris.slice(0, shown);
  const cellH = rowCounts.length > 0 ? (HEIGHT - (rowCounts.length - 1) * GRID_GAP) / rowCounts.length : 0;

  const gridRows: any[] = [];
  let cursor = 0;
  for (const count of rowCounts) {
    const rowCovers = covers.slice(cursor, cursor + count);
    cursor += count;
    const cellW = (WIDTH - (count - 1) * GRID_GAP) / count;
    gridRows.push(
      h("div", { style: { display: "flex", width: WIDTH, height: cellH, flexShrink: 0, gap: GRID_GAP } },
        rowCovers.map((src) =>
          h("div", {
            style: {
              width: cellW,
              height: cellH,
              borderRadius: 10,
              backgroundImage: `url(${src})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              flexShrink: 0,
              display: "flex",
            },
          })
        )
      )
    );
  }

  const children: any[] = [];

  if (shown > 0) {
    children.push(
      h("div", { style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", gap: GRID_GAP } }, gridRows),
      // Thin top vignette so the corner tags stay legible over bright cover art.
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, top: 0, height: 120, display: "flex",
          backgroundImage: `linear-gradient(to bottom, rgba(9,9,10,0.6) 0%, rgba(9,9,10,0) 100%)`,
        },
      }),
      // Deep bottom fade for the wordmark/tagline/stats block.
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, bottom: 0, height: 400, display: "flex",
          backgroundImage: `linear-gradient(to top, rgba(9,9,10,0.97) 0%, rgba(9,9,10,0.88) 40%, rgba(9,9,10,0.4) 74%, rgba(9,9,10,0) 100%)`,
        },
      })
    );
  } else {
    // No recent covers to show (e.g. a brand-new instance with zero reviews)
    // — solid brand background with a soft accent glow, same fallback
    // convention as the empty-list/no-banner-profile OG cards.
    children.push(
      h("div", {
        style: {
          position: "absolute", top: -160, right: -120, width: 640, height: 640, borderRadius: 320,
          backgroundImage: `radial-gradient(circle, ${hexToRgba(ACCENT, 0.24)} 0%, ${hexToRgba(ACCENT, 0)} 70%)`,
          display: "flex",
        },
      }),
      h("div", {
        style: {
          position: "absolute", bottom: -200, left: -140, width: 560, height: 560, borderRadius: 280,
          backgroundImage: `radial-gradient(circle, ${hexToRgba(ACCENT, 0.14)} 0%, ${hexToRgba(ACCENT, 0)} 70%)`,
          display: "flex",
        },
      })
    );
  }

  children.push(
    h("div", {
      style: {
        position: "absolute", top: 24, left: 32, display: "flex", alignItems: "center", gap: 9,
        background: "rgba(9,9,10,0.45)", borderRadius: 20, padding: "8px 16px 8px 14px",
      },
    }, [
      h("div", { style: { width: 9, height: 9, borderRadius: 5, background: ACCENT, display: "flex" } }),
      h("div", {
        style: { fontSize: 16, fontWeight: 700, letterSpacing: 2, color: "rgba(240,237,232,0.95)", textTransform: "uppercase" },
      }, "Game Reviews"),
    ])
  );

  const tiles: { value: string; label: string }[] = [
    { value: formatCount(data.reviewCount), label: data.reviewCount === 1 ? "review" : "reviews" },
    { value: formatCount(data.gameCount), label: data.gameCount === 1 ? "game" : "games" },
    { value: formatCount(data.profileCount), label: data.profileCount === 1 ? "reviewer" : "reviewers" },
  ];

  const statRowChildren: any[] = [];
  tiles.forEach((tile, i) => {
    if (i > 0) {
      statRowChildren.push(
        h("div", { style: { width: 1, height: 76, background: "rgba(255,255,255,0.18)", display: "flex", flexShrink: 0 } })
      );
    }
    statRowChildren.push(
      h("div", { style: { display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 } }, [
        h("div", {
          style: { fontSize: 64, fontWeight: 700, color: "#f8f6f2", display: "flex", lineHeight: 1, textShadow: "0 2px 16px rgba(0,0,0,0.6)" },
        }, tile.value),
        h("div", {
          style: { fontSize: 20, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "#b3b0aa", display: "flex" },
        }, tile.label),
      ])
    );
  });

  children.push(
    h("div", {
      style: {
        position: "absolute", left: 56, right: 56, bottom: 44, display: "flex",
        flexDirection: "column", gap: 36,
      },
    }, [
      // Same arcade wordmark (font + accent dot) as the site's own nav logo
      // (.logo in shared.css) — no tagline, the covers behind it already say
      // "game reviews".
      h("div", { style: { display: "flex", alignItems: "center", gap: 20 } }, [
        h("div", { style: { width: 14, height: 14, borderRadius: 7, background: ACCENT, boxShadow: `0 0 20px ${ACCENT}`, display: "flex", flexShrink: 0 } }),
        h("div", {
          style: {
            fontFamily: "Press Start 2P", fontSize: 52, color: "#f8f6f2", lineHeight: 1,
            display: "flex", textShadow: "0 2px 20px rgba(0,0,0,0.6)",
          },
        }, "Chekpoint"),
      ]),
      h("div", { style: { display: "flex", alignItems: "center", gap: 32 } }, statRowChildren),
    ])
  );

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, children);
}
