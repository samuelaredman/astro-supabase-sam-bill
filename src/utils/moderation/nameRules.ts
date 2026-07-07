import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity";

const profanityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const LEETSPEAK: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "$": "s", "@": "a",
};

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function normalize(input: string): string {
  return input
    .normalize("NFD").replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[01345$@]/g, (c) => LEETSPEAK[c] ?? c)
    .replace(/[^a-z0-9]/g, "");
}

// Brand protection: any containment of "chekpoint" is blocked, not just an exact match,
// so variants like "xChekpointx" or "chek-point_official" are still caught.
const BRAND_TERM = "chekpoint";

// Reserved role/impersonation words: exact match only, to avoid blocking usernames that
// merely contain these as a substring (e.g. "badminton").
const RESERVED_EXACT = new Set([
  "admin", "administrator", "moderator", "mod", "staff", "support",
  "official", "system", "help", "security", "root",
]);

export interface ValidateNameResult {
  ok: boolean;
  error?: string;
}

const UNAVAILABLE: ValidateNameResult = { ok: false, error: "That name isn't available." };

export function validateName(input: unknown): ValidateNameResult {
  // Coerce defensively: this runs on the signup endpoint, and a malformed body
  // (e.g. a non-string username) must never throw and turn into a 500.
  const trimmed = typeof input === "string" ? input.trim() : "";
  if (!trimmed) return UNAVAILABLE;

  const normalized = normalize(trimmed);

  if (normalized.includes(BRAND_TERM)) return UNAVAILABLE;
  if (RESERVED_EXACT.has(normalized)) return UNAVAILABLE;
  // Check both the raw input (so obscenity's own leetspeak/confusable transformers
  // apply) and the alphanumeric-only normalized form (catches spacing/separator
  // evasion like "f u c k" that would otherwise slip past as separate "words").
  if (profanityMatcher.hasMatch(trimmed) || profanityMatcher.hasMatch(normalized)) return UNAVAILABLE;

  return { ok: true };
}
