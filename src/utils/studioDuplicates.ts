// Finds `developers` rows that are probably the same company. IGDB has
// duplicate company entries (LucasArts / "Lucas Arts", Ubisoft Entertainment /
// "Ubi Soft Entertainment", each with its own igdb_id), and importing a game
// copies whichever one IGDB links, so we inherit them.
//
// Three confidence levels, from how much of the name had to be ignored:
//   high   — same name once case, accents, punctuation, spacing and legal
//            suffixes (Inc, Ltd, GmbH…) are ignored: "D3 Publisher" / "D3Publisher".
//   medium — also the same once generic words (Studios, Games, Software…) are
//            ignored: "Climax Group" / "Climax Studios". Often divisions of one
//            company rather than duplicates, so these need a human call.
//   low    — near-identical spelling: "Level Infinite" / "Level Infinity".
// Names that differ in a number ("Division 6" / "Division 9") never match.

export interface StudioRow {
  id: string;
  name: string;
}

export type DuplicateConfidence = 'high' | 'medium' | 'low';

export interface DuplicateGroup<T extends StudioRow> {
  confidence: DuplicateConfidence;
  key: string;
  studios: T[];
}

const LEGAL_WORDS = new Set([
  'the', 'inc', 'incorporated', 'ltd', 'llc', 'co', 'corp', 'corporation', 'company',
  'limited', 'gmbh', 'ag', 'sa', 'srl', 'sl', 'bv', 'kk', 'plc', 'pty', 'oy', 'ab', 'as',
]);

const GENERIC_WORDS = new Set([
  'studio', 'studios', 'game', 'games', 'entertainment', 'interactive', 'software',
  'soft', 'production', 'productions', 'publishing', 'digital', 'media', 'group',
  'international', 'holdings', 'team',
]);

// A regional arm ("Electronic Arts UK", "Sony Computer Entertainment Europe") is
// its own IGDB company, not a duplicate of the parent.
const REGION_WORDS = new Set([
  'america', 'americas', 'of', 'europe', 'eu', 'asia', 'uk', 'us', 'usa', 'japan',
  'tokyo', 'osaka', 'korea', 'china', 'taiwan', 'germany', 'france', 'australia',
  'canada', 'na', 'emea', 'west', 'east',
]);

const ROMAN: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
};

function tokens(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // Dots and apostrophes join rather than split: "S.A." → "sa", "h.a.n.d." → "hand", "D'Avekki" → "davekki".
    .replace(/['’.]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** The numbers in a name, roman numerals included: "Business Unit II" → "2". */
function numbersOf(name: string): string {
  return tokens(name)
    .map((t) => (/^\d+$/.test(t) ? t : ROMAN[t] ?? t.replace(/\D/g, '')))
    .join('');
}

/** True when one name is the other plus only region words. */
function isRegionalVariant(a: string, b: string): boolean {
  const ta = new Set(tokens(a).filter((t) => !LEGAL_WORDS.has(t)));
  const tb = new Set(tokens(b).filter((t) => !LEGAL_WORDS.has(t)));
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if (![...small].every((t) => big.has(t))) return false;
  const extra = [...big].filter((t) => !small.has(t));
  return extra.length > 0 && extra.every((t) => REGION_WORDS.has(t));
}

/** Name with case, accents, punctuation, spacing and legal suffixes ignored. */
export function strictStudioKey(name: string): string {
  return tokens(name).filter((t) => !LEGAL_WORDS.has(t)).join('');
}

/** strictStudioKey with generic words (Studios, Games…) also ignored. */
export function looseStudioKey(name: string): string {
  return tokens(name).filter((t) => !LEGAL_WORDS.has(t) && !GENERIC_WORDS.has(t)).join('');
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** pg_trgm-style similarity, 0–1. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export function findStudioDuplicates<T extends StudioRow>(
  studios: T[],
  { lowThreshold = 0.75 }: { lowThreshold?: number } = {},
): DuplicateGroup<T>[] {
  const strict = new Map(studios.map((s) => [s.id, strictStudioKey(s.name)]));
  const loose = new Map(studios.map((s) => [s.id, looseStudioKey(s.name)]));
  const groups: DuplicateGroup<T>[] = [];

  for (const [key, members] of groupBy(studios, (s) => strict.get(s.id)!)) {
    if (members.length > 1) groups.push({ confidence: 'high', key, studios: members });
  }

  // Only when the group holds at least two different strict names — otherwise
  // it's a high group already listed above.
  for (const [key, members] of groupBy(studios, (s) => loose.get(s.id)!)) {
    if (key.length < 3) continue;
    if (new Set(members.map((s) => strict.get(s.id))).size > 1) {
      groups.push({ confidence: 'medium', key, studios: members });
    }
  }

  // Near-spellings, compared within the same first two letters to keep this
  // well under a second for ~10k studios.
  const byPrefix = groupBy(
    studios.filter((s) => strict.get(s.id)!.length >= 6),
    (s) => strict.get(s.id)!.slice(0, 2),
  );
  for (const bucket of byPrefix.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i], b = bucket[j];
        const ka = strict.get(a.id)!, kb = strict.get(b.id)!;
        if (ka === kb || loose.get(a.id) === loose.get(b.id)) continue; // listed above
        if (numbersOf(a.name) !== numbersOf(b.name)) continue;
        if (isRegionalVariant(a.name, b.name)) continue;
        if (trigramSimilarity(ka, kb) >= lowThreshold) {
          groups.push({ confidence: 'low', key: `${ka}~${kb}`, studios: [a, b] });
        }
      }
    }
  }

  return groups;
}
