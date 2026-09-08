import { describe, expect, it } from "vitest";
import { validateName } from "./nameRules";

describe("validateName", () => {
  it("allows an ordinary name", () => {
    expect(validateName("samplename123").ok).toBe(true);
  });

  it("blocks the brand name outright", () => {
    expect(validateName("chekpoint").ok).toBe(false);
  });

  it("blocks brand containment with prefixes/suffixes", () => {
    expect(validateName("xChekpointx").ok).toBe(false);
    expect(validateName("chek-point_official").ok).toBe(false);
  });

  it("blocks leetspeak evasion of the brand name", () => {
    expect(validateName("ch3kp0int").ok).toBe(false);
  });

  it("blocks reserved role words on exact match", () => {
    expect(validateName("admin").ok).toBe(false);
    expect(validateName("Moderator").ok).toBe(false);
  });

  it("does not block names merely containing a reserved word as a substring", () => {
    expect(validateName("badminton").ok).toBe(true);
  });

  it("blocks profanity, including common evasion patterns", () => {
    expect(validateName("fuck").ok).toBe(false);
    expect(validateName("f u c k").ok).toBe(false);
  });

  it("rejects empty/whitespace-only input", () => {
    expect(validateName("   ").ok).toBe(false);
  });

  it("enforces the character/length format", () => {
    expect(validateName("ab").ok).toBe(false); // too short
    expect(validateName("a".repeat(21)).ok).toBe(false); // too long
    expect(validateName("has space").ok).toBe(false);
    expect(validateName("dot.name").ok).toBe(false);
    expect(validateName("dash-name").ok).toBe(false);
    expect(validateName("ok_name_1").ok).toBe(true);
  });
});
