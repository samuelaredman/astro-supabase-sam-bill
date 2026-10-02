import { describe, expect, it } from "vitest";
import { topRatedMinReviews } from "./groupStats";

describe("topRatedMinReviews", () => {
  it("ranks every game in a small group", () => {
    expect(topRatedMinReviews(0)).toBe(1);
    expect(topRatedMinReviews(9)).toBe(1);
  });

  it("needs two reviews from 10 members up", () => {
    expect(topRatedMinReviews(10)).toBe(2);
    expect(topRatedMinReviews(250)).toBe(2);
  });
});
