import {
  h, coverGridRows, truncate, scoreColor, hexToRgba, OG_ACCENT, OG_BG,
} from "./og";

export interface GroupOgData {
  name: string;
  avatarDataUri: string | null;
  memberCount: number;
  totalReviews: number;
  avgScore: number | null;
  coverDataUris: string[];
}

const WIDTH = 1200;
const HEIGHT = 630;
const ACCENT = OG_ACCENT;
const BG = OG_BG;
const GRID_GAP = 5;

// The group name is this card's headline (there's no separate "owner" the way
// a list has a title *and* an owner username) — sized more like the review
// card's game title than the list card's secondary title-next-to-avatar.
function groupNameFontSize(name: string): number {
  const len = name.length;
  if (len <= 16) return 64;
  if (len <= 28) return 52;
  if (len <= 42) return 42;
  return 36;
}

export function buildGroupOgTree(data: GroupOgData): any {
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

  // Caption line: member count · review count · avg score chip — mirrors the
  // list card's "N games · Ranked · avg score" caption above the main row.
  const captionParts: any[] = [
    h("div", { style: { fontSize: 19, color: "#c9c6c0", display: "flex" } },
      `${data.memberCount} member${data.memberCount === 1 ? "" : "s"}`),
  ];
  if (data.totalReviews > 0) {
    captionParts.push(h("div", { style: { fontSize: 19, color: "#6a6866", display: "flex" } }, "·"));
    captionParts.push(h("div", { style: { fontSize: 19, color: "#c9c6c0", display: "flex" } },
      `${data.totalReviews} review${data.totalReviews === 1 ? "" : "s"}`));
  }
  if (data.avgScore !== null) {
    const c = scoreColor(data.avgScore);
    captionParts.push(h("div", { style: { fontSize: 19, color: "#6a6866", display: "flex" } }, "·"));
    captionParts.push(
      h("div", {
        style: {
          display: "flex", alignItems: "center", gap: 6, fontSize: 17, fontWeight: 700, color: c,
          background: hexToRgba(c, 0.14), border: `1px solid ${hexToRgba(c, 0.4)}`,
          borderRadius: 8, padding: "3px 11px",
        },
      }, [
        h("div", { style: { width: 6, height: 6, borderRadius: 3, background: c, display: "flex" } }),
        h("div", { style: { display: "flex" } }, `${data.avgScore.toFixed(1)} avg`),
      ])
    );
  }

  const AVATAR_SIZE = 96;
  const avatar = data.avatarDataUri
    ? h("img", {
        src: data.avatarDataUri,
        style: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: 20, objectFit: "cover", display: "flex", flexShrink: 0 },
      })
    : h("div", {
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: 20, background: ACCENT, display: "flex",
          alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 36, fontWeight: 700, flexShrink: 0,
        },
      }, data.name.slice(0, 2).toUpperCase());

  const nameBlock = h("div", {
    style: {
      fontFamily: "DM Serif Display", fontSize: groupNameFontSize(data.name), color: "#f8f6f2",
      lineHeight: 1.15, minWidth: 0, flex: 1,
      display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
      overflow: "hidden", textOverflow: "ellipsis",
      textShadow: "0 2px 16px rgba(0,0,0,0.6)",
    },
  }, truncate(data.name, 90));

  const mainRow = h("div", { style: { display: "flex", alignItems: "center", gap: 20 } }, [avatar, nameBlock]);

  const children: any[] = [];

  if (shown > 0) {
    children.push(
      h("div", { style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", gap: GRID_GAP } }, gridRows),
      // Thin top vignette so the wordmark stays legible over bright cover art.
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, top: 0, height: 130, display: "flex",
          backgroundImage: `linear-gradient(to bottom, rgba(9,9,10,0.55) 0%, rgba(9,9,10,0) 100%)`,
        },
      }),
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, bottom: 0, height: 320, display: "flex",
          backgroundImage: `linear-gradient(to top, rgba(9,9,10,0.96) 0%, rgba(9,9,10,0.75) 32%, rgba(9,9,10,0.28) 62%, rgba(9,9,10,0) 100%)`,
        },
      })
    );
  } else {
    // No member reviews yet — solid brand background with a soft accent glow,
    // same convention as an empty list card.
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

  // "GROUP" tag mirrors the list card's corner tag — identifies the card type
  // at a glance without needing to read the caption line.
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
      }, "Group"),
    ])
  );

  children.push(
    h("div", {
      style: {
        position: "absolute", top: 24, right: 32, display: "flex", alignItems: "center", gap: 9,
        background: "rgba(9,9,10,0.45)", borderRadius: 20, padding: "8px 16px 8px 14px",
      },
    }, [
      h("div", { style: { width: 9, height: 9, borderRadius: 5, background: ACCENT, display: "flex" } }),
      h("div", {
        style: { fontSize: 21, fontWeight: 700, letterSpacing: 3, color: "rgba(240,237,232,0.95)" },
      }, "CHEKPOINT"),
    ])
  );

  children.push(
    h("div", {
      style: {
        position: "absolute", left: 56, right: 56, bottom: 44, display: "flex",
        flexDirection: "column", gap: 12,
      },
    }, [
      h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, captionParts),
      mainRow,
    ])
  );

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, children);
}
