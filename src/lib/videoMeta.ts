// Helpers for the video report: max reported intensity parsed from free
// text (PHIVOLCS PEIS / USGS MMI roman numerals) and a heuristic
// felt/affected radius from magnitude (NOT official data — callers must
// display it with a ~ prefix).

function romanToInt(s: string): number {
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  let prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const cur = v[s[i]] ?? 0;
    if (cur < prev) total -= cur;
    else {
      total += cur;
      prev = cur;
    }
  }
  return total;
}

const ROMAN_1_TO_10 = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function extractMaxIntensity(...texts: Array<string | undefined | null>): string {
  let best = 0;
  const consider = (s: string) => {
    const n = romanToInt(s.toUpperCase());
    if (n >= 1 && n <= 10 && n > best) best = n;
  };
  for (const text of texts) {
    if (!text) continue;
    for (const m of text.matchAll(/(?:intensity|peis|mmi)\s*([IVXLCDM]{1,4})\b/gi)) consider(m[1]);
    for (const m of text.matchAll(/(?<![A-Z0-9])([IVX]{2,4})(?![A-Z0-9])/g)) consider(m[1]);
  }
  return best > 0 ? ROMAN_1_TO_10[best] : '';
}

export function estimateAffectedRadiusKm(magRaw: string): string {
  const m = parseFloat(magRaw);
  if (isNaN(m)) return '';
  const r = Math.max(5, Math.round((20 * Math.pow(1.8, m - 3)) / 5) * 5);
  return `~${r} km`;
}

// Rough rapid-loss heuristic (NOT official data — always shown as wide
// "~" ranges, never precise figures). Driven by BOTH magnitude and max
// felt intensity, taking the more conservative tier: a big offshore quake
// nobody felt must not print city-killer numbers.
const DAMAGE_TIERS = [
  { losses: '~$0–$100', fatalities: '0' },
  { losses: '~$100–$10K', fatalities: '0' },
  { losses: '~$1K–$1M', fatalities: '0–2' },
  { losses: '~$1M–$100M', fatalities: '0–50' },
  { losses: '~$100M+', fatalities: '50+' },
];

function magDamageTier(magRaw: string): number {
  const m = parseFloat(magRaw);
  if (isNaN(m)) return -1;
  if (m < 4) return 0;
  if (m < 5) return 1;
  if (m < 6) return 2;
  if (m < 7) return 3;
  return 4;
}

function intensityDamageTier(intensity: string): number {
  const n = romanToInt((intensity || '').toUpperCase());
  if (n <= 0) return -1;
  if (n <= 2) return 0;
  if (n === 3) return 1;
  if (n <= 5) return 2;
  if (n <= 7) return 3;
  return 4;
}

export function estimateDamage(magRaw: string, intensity?: string): { losses: string; fatalities: string } | null {
  const fromMag = magDamageTier(magRaw);
  if (fromMag < 0) return null;
  const fromInt = intensity ? intensityDamageTier(intensity) : -1;
  const tier = fromInt >= 0 ? Math.min(fromMag, fromInt) : fromMag;
  return DAMAGE_TIERS[tier];
}

export interface ShakeRow {
  area: string;
  intensity: string;
}

// "Intensity V - Laoag City, Ilocos Norte; Intensity III - Batac, ..." ->
// [{ area, intensity }] sorted strongest-first. Handles grouped locations like
// "Intensity IV - Ruteng (54k), Pajo (13k), Jaong (2k)" by splitting on commas.
// Anything unparseable is skipped, so callers only ever render real felt reports.
export function extractShakeRows(text: string | undefined | null, maxRows = 5): ShakeRow[] {
  if (!text) return [];
  const rows: ShakeRow[] = [];
  const seen = new Set<string>();
  for (const seg of text.split(/[;\n]/)) {
    const m = /intensity\s*([IVXLCDM]{1,4})\s*[-–—:.]?\s*(.+)/i.exec(seg.trim());
    if (!m) continue;
    const n = romanToInt(m[1].toUpperCase());
    if (n < 1 || n > 10) continue;
    const intensity = ROMAN_1_TO_10[n];
    // Split multiple locations sharing the same intensity (e.g. "Ruteng (54k), Pajo (13k)")
    const areasPart = m[2].trim();
    // Remove trailing " and X more" count before splitting
    const cleanPart = areasPart.replace(/\s+and\s+\d+\s+more\s*$/i, '').trim();
    const areaTokens = cleanPart.split(',').map((s) => s.trim()).filter(Boolean);
    for (const rawArea of areaTokens) {
      if (/^and\s+\d+\s+more$/i.test(rawArea)) continue;
      // Boilerplate, not a place (e.g. USGS "Intensity III - Reported
      // intensity via Did You Feel It?") — never a felt-report row.
      if (/reported intensity|did you feel|felt report|\bdyfi\b/i.test(rawArea)) continue;
      const area = rawArea.replace(/\s+/g, ' ').slice(0, 40).trim();
      if (!area || seen.has(area.toLowerCase())) continue;
      seen.add(area.toLowerCase());
      rows.push({ area, intensity });
      if (rows.length >= maxRows) break;
    }
    if (rows.length >= maxRows) break;
  }
  rows.sort((a, b) => romanToInt(b.intensity) - romanToInt(a.intensity));
  return rows.slice(0, maxRows);
}
