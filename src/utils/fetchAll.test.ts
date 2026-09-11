import { describe, expect, it } from "vitest";
import { fetchAll } from "./fetchAll";

// A fake ranged query over `rows`, recording the ranges it was asked for.
function source(rows: number[], failAt?: number) {
  const calls: [number, number][] = [];
  const build = async (from: number, to: number) => {
    calls.push([from, to]);
    if (failAt !== undefined && from >= failAt) return { data: null, error: new Error("boom") };
    return { data: rows.slice(from, to + 1), error: null };
  };
  return { build, calls };
}

describe("fetchAll", () => {
  it("returns everything past the page size, in order", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const { build, calls } = source(rows);
    expect(await fetchAll(build)).toEqual(rows);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("stops after a single short page", async () => {
    const { build, calls } = source([1, 2, 3]);
    expect(await fetchAll(build)).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(1);
  });

  it("makes one extra request when the total is an exact multiple of the page size", async () => {
    const { build, calls } = source(Array.from({ length: 4 }, (_, i) => i));
    expect(await fetchAll(build, 2)).toEqual([0, 1, 2, 3]);
    expect(calls).toHaveLength(3);
  });

  it("keeps what it has when a later page fails", async () => {
    const { build } = source(Array.from({ length: 5 }, (_, i) => i), 2);
    expect(await fetchAll(build, 2)).toEqual([0, 1]);
  });
});
