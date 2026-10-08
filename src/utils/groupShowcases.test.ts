import { describe, expect, it } from "vitest";
import {
  DEFAULT_HIDDEN_SHOWCASES,
  GROUP_SHOWCASE_SECTIONS,
  readGroupShowcaseHidden,
  readGroupShowcaseKeys,
  readGroupShowcaseOrder,
  showcaseColumn,
} from "./groupShowcases";

describe("readGroupShowcaseKeys", () => {
  it("keeps known keys, deduped", () => {
    expect(readGroupShowcaseKeys(["video", "polls", "video"])).toEqual(["video", "polls"]);
    expect(readGroupShowcaseKeys([])).toEqual([]);
  });

  it("refuses anything that isn't a list of known keys", () => {
    expect(readGroupShowcaseKeys(["video", "nope"])).toBeNull();
    expect(readGroupShowcaseKeys("video")).toBeNull();
    expect(readGroupShowcaseKeys([1])).toBeNull();
    expect(readGroupShowcaseKeys(null)).toBeNull();
  });
});

describe("readGroupShowcaseOrder", () => {
  it("is the default order when nothing's saved", () => {
    expect(readGroupShowcaseOrder([])).toEqual(GROUP_SHOWCASE_SECTIONS.map((s) => s.key));
    expect(readGroupShowcaseOrder(null)).toEqual(GROUP_SHOWCASE_SECTIONS.map((s) => s.key));
  });

  it("puts the saved keys first and the rest after, in the default order", () => {
    const order = readGroupShowcaseOrder(["polls", "video", "bogus", "video"]);
    expect(order.slice(0, 2)).toEqual(["polls", "video"]);
    expect(order).toHaveLength(GROUP_SHOWCASE_SECTIONS.length);
    expect(order[2]).toBe("now_featuring");
  });
});

describe("showcaseColumn", () => {
  it("splits the order into the main column and the sidebar, keeping each one's order", () => {
    const order = readGroupShowcaseOrder(["want_to_play", "video", "recent_reviews"]);
    expect(showcaseColumn(order, "side")).toEqual(["want_to_play", "recent_reviews", "polls"]);
    expect(showcaseColumn(order, "main")[0]).toBe("video");
    expect(showcaseColumn(order, "main")).not.toContain("polls");
  });
});

describe("readGroupShowcaseHidden", () => {
  it("uses what the group saved, even when that's nothing", () => {
    expect([...readGroupShowcaseHidden(["polls"], {})]).toEqual(["polls"]);
    expect(readGroupShowcaseHidden([], { show_polls: false }).size).toBe(0);
  });

  it("before it customizes, hides the defaults and whatever its old settings switched off", () => {
    const hidden = readGroupShowcaseHidden(null, { show_polls: false, show_top_games: true });
    for (const k of DEFAULT_HIDDEN_SHOWCASES) expect(hidden.has(k)).toBe(true);
    expect(hidden.has("polls")).toBe(true);
    expect(hidden.has("top_games")).toBe(false);
    expect(hidden.has("video")).toBe(false);
  });

  it("maps each old switch to its section", () => {
    expect(readGroupShowcaseHidden(null, { show_watchlist: false }).has("want_to_play")).toBe(true);
    expect(readGroupShowcaseHidden(null, { show_recent_reviews: false }).has("recent_reviews")).toBe(true);
    expect(readGroupShowcaseHidden(null, {}).has("want_to_play")).toBe(false);
  });
});
