import { describe, expect, it } from "vitest";
import { classifyText, classifyImageUrl } from "./openaiModeration";

// No OPENAI_API_KEY is configured in this test environment — these confirm the
// "fail open" guarantee: a missing/unreachable moderation provider must never
// block a review, comment, or upload.
describe("moderation fails open without a configured provider", () => {
  it("classifyText returns not-flagged", async () => {
    await expect(classifyText("anything")).resolves.toEqual({ flagged: false, categories: [] });
  });

  it("classifyImageUrl returns not-flagged", async () => {
    await expect(classifyImageUrl("https://example.com/x.png")).resolves.toEqual({ flagged: false, categories: [] });
  });
});
