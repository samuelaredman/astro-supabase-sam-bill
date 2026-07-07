import {
  h, coverGridRows, truncate, scoreColor, hexToRgba, OG_ACCENT, OG_BG,
  BOTTOM_TITLE_WRAP_THRESHOLD, bottomTitleFontSize, bottomTitleFontSizeShort,
} from "./og";

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
const ACCENT = OG_ACCENT;
const BG = OG_BG;

const GRID_GAP = 5;

export function buildListOgTree(data: ListOgData): any {
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

  // Small caption line above the main avatar/username/title row — game count,
  // Ranked, and avg score still show up, just demoted to a caption now that
  // the row below carries the avatar+username+title (matching the review card).
  const captionParts: any[] = [];
  captionParts.push(h("div", { style: { fontSize: 19, color: "#c9c6c0", display: "flex" } },
    `${data.entryCountTotal} game${data.entryCountTotal === 1 ? "" : "s"}`));
  if (data.isRanked) {
    captionParts.push(h("div", { style: { fontSize: 19, color: "#6a6866", display: "flex" } }, "·"));
    captionParts.push(h("div", { style: { fontSize: 19, color: ACCENT, fontWeight: 700, display: "flex" } }, "Ranked"));
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
        h("div", { style: { display: "flex" } }, data.avgScore.toFixed(1)),
      ])
    );
  }

  // Avatar + username + divider + list title — same sizes/alignment as the
  // review OG card's bottom row, so the two card types read as one family.
  const AVATAR_SIZE = 84;
  const avatar = data.ownerAvatarDataUri
    ? h("img", {
        src: data.ownerAvatarDataUri,
        style: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, objectFit: "cover", display: "flex", flexShrink: 0 },
      })
    : h("div", {
        style: {
          width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2, background: ACCENT, display: "flex",
          alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 30, fontWeight: 700, flexShrink: 0,
        },
      }, data.ownerUsername.slice(0, 2).toUpperCase());

  const isLongListTitle = data.title.length > BOTTOM_TITLE_WRAP_THRESHOLD;

  const mainRowChildren: any[] = [
    avatar,
    h("div", {
      style: {
        fontSize: 42, fontWeight: 700, color: "#f0ede8", display: "flex", flexShrink: 0,
        maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      },
    }, `@${truncate(data.ownerUsername, 24)}`),
    h("div", { style: { width: 1, height: isLongListTitle ? 78 : 52, background: "rgba(255,255,255,0.18)", display: "flex", flexShrink: 0 } }),
    isLongListTitle
      ? h("div", {
          style: {
            fontFamily: "DM Serif Display", fontSize: bottomTitleFontSize(data.title), color: "#f8f6f2",
            lineHeight: 1.22, minWidth: 0, flex: 1,
            display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2,
            overflow: "hidden", textOverflow: "ellipsis",
            textShadow: "0 2px 16px rgba(0,0,0,0.6)",
          },
        }, truncate(data.title, 120))
      : h("div", {
          style: {
            fontFamily: "DM Serif Display", fontSize: bottomTitleFontSizeShort(data.title), color: "#f8f6f2",
            lineHeight: 1.08, display: "flex", minWidth: 0, flex: 1,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            textShadow: "0 2px 16px rgba(0,0,0,0.6)",
          },
        }, truncate(data.title, 60)),
  ];

  const children: any[] = [];

  if (shown > 0) {
    children.push(
      h("div", { style: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", gap: GRID_GAP } }, gridRows),
      // Thin top vignette so the wordmark stays legible over bright cover art
      // without darkening much of the actual artwork.
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, top: 0, height: 130, display: "flex",
          backgroundImage: `linear-gradient(to bottom, rgba(9,9,10,0.55) 0%, rgba(9,9,10,0) 100%)`,
        },
      }),
      // Bottom fade, tightened to the text block itself rather than half the
      // canvas — keeps the cover art the dominant, visible part of the image.
      h("div", {
        style: {
          position: "absolute", left: 0, right: 0, bottom: 0, height: isLongListTitle ? 360 : 320, display: "flex",
          backgroundImage: `linear-gradient(to top, rgba(9,9,10,0.96) 0%, rgba(9,9,10,0.75) 32%, rgba(9,9,10,0.28) 62%, rgba(9,9,10,0) 100%)`,
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

  // Small "LIST" tag mirrors the CHEKPOINT wordmark's chip style, on the
  // opposite corner — the bottom row no longer has its own "List" label
  // (that space is now the avatar/username/title row), so this is what
  // identifies the card as a list rather than a review at a glance.
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
      }, "List"),
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
        position: "absolute", left: 56, right: 56, bottom: isLongListTitle ? 40 : 44, display: "flex",
        flexDirection: "column", gap: 10,
      },
    }, [
      h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, captionParts),
      h("div", {
        style: { display: "flex", alignItems: isLongListTitle ? "center" : "baseline", gap: 18 },
      }, mainRowChildren),
    ])
  );

  return h("div", {
    style: {
      width: WIDTH, height: HEIGHT, display: "flex", position: "relative", overflow: "hidden",
      backgroundColor: BG, fontFamily: "DM Sans",
    },
  }, children);
}
