// IGDB stores a company's country as an ISO 3166-1 *numeric* code ("616"), which
// Intl.DisplayNames can't resolve — it echoes the number back. Map it to the
// alpha-2 code first. Covers every code in `developers` plus common neighbours;
// an unknown code returns null so callers hide it rather than print a number.
const NUMERIC_TO_ALPHA2: Record<string, string> = {
  '8': 'AL', '20': 'AD', '31': 'AZ', '32': 'AR', '36': 'AU', '40': 'AT', '50': 'BD',
  '51': 'AM', '56': 'BE', '70': 'BA', '76': 'BR', '100': 'BG', '112': 'BY', '124': 'CA',
  '136': 'KY', '152': 'CL', '156': 'CN', '158': 'TW', '170': 'CO', '188': 'CR', '191': 'HR',
  '192': 'CU', '196': 'CY', '203': 'CZ', '208': 'DK', '218': 'EC', '233': 'EE', '246': 'FI',
  '250': 'FR', '268': 'GE', '276': 'DE', '300': 'GR', '344': 'HK', '348': 'HU', '352': 'IS',
  '356': 'IN', '360': 'ID', '364': 'IR', '372': 'IE', '376': 'IL', '380': 'IT', '392': 'JP',
  '398': 'KZ', '404': 'KE', '408': 'KP', '410': 'KR', '428': 'LV', '438': 'LI', '440': 'LT',
  '442': 'LU', '458': 'MY', '470': 'MT', '484': 'MX', '492': 'MC', '498': 'MD', '499': 'ME',
  '504': 'MA', '528': 'NL', '540': 'NC', '554': 'NZ', '566': 'NG', '578': 'NO', '586': 'PK',
  '591': 'PA', '604': 'PE', '608': 'PH', '616': 'PL', '620': 'PT', '630': 'PR', '634': 'QA',
  '642': 'RO', '643': 'RU', '682': 'SA', '688': 'RS', '702': 'SG', '703': 'SK', '704': 'VN',
  '705': 'SI', '710': 'ZA', '724': 'ES', '752': 'SE', '756': 'CH', '764': 'TH', '784': 'AE',
  '788': 'TN', '792': 'TR', '804': 'UA', '807': 'MK', '818': 'EG', '826': 'GB', '840': 'US',
  '858': 'UY', '860': 'UZ', '862': 'VE',
};

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

/** English country name for an IGDB numeric code (or an alpha-2 code), else null. */
export function countryName(code: string | number | null | undefined): string | null {
  if (code == null || code === '') return null;
  const raw = String(code).trim();
  const alpha2 = /^\d+$/.test(raw) ? NUMERIC_TO_ALPHA2[String(Number(raw))] : raw.toUpperCase();
  if (!alpha2 || !/^[A-Z]{2}$/.test(alpha2)) return null;
  try {
    const name = regionNames.of(alpha2);
    return name && name !== alpha2 ? name : null;
  } catch {
    return null;
  }
}
