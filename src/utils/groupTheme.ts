// A colour per group, derived from its id, for cards with no banner. The same
// group always gets the same gradient, and no two neighbours look grey.

// FNV-1a: every character moves the result, so ids that differ only at the
// end still land on different hues.
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The group's base hue, 0–359. */
export function groupHue(groupId: string): number {
  return hash(groupId) % 360;
}

/** A two-stop gradient in the group's hue, for a card banner or avatar fallback. */
export function groupGradient(groupId: string): string {
  const hue = groupHue(groupId);
  const second = (hue + 40) % 360;
  return `linear-gradient(135deg, hsl(${hue} 65% 45%), hsl(${second} 70% 30%))`;
}
