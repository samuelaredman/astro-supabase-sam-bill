import { h, coverGridRows } from "./og";

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

function titleFontSize(title: string): number {
  if (title.length <= 24) return 64;
  if (title.length <= 40) return 52;
  return 42;
}

export interface ListOgData {
  title: string;
  ownerUsername: string;
  ownerAvatarDataUri: string | null;
  entryCountTotal: number;
  isRanked: boolean;
  avgScore: number | null;
  coverDataUris: string[];
}

const WIDTH = 1200;
const HEIGHT = 630;
const ACCENT = "#8b7bf0";
const BG = "#09090a";

export function buildListOgTree(data: ListOgData): any {
  const { rowCounts, shown } = coverGridRows(data.coverDataUris.length);
  const covers = data.coverDataUris.slice(0, shown);
  const cellH = rowCounts.length > 0 ? HEIGHT / rowCounts.length : 0;

  const gridRows: any[] = [];
  let cursor = 0;
  for (const count of rowCounts) {
    const rowCovers = covers.slice(cursor, cursor + count);
    cursor += count;
    const cellW = WIDTH / count;
    gridRows.push(
      h("div", { style: { display: "flex", width: WIDTH, height: cellH, flexShrink: 0 } },
        rowCovers.map((src) =>
          h("div", {
            style: {
              width: cellW,
              height: cellH,
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

  const metaParts: any[] = [];
  if (data.ownerAvatarDataUri) {
    metaParts.push(
      h("div", {
        style: {
          width: 30, height: 30, borderRadius: 15, backgroundImage: `url(${data.ownerAvatarDataUri})`,
          backgroundSize: "cover", backgroundPosition: "center", display: "flex", flexShrink: 0,
        },
      })
    );
  } else {
    metaParts.push(
      h("div", {
        style: {
          width: 30, height: 30, borderRadius: 15, background: ACCENT, display: "flex",
          alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, flexShrink: 0,
        },
      }, data.ownerUsername.slice(0, 2).toUpperCase())
    );
  }
  metaParts.push(h("div", { style: { fontSize: 21, fontWeight: 700, color: "#f0ede8" } }, `@${data.ownerUsername}`));
  metaParts.push(h("div", { style: { fontSize: 21, color: "#6a6866", display: "flex" } }, "·"));
  metaParts.push(h("div", { style: { fontSize: 21, color: "#c9c6c0", display: "flex" } },
    `${data.entryCountTotal} game${data.entryCountTotal === 1 ? "" : "s"}`));
  if (data.isRanked) {
    metaParts.push(h("div", { style: { fontSize: 21, color: "#6a6866", display: "flex" } }, "·"));
    metaParts.push(h("div", { style: { fontSize: 21, color: ACCENT, fontWeight: 700, display: "flex" } }, "Ranked"));
  }
  if (data.avgScore !== null) {
    metaParts.push(h("div", { style: { fontSize: 21, color: "#6a6866", display: "flex" } }, "·"));
    metaParts.push(h("div", { style: { fontSize: 21, color: "#c9c6c0", display: "flex" } }, `avg ${data.avgScore.toFixed(1)}`));
  }

  const children: any[] = [];

  if (shown > 0) {
    children.push(
      h("div", { style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column" } }, gridRows),
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, bottom: 0, height: 400, display: "flex",
          backgroundImage: `linear-gradient(to top, rgba(9,9,10,0.99) 0%, rgba(9,9,10,0.88) 38%, rgba(9,9,10,0) 100%)`,
        },
      })
    );
  } else {
    // Empty list — no covers to show. Solid brand background with a soft accent glow.
    children.push(
      h("div", {
        style: {
          position: "absolute", top: -160, right: -120, width: 560, height: 560, borderRadius: 280,
          backgroundImage: `radial-gradient(circle, rgba(139,123,240,0.22) 0%, rgba(139,123,240,0) 70%)`,
          display: "flex",
        },
      })
    );
  }

  children.push(
    h("div", {
      style: {
        position: "absolute", top: 32, right: 40, display: "flex", alignItems: "center", gap: 9,
      },
    }, [
      h("div", { style: { width: 9, height: 9, borderRadius: 5, background: ACCENT, display: "flex" } }),
      h("div", {
        style: {
          fontSize: 21, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.92)",
          textShadow: "0 2px 10px rgba(0,0,0,0.8)",
        },
      }, "CHEKPOINT"),
    ])
  );

  children.push(
    h("div", {
      style: {
        position: "absolute", left: 56, right: 56, bottom: 44, display: "flex", flexDirection: "column", gap: 14,
      },
    }, [
      h("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, [
        h("div", { style: { width: 7, height: 7, borderRadius: 4, background: ACCENT, display: "flex" } }),
        h("div", { style: { fontSize: 16, fontWeight: 700, letterSpacing: 2, color: ACCENT, textTransform: "uppercase", display: "flex" } }, "List"),
      ]),
      h("div", {
        style: {
          fontFamily: "DM Serif Display", fontSize: titleFontSize(data.title), color: "#f8f6f2",
          lineHeight: 1.08, display: "flex", maxWidth: WIDTH - 112,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          textShadow: "0 2px 16px rgba(0,0,0,0.6)",
        },
      }, truncate(data.title, 60)),
      h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, metaParts),
    ])
  );

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, children);
}
