import { describe, it, expect } from "vitest";
import { findStudioDuplicates, strictStudioKey, looseStudioKey } from "./studioDuplicates";

const s = (id: string, name: string) => ({ id, name });
const pairs = (rows: { id: string; name: string }[]) =>
  findStudioDuplicates(rows).map((g) => [g.confidence, g.studios.map((x) => x.name).sort().join(" | ")]);

describe("studio name keys", () => {
  it("ignores case, punctuation, spacing, accents and legal suffixes", () => {
    expect(strictStudioKey("h.a.n.d., Inc.")).toBe(strictStudioKey("h.a.n.d. Inc."));
    expect(strictStudioKey("D’Avekki Studios")).toBe(strictStudioKey("D'Avekki Studios"));
    expect(strictStudioKey("Blue Sky Software")).toBe(strictStudioKey("BlueSky Software"));
    expect(strictStudioKey("astragon Entertainment GmbH")).toBe(strictStudioKey("astragon Entertainment"));
    expect(strictStudioKey("Pokémon")).toBe("pokemon");
  });

  it("loose key also drops generic words", () => {
    expect(looseStudioKey("Climax Studios")).toBe(looseStudioKey("Climax Group"));
    expect(strictStudioKey("Climax Studios")).not.toBe(strictStudioKey("Climax Group"));
  });
});

describe("findStudioDuplicates", () => {
  it("rates matches by how much of the name was ignored", () => {
    expect(pairs([s("1", "LucasArts"), s("2", "Lucas Arts")])).toEqual([["high", "Lucas Arts | LucasArts"]]);
    expect(pairs([s("1", "Climax Studios"), s("2", "Climax Group")])).toEqual([["medium", "Climax Group | Climax Studios"]]);
    expect(pairs([s("1", "Level Infinite"), s("2", "Level Infinity")])).toEqual([["low", "Level Infinite | Level Infinity"]]);
  });

  it("never matches names that differ by a number", () => {
    expect(pairs([s("1", "Square Enix Business Division 6"), s("2", "Square Enix Business Division 9")])).toEqual([]);
    expect(pairs([s("1", "Nintendo R&D2"), s("2", "Nintendo R&D4")])).toEqual([]);
    expect(pairs([s("1", "Square Enix Creative Business Unit I"), s("2", "Square Enix Creative Business Unit II")])).toEqual([]);
  });

  it("does not treat a regional arm as a duplicate", () => {
    expect(pairs([s("1", "Electronic Arts"), s("2", "Electronic Arts UK")])).toEqual([]);
    expect(pairs([s("1", "Sony Computer Entertainment"), s("2", "Sony Computer Entertainment Europe")])).toEqual([]);
  });

  it("treats dotted legal suffixes like plain ones", () => {
    expect(pairs([s("1", "City Interactive"), s("2", "City Interactive S.A.")])).toEqual([
      ["high", "City Interactive | City Interactive S.A."],
    ]);
  });

  it("ignores names with no Latin letters rather than grouping them all together", () => {
    expect(pairs([s("1", "Новый Диск"), s("2", "墨鱼玩游戏")])).toEqual([]);
  });

  it("does not list a high group again as medium", () => {
    expect(pairs([s("1", "Nightdive Studios"), s("2", "Night Dive Studios")])).toEqual([
      ["high", "Night Dive Studios | Nightdive Studios"],
    ]);
  });
});
