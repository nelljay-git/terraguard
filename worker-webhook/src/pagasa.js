// Combined from worker-webhook modules - see PAGASA_README.md
// ===== config.ts =====
/**
 * Source registry + risk configuration.
 *
 * Official DOST-PAGASA sources ONLY. To change/extend sources, edit
 * DEFAULT_SOURCES here or override via the PAGASA_SOURCES_JSON secret —
 * no parser/fetch rewrites needed.
 */
export const SOURCE_ATTRIBUTION = "DOST-PAGASA";
/** Verified official PAGASA pages (Sept 2026). */
export const DEFAULT_SOURCES = [
    {
        key: "tc-bulletin",
        type: "tropical-cyclone-bulletin",
        label: "Tropical Cyclone Bulletin",
        url: "https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin",
        notifyEnabled: true,
    },
    {
        key: "tc-advisory",
        type: "tropical-cyclone-advisory",
        label: "Tropical Cyclone Advisory",
        url: "https://www.pagasa.dost.gov.ph/tropical-cyclone-advisory-iframe",
        notifyEnabled: true,
    },
    {
        key: "weather-advisory",
        type: "weather-advisory",
        label: "Weather Advisory",
        url: "https://www.pagasa.dost.gov.ph/weather/weather-advisory",
        notifyEnabled: true,
    },
    {
        key: "forecast",
        type: "forecast-conditions",
        label: "Forecast Weather Conditions",
        url: "https://www.pagasa.dost.gov.ph/weather",
        notifyEnabled: true,
    },
    {
        key: "gale-warning",
        type: "gale-warning",
        label: "Gale Warning",
        url: "https://www.pagasa.dost.gov.ph/marine/gale-warning",
        notifyEnabled: true,
    },
    {
        key: "flood",
        type: "flood-info",
        label: "Flood Information",
        url: "https://www.pagasa.dost.gov.ph/flood",
        notifyEnabled: false,
        statusEnabled: false,
    },
    {
        key: "homepage",
        type: "general",
        label: "PAGASA Homepage Advisories",
        url: "https://www.pagasa.dost.gov.ph/",
        notifyEnabled: false, // context only — never notifies on its own
        statusEnabled: false,
    },
];
// NOTE: /flood and / are static portals (verified: descriptive text, no
// "Issued at"/"Bulletin No." markers), so they are context-only by default.
// Point a flood-info source at a live PAGASA bulletin URL and set
// notifyEnabled/statusEnabled to true (via PAGASA_SOURCES_JSON, no code
// change) to promote it to a notifying source. The flood parser, change
// detector, and CRITICAL-flood force rule already handle live bulletins.
export function resolveSources(envSourcesJson) {
    if (!envSourcesJson)
        return DEFAULT_SOURCES;
    try {
        const parsed = JSON.parse(envSourcesJson);
        if (!Array.isArray(parsed))
            return DEFAULT_SOURCES;
        const valid = parsed.filter((s) => s && typeof s.key === "string" && typeof s.url === "string" && typeof s.type === "string");
        return valid.length > 0 ? valid : DEFAULT_SOURCES;
    }
    catch {
        return DEFAULT_SOURCES;
    }
}
export const DEFAULT_RISK_CONFIG = {
    weights: {
        rainGeneral: 1,
        rainHeavy: 2,
        rainSevere: 3,
        thunderstormPossible: 1,
        thunderstormSignificant: 2,
        floodWatch: 2,
        floodWarning: 3,
        floodCritical: 4,
        td: 1,
        ts: 2,
        sts: 3,
        typhoon: 4,
        superTyphoon: 5,
        windModerate: 1,
        windStrong: 2,
        windSevere: 3,
        coastalHazard: 2,
        surgeSignificant: 3,
        surgeSevere: 4,
        landslidePotential: 2,
        landslideSignificant: 3,
    },
    caps: { rainfall: 3, thunderstorm: 2, flood: 4, cyclone: 5, wind: 3, surge: 4, landslide: 3 },
    thresholds: { elevated: 3, moderate: 6, high: 9, critical: 13 },
    force: {
        criticalFloodForces: "CRITICAL",
        superTyphoonForces: "CRITICAL",
        typhoonWithSevereSurgeForces: "CRITICAL",
        floodWarningPlusHeavyRainForces: "HIGH",
    },
};
export function resolveRiskConfig(envJson) {
    if (!envJson)
        return DEFAULT_RISK_CONFIG;
    try {
        const parsed = JSON.parse(envJson);
        return {
            weights: { ...DEFAULT_RISK_CONFIG.weights, ...(parsed.weights ?? {}) },
            caps: { ...DEFAULT_RISK_CONFIG.caps, ...(parsed.caps ?? {}) },
            thresholds: { ...DEFAULT_RISK_CONFIG.thresholds, ...(parsed.thresholds ?? {}) },
            force: { ...DEFAULT_RISK_CONFIG.force, ...(parsed.force ?? {}) },
        };
    }
    catch {
        return DEFAULT_RISK_CONFIG;
    }
}
export const FETCH_TIMEOUT_MS = 15000;
export const FETCH_USER_AGENT = "TerraGuard-PAGASA-Monitor/1.0 (hazard-monitoring; contact: Terra Guard PH)";
export const RAW_CONTENT_MAX_CHARS = 12000;
export const EVENT_TTL_SECONDS = 60 * 60 * 24 * 30;
export const DAILY_TTL_SECONDS = 60 * 60 * 24 * 90;
export const MAX_INDEX_DEFAULT = 100;
// ===== fetchers.ts =====
/**
 * One fetcher per PAGASA information type.
 *
 * All fetchers go through fetchPage(); per-type wrappers exist so headers,
 * fallbacks, or URL shapes can diverge per type without touching the rest of
 * the pipeline. Sources come from config — never hardcoded per call site.
 */
async function fetchPage(source) {
    const fetchedAt = new Date().toISOString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(source.url, {
            signal: controller.signal,
            headers: {
                "User-Agent": FETCH_USER_AGENT,
                Accept: "text/html,application/xhtml+xml",
            },
            redirect: "follow",
        });
        const html = res.ok ? await res.text() : "";
        return {
            sourceKey: source.key,
            type: source.type,
            url: source.url,
            ok: res.ok,
            status: res.status,
            html,
            fetchedAt,
            ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
        };
    }
    catch (e) {
        return {
            sourceKey: source.key,
            type: source.type,
            url: source.url,
            ok: false,
            status: 0,
            html: "",
            fetchedAt,
            error: e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
// --- Per-type fetchers (separate functions by design) -----------------------
export function fetchTropicalCycloneBulletin(source) {
    return fetchPage(source);
}
export function fetchTropicalCycloneAdvisory(source) {
    return fetchPage(source);
}
export function fetchSevereWeatherBulletin(source) {
    return fetchPage(source);
}
export function fetchWeatherAdvisory(source) {
    return fetchPage(source);
}
export function fetchForecastConditions(source) {
    return fetchPage(source);
}
export function fetchHeavyRainfall(source) {
    return fetchPage(source);
}
export function fetchFloodInfo(source) {
    return fetchPage(source);
}
export function fetchGaleWarning(source) {
    return fetchPage(source);
}
export function fetchThunderstormInfo(source) {
    return fetchPage(source);
}
export function fetchMonsoonInfo(source) {
    return fetchPage(source);
}
export function fetchGeneralAdvisory(source) {
    return fetchPage(source);
}
/** Dispatch a configured source to its dedicated fetcher. */
export function fetchSource(source) {
    switch (source.type) {
        case "tropical-cyclone-bulletin":
            return fetchTropicalCycloneBulletin(source);
        case "tropical-cyclone-advisory":
            return fetchTropicalCycloneAdvisory(source);
        case "severe-weather-bulletin":
            return fetchSevereWeatherBulletin(source);
        case "weather-advisory":
            return fetchWeatherAdvisory(source);
        case "forecast-conditions":
            return fetchForecastConditions(source);
        case "heavy-rainfall":
            return fetchHeavyRainfall(source);
        case "flood-info":
            return fetchFloodInfo(source);
        case "gale-warning":
            return fetchGaleWarning(source);
        case "thunderstorm-info":
            return fetchThunderstormInfo(source);
        case "monsoon-info":
            return fetchMonsoonInfo(source);
        case "general":
        default:
            return fetchGeneralAdvisory(source);
    }
}
// ===== parsers.ts =====
/**
 * One parser per PAGASA information type.
 *
 * PAGASA pages do NOT share one structure, so each type has its own parser.
 * All parsers are extractive: fields stay null/empty unless the text actually
 * contains them. Nothing is guessed or invented.
 */
// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------
/**
 * Extract PAGASA's article body (`article-header` + `article-content`) with a
 * tiny div-depth scan. Returns null when the template has no article block,
 * in which case callers fall back to the chrome-stripped full page.
 */
function extractArticleHtml(html) {
    const openRe = /<div[^>]*class=(["'])[^"']*article-content[^"']*\1[^>]*>/i;
    const m = openRe.exec(html);
    if (!m) return null;
    let depth = 1;
    const tagRe = /<\/?div\b[^>]*>/gi;
    tagRe.lastIndex = m.index + m[0].length;
    let t;
    let end = html.length;
    while ((t = tagRe.exec(html)) !== null) {
        if (t[0][1] === "/") {
            depth--;
            if (depth === 0) {
                end = tagRe.lastIndex;
                break;
            }
        }
        else {
            depth++;
        }
    }
    // Include the article-header (usually the bulletin title) just before it.
    let start = m.index;
    const headRe = /<div[^>]*class=(["'])[^"']*article-header[^"']*\1[^>]*>([\s\S]{1,400}?)<\/div>/gi;
    let h;
    while ((h = headRe.exec(html)) !== null && h.index < m.index) {
        start = h.index;
    }
    return html.slice(start, end);
}
export function htmlToText(html) {
    const article = extractArticleHtml(html);
    const src = article ?? html;
    return src
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<header[\s\S]*?<\/header>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6]|table|thead|tbody)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .filter((l) => l.length > 0)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
function firstMatch(text, patterns) {
    for (const p of patterns) {
        const m = p.exec(text);
        if (m)
            return (m[1] ?? m[0]).trim().replace(/\s+/g, " ");
    }
    return "";
}
// ---------------------------------------------------------------------------
// Title / issued time
// ---------------------------------------------------------------------------
const GENERIC_CHROME_TITLE = /^(govph|home|menu|navigation|pagasa|dost[-\s]?pagasa)$/i;
function extractTitle(html, text, fallback) {
    // Search chrome-free markup so nav/menu text (e.g. "GOVPH") never wins.
    const chromeFree = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<header[\s\S]*?<\/header>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<aside[\s\S]*?<\/aside>/gi, " ");
    const clean = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const isUsable = (s) => s.length >= 4 && s.length <= 240 && !GENERIC_CHROME_TITLE.test(s);
    const fromHtml = firstMatch(chromeFree, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /<title>([^<]+)<\/title>/i,
    ]);
    const headings = [...chromeFree.matchAll(/<h[1-3][^>]*>([\s\S]{3,220}?)<\/h[1-3]>/gi)]
        .map((m) => clean(m[1]))
        .filter(isUsable);
    const heading = headings[0] ?? "";
    const lines = text.split("\n");
    const bulletinLine = lines.find((l) => /(tropical cyclone bulletin|severe weather bulletin|tropical cyclone advisory|weather advisory|heavy rainfall|flood (bulletin|advisory|warning|information)|gale warning|thunderstorm advisory|thunderstorm information)/i.test(l));
    for (const candidate of [bulletinLine ?? "", heading, clean(fromHtml)]) {
        if (isUsable(candidate))
            return candidate;
    }
    return fallback;
}
function extractIssuedAt(text) {
    return firstMatch(text, [
        /issued at ([^\n]{4,80})/i,
        /issued:?\s*([^\n]{4,80})/i,
        /valid for broadcast until ([^\n]{4,80})/i,
        /(\d{1,2}:\d{2}\s*(?:AM|PM)[^\n]{0,60}\d{1,2}\s+\w+\s+\d{4})/i,
        /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}[^\n]{0,40})/i,
    ]);
}
// ---------------------------------------------------------------------------
// Cyclone identity / movement
// ---------------------------------------------------------------------------
const CATEGORY_PATTERN = /(super typhoon|severe tropical storm|tropical storm|tropical depression|typhoon|low pressure area)/i;
function extractCyclone(text) {
    const m = /(super typhoon|severe tropical storm|tropical storm|tropical depression|typhoon)\s+["“”']?([A-Z][A-Za-z]+)["“”']?/i.exec(text) ?? /["“”']([A-Z][A-Za-z]+)["“”']\s*\((super typhoon|severe tropical storm|tropical storm|tropical depression|typhoon)\)/i.exec(text);
    if (m) {
        const hasCategoryFirst = /super typhoon|severe tropical storm|tropical storm|tropical depression|typhoon/i.test(m[1]);
        return {
            category: (hasCategoryFirst ? m[1] : m[2]).toLowerCase(),
            name: (hasCategoryFirst ? m[2] : m[1]).toUpperCase(),
        };
    }
    const catOnly = CATEGORY_PATTERN.exec(text);
    return { name: null, category: catOnly ? catOnly[1].toLowerCase() : null };
}
function extractMovement(text) {
    const line = text
        .split("\n")
        .find((l) => /(moving|forecast to move|track|heading)\b/i.test(l) && /(north|south|east|west|km\/h|kph|slowly|rapidly|stationary)/i.test(l));
    return line ? line.trim().slice(0, 300) : null;
}
// ---------------------------------------------------------------------------
// Wind signals + affected areas
// ---------------------------------------------------------------------------
const AREA_STOPWORDS = new Set("and,or,the,of,with,areas,area,including,includes,rest,remaining,other,along,over,under,signal,warning,issued,valid,broadcast,next,bulletin,advisory,plus,info,see,more,details,click".split(","));
function cleanAreaToken(token) {
    const t = token
        .replace(/^[-•·*\d.)\s]+/, "")
        .replace(/\s*\(.*?\)\s*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (t.length < 3 || t.length > 60)
        return null;
    if (/^\d+$/.test(t))
        return null;
    if (!/[A-Za-z]/.test(t))
        return null;
    const words = t.split(" ");
    if (words.length > 6)
        return null;
    if (words.every((w) => AREA_STOPWORDS.has(w.toLowerCase())))
        return null;
    if (/^(no|none|no\.\s*\d|signal|wind)/i.test(t))
        return null;
    return t;
}
function extractSignals(text) {
    const signals = [];
    const re = /(?:tropical cyclone )?wind signal\s*(?:no\.?|number|#)?\s*([1-5])/gi;
    const hits = [];
    let m;
    while ((m = re.exec(text)) !== null)
        hits.push({ level: parseInt(m[1], 10), index: m.index });
    if (hits.length === 0)
        return signals;
    for (let i = 0; i < hits.length; i++) {
        const start = hits[i].index;
        const end = i + 1 < hits.length ? hits[i + 1].index : Math.min(text.length, start + 2500);
        const block = text.slice(start, end);
        const afterHeader = block.replace(/^.*?(?:wind signal[^\n]*)\n?/i, "");
        const cut = afterHeader.split(/(?:next|the next|valid|issued| tropical cyclone bulletin|severe winds|hazards|track and)/i)[0];
        const tokens = cut.split(/[\n,;•·*|]/).map(cleanAreaToken).filter((t) => t !== null);
        const areas = [...new Set(tokens)].slice(0, 120);
        const existing = signals.find((s) => s.level === hits[i].level);
        if (existing) {
            for (const a of areas)
                if (!existing.areas.includes(a))
                    existing.areas.push(a);
        }
        else {
            signals.push({ level: hits[i].level, areas });
        }
    }
    return signals.sort((a, b) => a.level - b.level);
}
// ---------------------------------------------------------------------------
// Systems / hazards / outlook lines
// ---------------------------------------------------------------------------
const KNOWN_SYSTEMS = [
    "Southwest Monsoon",
    "Northeast Monsoon",
    "Intertropical Convergence Zone",
    "Low Pressure Area",
    "Shear Line",
    "Easterlies",
    "Frontal System",
    "High Pressure Area",
    "Thunderstorm",
    "Tropical Cyclone",
];
/** @type {Array<[RegExp, string]>} */
const SYSTEM_ALIASES = [
    [/\bITCZ\b/i, "Intertropical Convergence Zone"],
    [/\bLPA\b/i, "Low Pressure Area"],
    [/southwest monsoon|habagat/i, "Southwest Monsoon"],
    [/northeast monsoon|amihan/i, "Northeast Monsoon"],
    [/shear line/i, "Shear Line"],
    [/easterlies/i, "Easterlies"],
    [/frontal system|cold front/i, "Frontal System"],
    [/thunderstorm/i, "Thunderstorm"],
];
function extractSystems(text) {
    const found = new Set();
    for (const [re, name] of SYSTEM_ALIASES)
        if (re.test(text))
            found.add(name);
    for (const name of KNOWN_SYSTEMS)
        if (text.toLowerCase().includes(name.toLowerCase()))
            found.add(name);
    return [...found];
}
/** @type {Array<[RegExp, string]>} */
const HAZARD_PATTERNS = [
    [/heavy rainfall|heavy rains|heavy to intense|intense rains|torrential/i, "heavy rainfall"],
    [/\brain\b/i, "rain"],
    [/thunderstorm/i, "thunderstorm"],
    [/flash ?flood|flooding|flood/i, "flooding"],
    [/landslide/i, "landslide"],
    [/storm surge/i, "storm surge"],
    [/gale|gale-force/i, "gale winds"],
    [/strong (to gale-?force )?winds?|strong winds/i, "strong winds"],
    [/severe wind/i, "severe winds"],
    [/rough seas|very rough seas|high seas/i, "rough seas"],
    [/landfall/i, "landfall"],
];
function extractHazards(text) {
    /** @type {string[]} */
    const found = [];
    for (const [re, name] of HAZARD_PATTERNS)
        if (re.test(text) && !found.includes(name))
            found.push(name);
    return found;
}
function extractLine(text, re) {
    const line = text.split("\n").find((l) => re.test(l));
    return line ? line.trim().slice(0, 400) : null;
}
// ---------------------------------------------------------------------------
// No-active statements
// ---------------------------------------------------------------------------
function detectNoActive(text, type) {
    const t = text.toLowerCase();
    if (/no active tropical cyclone/i.test(text))
        return true;
    if (type === "gale-warning" && /no gale warning|there is no gale/i.test(text))
        return true;
    if (/there is no .* issued/i.test(text))
        return true;
    if (/no weather advisory (is )?in effect|no flood (warning|advisory) (is )?in effect/i.test(text))
        return true;
    if (t.length < 400 && /none currently|nothing to report/i.test(text))
        return true;
    return false;
}
// ---------------------------------------------------------------------------
// Base builder + per-type parsers
// ---------------------------------------------------------------------------
function baseParse(result, text, fallbackTitle) {
    const { name, category } = extractCyclone(text);
    const signals = extractSignals(text);
    const signalAreas = signals.flatMap((s) => s.areas);
    return {
        title: extractTitle(result.html, text, fallbackTitle),
        issuedAt: extractIssuedAt(text),
        cycloneName: name,
        cycloneCategory: category,
        cycloneMovement: extractMovement(text),
        signals,
        rainfall: extractLine(text, /rainfall outlook|heavy rainfall|forecast rainfall|expected rainfall/i) ??
            extractLine(text, /\brain\b/i),
        flood: extractLine(text, /flood (outlook|advisory|warning|information|bulletin)|critical flood/i),
        winds: extractLine(text, /wind signal|gale|strong winds|severe winds|winds/i),
        surge: extractLine(text, /storm surge|coastal/i),
        systems: extractSystems(text),
        affectedAreas: [...new Set(signalAreas)].slice(0, 200),
        hazards: extractHazards(text),
        text: text.slice(0, 20000),
        statesNoActive: detectNoActive(text, result.type),
    };
}
function withAreaFallback(parsed, text) {
    if (parsed.affectedAreas.length > 0 || parsed.statesNoActive)
        return parsed;
    // Conservative fallback: lines that enumerate places after an "areas" cue.
    const cue = text.split("\n").findIndex((l) => /areas? (affected|to watch|under|likely)|places? (affected|likely)/i.test(l));
    if (cue >= 0) {
        const tokens = text
            .split("\n")
            .slice(cue + 1, cue + 6)
            .flatMap((l) => l.split(/[,;]/))
            .map(cleanAreaToken)
            .filter((t) => t !== null);
        parsed.affectedAreas = [...new Set(tokens)].slice(0, 60);
    }
    return parsed;
}
/** Tropical Cyclone Bulletin (severe-weather-bulletin page family). */
export function parseTropicalCycloneBulletin(result, text) {
    return withAreaFallback(baseParse(result, text, "Tropical Cyclone Bulletin"), text);
}
/** Tropical Cyclone Advisory (outside-PAR / outlook family). */
export function parseTropicalCycloneAdvisory(result, text) {
    return withAreaFallback(baseParse(result, text, "Tropical Cyclone Advisory"), text);
}
/** Severe Weather Bulletin (legacy/alternate TC bulletin path). */
export function parseSevereWeatherBulletin(result, text) {
    return withAreaFallback(baseParse(result, text, "Severe Weather Bulletin"), text);
}
/** Weather Advisory (incl. heavy-rainfall outlooks). */
export function parseWeatherAdvisory(result, text) {
    const parsed = baseParse(result, text, "Weather Advisory");
    if (!parsed.rainfall)
        parsed.rainfall = extractLine(text, /monsoon|rainfall|rains/i);
    return withAreaFallback(parsed, text);
}
/** Forecast Weather Conditions table page. */
export function parseForecastConditions(result, text) {
    return withAreaFallback(baseParse(result, text, "Forecast Weather Conditions"), text);
}
/** Heavy Rainfall Warning page family. */
export function parseHeavyRainfall(result, text) {
    return withAreaFallback(baseParse(result, text, "Heavy Rainfall Warning"), text);
}
/** Flood Information / General Flood Advisory family. */
export function parseFloodInfo(result, text) {
    const parsed = baseParse(result, text, "Flood Information");
    if (!parsed.flood)
        parsed.flood = extractLine(text, /river|water ?level|dam|discharge/i);
    return withAreaFallback(parsed, text);
}
/** Gale Warning (marine) family. */
export function parseGaleWarning(result, text) {
    return withAreaFallback(baseParse(result, text, "Gale Warning"), text);
}
/** Thunderstorm information family. */
export function parseThunderstormInfo(result, text) {
    return withAreaFallback(baseParse(result, text, "Thunderstorm Information"), text);
}
/** Monsoon information family. */
export function parseMonsoonInfo(result, text) {
    return withAreaFallback(baseParse(result, text, "Monsoon Information"), text);
}
/** Generic fallback — never invents structure, only shared extractors. */
export function parseGeneric(result, text) {
    return withAreaFallback(baseParse(result, text, "PAGASA Advisory"), text);
}
/** Dispatch a fetch result to its dedicated parser. */
export function parseSource(result) {
    const text = htmlToText(result.html);
    switch (result.type) {
        case "tropical-cyclone-bulletin":
            return parseTropicalCycloneBulletin(result, text);
        case "tropical-cyclone-advisory":
            return parseTropicalCycloneAdvisory(result, text);
        case "severe-weather-bulletin":
            return parseSevereWeatherBulletin(result, text);
        case "weather-advisory":
            return parseWeatherAdvisory(result, text);
        case "forecast-conditions":
            return parseForecastConditions(result, text);
        case "heavy-rainfall":
            return parseHeavyRainfall(result, text);
        case "flood-info":
            return parseFloodInfo(result, text);
        case "gale-warning":
            return parseGaleWarning(result, text);
        case "thunderstorm-info":
            return parseThunderstormInfo(result, text);
        case "monsoon-info":
            return parseMonsoonInfo(result, text);
        case "general":
        default:
            return parseGeneric(result, text);
    }
}
// ===== normalize.ts =====
/**
 * Normalized representation + content hashing for duplicate detection.
 */
/** Collapse whitespace/case so trivial page diffs don't count as new content. */
export function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/philippine standard time.*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
export async function sha256Hex(input) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function buildNormalized(result, parsed) {
    const normalizedBody = normalizeText([parsed.title, parsed.issuedAt, parsed.text].filter(Boolean).join("\n"));
    return {
        source: SOURCE_ATTRIBUTION,
        sourceKey: result.sourceKey,
        sourceUrl: result.url,
        advisoryType: result.type,
        title: parsed.title,
        issuedTime: parsed.issuedAt,
        fetchedTime: result.fetchedAt,
        contentHash: await sha256Hex(`${result.sourceKey}\n${normalizedBody}`),
        rawContent: parsed.text.slice(0, RAW_CONTENT_MAX_CHARS),
    };
}
// ===== change.ts =====
/**
 * Meaningful-change detection between previous and current advisories.
 *
 * Only PAGASA terminology is used; area names and signal numbers come straight
 * from the parsed source — never invented.
 */
function maxSignal(signals) {
    const list = signals ?? [];
    if (list.length === 0)
        return null;
    return Math.max(...list.map((s) => s.level));
}
function signalLine(level) {
    return level === null ? "none" : `No. ${level}`;
}
function floodRank(flood) {
    if (!flood)
        return 0;
    const t = flood.toLowerCase();
    if (/critical/.test(t))
        return 4;
    if (/warning/.test(t))
        return 3;
    if (/advisory|advisories/.test(t))
        return 2;
    if (/outlook|watch|information/.test(t))
        return 1;
    return 1;
}
export function detectChanges(prev, curr, prevRisk, currRisk) {
    const changes = [];
    // First sighting of this source state.
    if (!prev) {
        if (curr.statesNoActive)
            return [];
        changes.push({ kind: "new-advisory", detail: `New advisory: ${curr.title || "PAGASA advisory"}`, material: true });
        return changes;
    }
    // Advisory cleared / ended.
    if (!prev.statesNoActive && curr.statesNoActive) {
        changes.push({ kind: "advisory-ended", detail: `Advisory ended: ${prev.title || "previous advisory"} no longer in effect`, material: true });
        return changes;
    }
    if (prev.statesNoActive && !curr.statesNoActive) {
        changes.push({ kind: "new-advisory", detail: `New advisory: ${curr.title || "PAGASA advisory"}`, material: true });
        return changes;
    }
    if (prev.statesNoActive && curr.statesNoActive)
        return changes;
    // Title / issuance turnover (e.g. new bulletin number with same hash family).
    if (prev.title !== curr.title && curr.title) {
        changes.push({ kind: "advisory-updated", detail: `Advisory updated: ${curr.title}`, material: false });
    }
    else if (prev.issuedAt !== curr.issuedAt && curr.issuedAt) {
        changes.push({ kind: "advisory-updated", detail: `Advisory updated (issued ${curr.issuedAt})`, material: false });
    }
    // Wind signals.
    const prevMax = maxSignal(prev.signals);
    const currMax = maxSignal(curr.signals);
    if (prevMax !== currMax) {
        changes.push({
            kind: currMax !== null && (prevMax ?? 0) < currMax ? "signal-increased" : "signal-decreased",
            detail: `Wind Signal: ${signalLine(prevMax)} → ${signalLine(currMax)}`,
            material: true,
        });
    }
    // Affected areas.
    const prevAreas = new Set(prev.affectedAreas);
    const currAreas = new Set(curr.affectedAreas);
    const added = [...currAreas].filter((a) => !prevAreas.has(a));
    const removed = [...prevAreas].filter((a) => !currAreas.has(a));
    for (const a of added.slice(0, 10)) {
        changes.push({ kind: "area-added", detail: `Additional area added to the warning: ${a}`, material: true });
    }
    if (added.length > 10) {
        changes.push({ kind: "area-added", detail: `${added.length - 10} more areas added to the warning`, material: true });
    }
    for (const r of removed.slice(0, 10)) {
        changes.push({ kind: "area-removed", detail: `Area removed from the warning: ${r}`, material: true });
    }
    if (removed.length > 10) {
        changes.push({ kind: "area-removed", detail: `${removed.length - 10} more areas removed from the warning`, material: false });
    }
    // Cyclone identity / movement.
    if ((prev.cycloneCategory ?? "") !== (curr.cycloneCategory ?? "") && curr.cycloneCategory) {
        changes.push({
            kind: "intensity-changed",
            detail: `Tropical cyclone intensity changed: ${prev.cycloneCategory ?? "unknown"} → ${curr.cycloneCategory}`,
            material: true,
        });
    }
    else if ((prev.cycloneName ?? "") !== (curr.cycloneName ?? "") && curr.cycloneName) {
        changes.push({ kind: "intensity-changed", detail: `Tropical cyclone being monitored: ${curr.cycloneName}`, material: true });
    }
    if ((prev.cycloneMovement ?? "") !== (curr.cycloneMovement ?? "") && curr.cycloneMovement) {
        changes.push({ kind: "movement-changed", detail: `Tropical cyclone movement changed: ${curr.cycloneMovement}`, material: true });
    }
    // Rainfall outlook.
    if ((prev.rainfall ?? "") !== (curr.rainfall ?? "") && curr.rainfall) {
        const escalated = /heavy|intense|torrential|extreme/i.test(curr.rainfall);
        changes.push({ kind: "rainfall-changed", detail: `Rainfall outlook changed: ${curr.rainfall}`, material: escalated });
    }
    // Flood escalation (rank-based, PAGASA's own bulletin vocabulary).
    const prevFlood = floodRank(prev.flood);
    const currFlood = floodRank(curr.flood);
    if (currFlood > prevFlood) {
        changes.push({ kind: "flood-escalated", detail: `Flood warning escalated: ${curr.flood ?? "flood bulletin"}`, material: true });
    }
    else if (currFlood < prevFlood) {
        changes.push({ kind: "flood-downgraded", detail: `Flood warning downgraded: ${curr.flood ?? "lower flood bulletin level"}`, material: true });
    }
    // Warning cancelled (signals dropped entirely while advisory continues).
    if (prev.signals.length > 0 && curr.signals.length === 0 && !curr.statesNoActive) {
        changes.push({ kind: "warning-cancelled", detail: "Wind signals lifted in the latest advisory", material: true });
    }
    // Risk movement.
    if (prevRisk && currRisk.status !== prevRisk.status) {
        const order = ["LOW", "ELEVATED", "MODERATE", "HIGH", "CRITICAL"];
        const up = order.indexOf(currRisk.status) > order.indexOf(prevRisk.status);
        changes.push({
            kind: up ? "risk-increased" : "risk-decreased",
            detail: `TerraGuard Risk Status: ${prevRisk.status} → ${currRisk.status}`,
            material: true,
        });
    }
    return changes;
}
// ===== risk.ts =====
/**
 * TerraGuard Risk Engine — Terra Guard's OWN classification.
 *
 * Always labeled "TERRAGUARD RISK STATUS". Never called a PAGASA level.
 * Extractive keyword scoring over official PAGASA text; per-category caps
 * prevent blind summation; force rules elevate high-impact hazards.
 */
const ORDER = ["LOW", "ELEVATED", "MODERATE", "HIGH", "CRITICAL"];
function rank(s) {
    return ORDER.indexOf(s);
}
function atLeast(a, b) {
    return rank(a) >= rank(b) ? a : b;
}
function classify(score, thresholds = DEFAULT_RISK_CONFIG.thresholds) {
    if (score >= thresholds.critical)
        return "CRITICAL";
    if (score >= thresholds.high)
        return "HIGH";
    if (score >= thresholds.moderate)
        return "MODERATE";
    if (score >= thresholds.elevated)
        return "ELEVATED";
    return "LOW";
}
export function scoreAdvisory(parsed, previousStatus = null, riskConfigJson) {
    const cfg = resolveRiskConfig(riskConfigJson);
    const w = cfg.weights;
    // An explicitly-cleared page ("no active ...", "no gale warning") carries no
    // risk, even when the clearance sentence itself names a hazard.
    if (parsed.statesNoActive) {
        return { status: "LOW", score: 0, previousStatus, changed: previousStatus !== null && previousStatus !== "LOW", reasons: ["no active warning stated"] };
    }
    const t = (parsed.text ?? "").toLowerCase();
    const cat = { rainfall: 0, thunderstorm: 0, flood: 0, cyclone: 0, wind: 0, surge: 0, landslide: 0 };
    const reasons = [];
    // --- Rainfall ---
    if (/severe\/extreme|extreme rainfall|torrential/.test(t)) {
        cat.rainfall += w.rainSevere;
        reasons.push("severe/extreme rainfall information");
    }
    else if (/heavy rainfall|heavy rains|heavy to intense|intense rains|moderate to heavy/.test(t)) {
        cat.rainfall += w.rainHeavy;
        reasons.push("heavy rainfall advisory");
    }
    else if (/\brain\b|rains|showers/.test(t)) {
        cat.rainfall += w.rainGeneral;
        reasons.push("general rain possibility");
    }
    // --- Thunderstorm ---
    if (/significant thunderstorm|thunderstorm warning|thunderstorm advisory|severe thunderstorm/.test(t)) {
        cat.thunderstorm += w.thunderstormSignificant;
        reasons.push("significant thunderstorm warning");
    }
    else if (/thunderstorm|isolated rainshowers/.test(t)) {
        cat.thunderstorm += w.thunderstormPossible;
        reasons.push("thunderstorm possibility");
    }
    // --- Flood (PAGASA bulletin vocabulary) ---
    if (/critical flood/.test(t)) {
        cat.flood += w.floodCritical;
        reasons.push("critical flood warning");
    }
    else if (/flood warning|flood bulletin/.test(t)) {
        cat.flood += w.floodWarning;
        reasons.push("flood warning");
    }
    else if (/flood advisory|flood outlook|flood information|general flood advisory/.test(t)) {
        cat.flood += w.floodWatch;
        reasons.push("flood watch/advisory");
    }
    else if (/flash ?flood|flooding/.test(t)) {
        cat.flood += w.floodWatch;
        reasons.push("flooding mentioned");
    }
    // --- Tropical cyclone (highest applicable tier only — never stacked) ---
    const category = (parsed.cycloneCategory ?? "").toLowerCase();
    const cycloneTier = /super typhoon/.test(category) || /super typhoon/.test(t) ? { v: w.superTyphoon, r: "super typhoon" }
        : /typhoon/.test(category) ? { v: w.typhoon, r: "typhoon" }
            : /severe tropical storm/.test(category) ? { v: w.sts, r: "severe tropical storm" }
                : /tropical storm/.test(category) ? { v: w.ts, r: "tropical storm" }
                    : /tropical depression/.test(category) ? { v: w.td, r: "tropical depression" }
                        : /low pressure area|\blpa\b/.test(t) ? { v: 1, r: "low pressure area" }
                            : null;
    if (cycloneTier) {
        cat.cyclone += cycloneTier.v;
        reasons.push(cycloneTier.r);
    }
    // --- Wind ---
    if (/severe wind|destructive winds|wind signal no\.?\s*[45]/.test(t)) {
        cat.wind += w.windSevere;
        reasons.push("severe wind hazard");
    }
    else if (/gale|strong winds|strong to gale|wind signal no\.?\s*[23]/.test(t)) {
        cat.wind += w.windStrong;
        reasons.push("strong/gale conditions");
    }
    else if (/moderate winds|wind signal no\.?\s*1|breezy|windy/.test(t)) {
        cat.wind += w.windModerate;
        reasons.push("moderate wind hazard");
    }
    // --- Storm surge / coastal ---
    if (/severe storm surge|life-threatening.*surge|surge of up to [3-9]/i.test(t)) {
        cat.surge += w.surgeSevere;
        reasons.push("severe storm surge");
    }
    else if (/storm surge/.test(t)) {
        cat.surge += w.surgeSignificant;
        reasons.push("significant storm surge");
    }
    else if (/coastal|rough seas|very rough seas|high seas|gale warning/.test(t)) {
        cat.surge += w.coastalHazard;
        reasons.push("coastal hazard");
    }
    // --- Landslide ---
    if (/very highly susceptible|highly susceptible.*landslide|significant.*landslide|landslide threat/.test(t)) {
        cat.landslide += w.landslideSignificant;
        reasons.push("significant landslide threat");
    }
    else if (/landslide|flash floods or landslides/.test(t)) {
        cat.landslide += w.landslidePotential;
        reasons.push("landslide potential");
    }
    // Per-category caps, then sum (no blind stacking across signals of one page).
    const capped = Math.min(cat.rainfall, cfg.caps.rainfall) +
        Math.min(cat.thunderstorm, cfg.caps.thunderstorm) +
        Math.min(cat.flood, cfg.caps.flood) +
        Math.min(cat.cyclone, cfg.caps.cyclone) +
        Math.min(cat.wind, cfg.caps.wind) +
        Math.min(cat.surge, cfg.caps.surge) +
        Math.min(cat.landslide, cfg.caps.landslide);
    let status = classify(capped, cfg.thresholds);
    // Force rules for high-impact hazards.
    const f = cfg.force;
    if (/critical flood/.test(t) && f.criticalFloodForces) {
        status = atLeast(status, f.criticalFloodForces);
        reasons.push("force rule: critical flood warning");
    }
    if ((/super typhoon/.test(category) || /super typhoon/.test(t)) && f.superTyphoonForces) {
        status = atLeast(status, f.superTyphoonForces);
        reasons.push("force rule: super typhoon");
    }
    if (/typhoon/.test(category) && /storm surge/.test(t) && f.typhoonWithSevereSurgeForces) {
        status = atLeast(status, f.typhoonWithSevereSurgeForces);
        reasons.push("force rule: typhoon with storm surge");
    }
    if (/flood warning/.test(t) && /heavy rainfall|heavy rains/.test(t) && f.floodWarningPlusHeavyRainForces) {
        status = atLeast(status, f.floodWarningPlusHeavyRainForces);
        reasons.push("force rule: flood warning with heavy rainfall");
    }
    return {
        status,
        score: capped,
        previousStatus,
        changed: previousStatus !== null && previousStatus !== status,
        reasons,
    };
}
export function overallStatus(statuses) {
    if (statuses.length === 0)
        return "LOW";
    return statuses.reduce((a, b) => (rank(a) >= rank(b) ? a : b), "LOW");
}
// ===== report.ts =====
/**
 * WEATHER NEWS / WEATHER ALERT / daily summary generation.
 *
 * Strict rules: PAGASA terminology only, source attribution on every report,
 * no predictions, no sensational wording, no facts beyond the parsed source.
 */
const DISCLAIMER = "Terra Guard Risk Status is an automated classification based on available official information and is not an official PAGASA warning.";
/** Guardrail: never emit sensational wording even if it appears upstream. */
const BANNED_PHRASES = [
    "catastrophe incoming",
    "disaster guaranteed",
    "people will die",
    "major disaster is coming",
];
export function sanitizeReport(text) {
    let out = text;
    for (const phrase of BANNED_PHRASES) {
        const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        out = out.replace(re, "[removed]");
    }
    return out;
}
const RISK_EMOJI = {
    LOW: "🟢",
    ELEVATED: "🔵",
    MODERATE: "🟡",
    HIGH: "🟠",
    CRITICAL: "🔴",
};
function titleCase(s) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
/** One-line signal summary for the narrative (full area list stays below). */
function signalSummary(signals) {
    const list = signals ?? [];
    if (list.length === 0)
        return null;
    const top = Math.max(...list.map((s) => s.level));
    const count = new Set(list.flatMap((s) => s.areas)).size;
    return `Wind Signal No. ${top} is the highest signal raised${count > 0 ? `, covering ${count} area${count === 1 ? "" : "s"} (see list below)` : ""}.`;
}
/**
 * Extractive news narrative — composed strictly from fields the parser found
 * in the official source. Never adds facts, predictions, or color.
 */
function buildNarrative(parsed) {
    if (parsed.statesNoActive)
        return "PAGASA reports no active warning for this information type.";
    const parts = [];
    if (parsed.cycloneName && parsed.cycloneCategory) {
        parts.push(`PAGASA is monitoring ${titleCase(parsed.cycloneCategory)} ${parsed.cycloneName}.${parsed.cycloneMovement ? ` ${parsed.cycloneMovement}` : ""}`);
    }
    else if (parsed.cycloneCategory) {
        parts.push(`A ${parsed.cycloneCategory} is being monitored in the region.`);
    }
    const sig = signalSummary(parsed.signals);
    if (sig)
        parts.push(sig);
    else if (parsed.winds)
        parts.push(parsed.winds);
    if (parsed.rainfall)
        parts.push(parsed.rainfall);
    if (parsed.flood)
        parts.push(parsed.flood);
    if (parsed.surge)
        parts.push(parsed.surge);
    if (parsed.systems.length > 0)
        parts.push(`Weather systems in effect: ${parsed.systems.join(", ")}.`);
    return parts.length > 0 ? parts.join(" ") : "PAGASA has published updated official information.";
}
function bulletList(items, fallback, max = 15) {
    if (items.length === 0)
        return fallback;
    return items
        .slice(0, max)
        .map((a) => `• ${a}`)
        .join("\n");
}
function eventLabel(parsed) {
    if (parsed.cycloneName && parsed.cycloneCategory) {
        const cat = parsed.cycloneCategory.replace(/\b\w/g, (c) => c.toUpperCase());
        return `${cat} ${parsed.cycloneName} Update`;
    }
    if (parsed.cycloneCategory) {
        return `${parsed.cycloneCategory.replace(/\b\w/g, (c) => c.toUpperCase())} Update`;
    }
    if (parsed.title)
        return parsed.title;
    return "Weather Update";
}
function changeLines(changes) {
    const lines = changes.filter((c) => c.kind !== "advisory-updated").map((c) => `• ${c.detail}`);
    return lines.length > 0 ? lines.slice(0, 20).join("\n") : "• Advisory text refreshed with no material wording changes";
}
export function buildWeatherAlert(event) {
    const { parsed, risk, changes } = event;
    const emoji = RISK_EMOJI[risk.status] ?? "ℹ️";
    const text = [
        `${emoji} TERRAGUARD WEATHER ALERT ${emoji}`,
        "",
        `TERRAGUARD RISK STATUS: ${risk.status} ${emoji}`,
        "",
        "📌 EVENT",
        eventLabel(parsed),
        "",
        "📰 WHAT'S HAPPENING",
        buildNarrative(parsed),
        "",
        "🔄 CHANGES DETECTED",
        changeLines(changes),
        "",
        "📍 AFFECTED AREAS",
        bulletList(parsed.affectedAreas, "• No specific areas listed in the source"),
        "",
        "⚠️ PRIMARY RISKS",
        bulletList(parsed.hazards.map(titleCase), "• No specific hazards listed in the source"),
        "",
        "📡 SOURCE",
        SOURCE_ATTRIBUTION,
        "",
        "🕒 ISSUED",
        parsed.issuedAt || "As published by PAGASA (no issued time found on page)",
        "",
        DISCLAIMER,
    ].join("\n");
    return sanitizeReport(text);
}
export function buildWeatherNews(event) {
    const { parsed, risk } = event;
    const emoji = RISK_EMOJI[risk.status] ?? "ℹ️";
    const text = [
        `📰 TERRAGUARD WEATHER NEWS`,
        "",
        `TERRAGUARD RISK STATUS: ${risk.status} ${emoji}`,
        "",
        "📌 EVENT",
        eventLabel(parsed),
        "",
        "📰 WHAT'S HAPPENING",
        buildNarrative(parsed),
        "",
        "📍 AFFECTED AREAS",
        bulletList(parsed.affectedAreas, "• No specific areas listed in the source"),
        "",
        "⚠️ PRIMARY RISKS",
        bulletList(parsed.hazards.map(titleCase), "• No specific hazards listed in the source"),
        "",
        "📡 SOURCE",
        SOURCE_ATTRIBUTION,
        "",
        "🕒 ISSUED",
        parsed.issuedAt || "As published by PAGASA (no issued time found on page)",
        "",
        DISCLAIMER,
    ].join("\n");
    return sanitizeReport(text);
}
export function manilaDateLabel(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila",
        day: "2-digit",
        month: "long",
        year: "numeric",
    }).format(now);
    return parts.toUpperCase();
}
export function buildDailySummary(input) {
    const active = input.events.filter((e) => !e.parsed.statesNoActive);
    const cyclones = active.filter((e) => e.parsed.cycloneCategory);
    const warnings = active.filter((e) => e.risk.status === "HIGH" || e.risk.status === "CRITICAL");
    const floodLines = active.map((e) => e.parsed.flood).filter((f) => !!f);
    const systems = [...new Set(active.flatMap((e) => e.parsed.systems))];
    const hazards = [...new Set(active.flatMap((e) => e.parsed.hazards))];
    const areas = [...new Set(active.flatMap((e) => e.affectedAreas))].slice(0, 20);
    const notableChanges = active
        .flatMap((e) => e.changes.filter((c) => c.material).map((c) => `• ${c.detail}`))
        .slice(0, 10);
    const statusEmoji = RISK_EMOJI[input.overallStatus] ?? "ℹ️";
    const text = [
        `🌤️ TERRAGUARD WEATHER DESK ${statusEmoji}`,
        "",
        `📅 ${input.dateLabel}`,
        "",
        "🎯 OVERALL STATUS",
        input.previousOverall && input.previousOverall !== input.overallStatus
            ? `${RISK_EMOJI[input.previousOverall] ?? ""} ${input.previousOverall} → ${statusEmoji} ${input.overallStatus}`
            : `${statusEmoji} ${input.overallStatus}`,
        "",
        "🌦️ ACTIVE WEATHER SYSTEMS",
        bulletList(systems, "• None currently reported in available official information"),
        "",
        "🌀 TROPICAL CYCLONES",
        cyclones.length === 0
            ? "None currently affecting the Philippine Area of Responsibility. ✅"
            : bulletList(cyclones.map((e) => e.parsed.cycloneName
                ? `🌀 ${titleCase(e.parsed.cycloneCategory ?? "")} ${e.parsed.cycloneName}`
                : `🌀 ${titleCase(e.parsed.cycloneCategory ?? "")}`), "None currently affecting the Philippine Area of Responsibility."),
        "",
        "🚨 ACTIVE WARNINGS",
        warnings.length === 0
            ? "No HIGH or CRITICAL warnings currently in effect. ✅"
            : bulletList(warnings.map((e) => `${RISK_EMOJI[e.risk.status] ?? ""} ${e.normalized.title || e.normalized.sourceKey} (${e.risk.status})`), "None"),
        "",
        "🌊 FLOOD SITUATION",
        bulletList(floodLines, "• No flood bulletin currently reported"),
        "",
        "⚠️ MAIN HAZARDS",
        bulletList(hazards.map(titleCase), "• No specific hazards currently reported"),
        "",
        "📍 AREAS TO WATCH",
        bulletList(areas, "• No specific areas currently listed"),
        "",
        "🔄 IMPORTANT CHANGES",
        notableChanges.length > 0 ? notableChanges.join("\n") : "• No important changes since the previous summary",
        "",
        "📡 SOURCE",
        SOURCE_ATTRIBUTION,
        "",
        "This summary is automatically generated from available official information.",
        DISCLAIMER,
    ].join("\n");
    return sanitizeReport(text);
}
// ===== satellite image (JMA Himawari-9 true-color full disk, official) =====
const SAT_BASE = "https://www.data.jma.go.jp/mscweb/data/himawari/img/fd_/fd__tre_";
let satCache = { url: null, at: 0 };
/** Latest available 10-min slot (allowing ~25 min processing lag). */
async function resolveSatImage() {
    const now = Date.now() - 25 * 60 * 1000;
    for (let i = 0; i < 6; i++) {
        const t = new Date(now - i * 10 * 60 * 1000);
        const slot = `${String(t.getUTCHours()).padStart(2, "0")}${String(Math.floor(t.getUTCMinutes() / 10) * 10).padStart(2, "0")}`;
        const url = `${SAT_BASE}${slot}.jpg`;
        try {
            const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": FETCH_USER_AGENT }, redirect: "follow" });
            if (r.ok)
                return url;
        }
        catch { /* try an older slot */ }
    }
    return null;
}
async function getSatImage() {
    if (satCache.url && Date.now() - satCache.at < 20 * 60 * 1000)
        return satCache.url;
    const url = await resolveSatImage();
    satCache = { url, at: Date.now() };
    return url;
}
// ===== discord.ts =====
/**
 * Discord delivery via webhook secret (never hardcoded).
 * Messages are chunked to Discord's 2000-character limit.
 */
const RISK_COLOR = {
    LOW: 0x10b981,
    ELEVATED: 0x3b82f6,
    MODERATE: 0xf59e0b,
    HIGH: 0xef4444,
    CRITICAL: 0x7f1d1d,
};
function chunk(text, max = 1900) {
    if (text.length <= max)
        return [text];
    const lines = text.split("\n");
    const chunks = [];
    let current = "";
    for (const line of lines) {
        if ((current + "\n" + line).length > max && current) {
            chunks.push(current);
            current = line;
        }
        else {
            current = current ? `${current}\n${line}` : line;
        }
    }
    if (current)
        chunks.push(current);
    return chunks;
}
export async function sendDiscordReport(webhookUrl, title, text, risk, sourceUrl, sat) {
    if (!webhookUrl)
        throw new Error("DISCORD_WEBHOOK_URL not set");
    // sat === null disables the image; undefined auto-resolves the latest.
    const image = sat === null ? null : (sat || await getSatImage());
    const parts = chunk(text);
    for (let i = 0; i < parts.length; i++) {
        const payload = {
            content: parts[i],
            embeds: i === 0
                ? [
                    {
                        title: title.slice(0, 256),
                        color: RISK_COLOR[risk] ?? 0x3b82f6,
                        ...(image ? { image: { url: image } } : {}),
                        footer: { text: image ? "TerraGuard Weather Desk • DOST-PAGASA (source) • 🛰️ JMA Himawari imagery" : "TerraGuard Weather Desk • DOST-PAGASA (authoritative source)" },
                        timestamp: new Date().toISOString(),
                        url: sourceUrl || undefined,
                    },
                ]
                : [],
        };
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(`Discord webhook ${res.status}: ${t.slice(0, 300)}`);
        }
        if (i < parts.length - 1)
            await new Promise((r) => setTimeout(r, 500));
    }
}
// ===== store.ts =====
/**
 * KV-backed storage: dedup markers, processed events, snapshot, index, daily.
 */
const SNAPSHOT_KEY = "pagasa:snapshot";
const INDEX_KEY = "pagasa:index";
const LAST_DAILY_KEY = "pagasa:last-daily";
export async function getSnapshot(kv) {
    const raw = await kv.get(SNAPSHOT_KEY);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function putSnapshot(kv, snapshot) {
    await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: EVENT_TTL_SECONDS });
}
export async function hasSeenHash(kv, sourceKey, hash) {
    return (await kv.get(`pagasa:seen:${sourceKey}:${hash}`)) !== null;
}
export async function markSeenHash(kv, sourceKey, hash) {
    await kv.put(`pagasa:seen:${sourceKey}:${hash}`, "1", { expirationTtl: EVENT_TTL_SECONDS });
}
export async function putEvent(kv, event) {
    await kv.put(`pagasa:event:${event.id}`, JSON.stringify(event), { expirationTtl: EVENT_TTL_SECONDS });
}
export async function getEvent(kv, id) {
    const raw = await kv.get(`pagasa:event:${id}`);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function getIndex(kv) {
    const raw = await kv.get(INDEX_KEY);
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
export async function pushIndex(kv, event, max) {
    const index = await getIndex(kv);
    const entry = {
        id: event.id,
        sourceKey: event.normalized.sourceKey,
        title: event.normalized.title,
        type: event.normalized.advisoryType,
        issuedAt: event.normalized.issuedTime,
        risk: event.risk,
        storedAt: event.storedAt,
    };
    const next = [entry, ...index.filter((e) => e.id !== entry.id)].slice(0, max > 0 ? max : MAX_INDEX_DEFAULT);
    await kv.put(INDEX_KEY, JSON.stringify(next), { expirationTtl: EVENT_TTL_SECONDS });
    return next;
}
export async function getLastDaily(kv) {
    const raw = await kv.get(LAST_DAILY_KEY);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export async function putDaily(kv, dateKey, summaryText, overall) {
    await kv.put(`pagasa:daily:${dateKey}`, JSON.stringify({ date: dateKey, overall, text: summaryText }), {
        expirationTtl: DAILY_TTL_SECONDS,
    });
    await kv.put(LAST_DAILY_KEY, JSON.stringify({ date: dateKey, overall }), { expirationTtl: DAILY_TTL_SECONDS });
}
export async function getDaily(kv, dateKey) {
    return kv.get(`pagasa:daily:${dateKey}`);
}
const DAILY_CRONS = new Set(["0 23 * * *", "0 10 * * *"]);
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
// ---------------------------------------------------------------------------
// Monitor tick — every ~5 minutes, notify ONLY on new/material changes.
// ---------------------------------------------------------------------------
async function runMonitor(env) {
    const sources = resolveSources(env.PAGASA_SOURCES_JSON);
    const statusOn = new Map(sources.map((s) => [s.key, s.statusEnabled ?? s.notifyEnabled]));
    const countsTowardOverall = (key) => statusOn.get(key) ?? true;
    const existing = await getSnapshot(env.PAGASA_KV);
    const seedQuietly = env.SEED_QUIETLY === "1" && existing === null;
    const snapshot = existing ?? {
        updatedAt: new Date().toISOString(),
        overallStatus: "LOW",
        overallScore: 0,
        bySource: {},
    };
    let dirty = false;
    // Self-heal: if the snapshot is missing/empty but processed events exist
    // in KV (e.g. clobbered by an earlier tick), rebuild it from the index
    // instead of waiting for the next content change.
    if (Object.keys(snapshot.bySource).length === 0) {
        try {
            const idx = await getIndex(env.PAGASA_KV);
            for (const entry of idx) {
                const ev = await getEvent(env.PAGASA_KV, entry.id);
                if (ev && ev.normalized && ev.normalized.sourceKey && !snapshot.bySource[ev.normalized.sourceKey]) {
                    snapshot.bySource[ev.normalized.sourceKey] = ev;
                }
            }
            if (Object.keys(snapshot.bySource).length > 0)
                dirty = true;
        }
        catch {
            // index rebuild is best-effort; the next content change heals anyway
        }
    }
    const areaDelta = Math.max(1, parseInt(env.SIGNIFICANT_AREA_DELTA ?? "1", 10) || 1);
    const maxIndex = parseInt(env.MAX_EVENTS_INDEX ?? String(MAX_INDEX_DEFAULT), 10) || MAX_INDEX_DEFAULT;
    const outcomes = [];
    for (const source of sources) {
        try {
            const fetched = await fetchSource(source);
            if (!fetched.ok || !fetched.html) {
                outcomes.push(`${source.key}: fetch failed (${fetched.error ?? `HTTP ${fetched.status}`})`);
                continue;
            }
            const parsed = parseSource(fetched);
            const prev = snapshot.bySource[source.key] ?? null;
            const prevRisk = prev?.risk ?? null;
            const risk = scoreAdvisory(parsed, prevRisk?.status ?? null, env.RISK_CONFIG_JSON);
            // Risk output contract: { status, score, previousStatus, changed } (+reasons).
            const normalized = await buildNormalized(fetched, parsed);
            if (await hasSeenHash(env.PAGASA_KV, source.key, normalized.contentHash)) {
                outcomes.push(`${source.key}: duplicate (hash ${normalized.contentHash.slice(0, 8)})`);
                continue;
            }
            const changes = detectChanges(prev?.parsed ?? null, parsed, prevRisk, risk);
            const areaChangeCount = changes.filter((c) => c.kind === "area-added" || c.kind === "area-removed").length;
            const nonAreaMaterial = changes.some((c) => c.material && c.kind !== "area-added" && c.kind !== "area-removed");
            const areaSignificant = areaChangeCount >= areaDelta;
            const material = changes.some((c) => c.material) && (nonAreaMaterial || areaSignificant);
            const isMeaningfulNew = !prev && !parsed.statesNoActive;
            const shouldNotify = source.notifyEnabled && !seedQuietly && (isMeaningfulNew || material);
            const alertKinds = new Set(["signal-increased", "signal-decreased", "intensity-changed", "flood-escalated", "risk-increased", "new-advisory", "warning-cancelled", "movement-changed"]);
            // LOW-risk items are informational (WEATHER NEWS), never ALERTs.
            const deservesAlert = shouldNotify && risk.status !== "LOW" &&
                (risk.status === "HIGH" ||
                    risk.status === "CRITICAL" ||
                    changes.some((c) => c.material && alertKinds.has(c.kind)));
            const id = `${source.key}:${normalized.contentHash.slice(0, 12)}`;
            const storedAt = new Date().toISOString();
            const event = {
                id,
                normalized,
                parsed,
                affectedAreas: parsed.affectedAreas,
                risk: { status: risk.status, score: risk.score, previousStatus: risk.previousStatus, changed: risk.changed },
                changes,
                isNew: !prev,
                shouldNotify,
                reportKind: !shouldNotify ? "NONE" : deservesAlert ? "WEATHER ALERT" : "WEATHER NEWS",
                reportText: null,
                storedAt,
            };
            event.reportText =
                event.reportKind === "WEATHER ALERT"
                    ? buildWeatherAlert(event)
                    : event.reportKind === "WEATHER NEWS"
                        ? buildWeatherNews(event)
                        : null;
            await markSeenHash(env.PAGASA_KV, source.key, normalized.contentHash);
            await putEvent(env.PAGASA_KV, event);
            await pushIndex(env.PAGASA_KV, event, maxIndex);
            snapshot.bySource[source.key] = event;
            dirty = true;
            if (shouldNotify && event.reportText) {
                await sendDiscordReport(env.DISCORD_WEBHOOK_URL, `TerraGuard ${event.reportKind} — ${parsed.title || source.label}`, event.reportText, risk.status, source.url, env.PAGASA_SATELLITE === "0" ? null : undefined);
                outcomes.push(`${source.key}: sent ${event.reportKind} (${risk.status})`);
            }
            else {
                outcomes.push(`${source.key}: stored, no notify (${risk.status})`);
            }
        }
        catch (e) {
            outcomes.push(`${source.key}: error ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`);
        }
    }
    // Only persist when something actually changed. A duplicate-only tick must
    // never overwrite the snapshot — under KV eventual consistency the loaded
    // snapshot can be briefly stale/empty and rewriting it would erase state.
    if (dirty) {
        const actives = Object.values(snapshot.bySource);
        // Static portals (statusEnabled: false) never move the overall status.
        const counted = actives.filter((e) => countsTowardOverall(e.normalized.sourceKey));
        snapshot.overallStatus = overallStatus(counted.map((e) => e.risk.status));
        snapshot.overallScore = counted.reduce((n, e) => Math.max(n, e.risk.score), 0);
        snapshot.updatedAt = new Date().toISOString();
        await putSnapshot(env.PAGASA_KV, snapshot);
    }
    return outcomes.join("; ");
}
// ---------------------------------------------------------------------------
// Daily summary — 07:00 + 18:00 PHT, idempotent per date+slot.
// ---------------------------------------------------------------------------
function manilaSlot(now = new Date()) {
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" });
    const hour = parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", hour12: false }).format(now), 10);
    // 07:00 run fires at 23:00 UTC (manila hour 07); 18:00 run at 10:00 UTC (manila 18).
    const slot = hour < 12 ? "morning" : "evening";
    return { dateKey: fmt.format(now), slot };
}
async function runDaily(env) {
    const snapshot = await getSnapshot(env.PAGASA_KV);
    const statusOn = new Map(resolveSources(env.PAGASA_SOURCES_JSON).map((s) => [s.key, s.statusEnabled ?? s.notifyEnabled]));
    const all = snapshot ? Object.values(snapshot.bySource) : [];
    const events = all.filter((e) => (statusOn.get(e.normalized.sourceKey) ?? true));
    const { dateKey, slot } = manilaSlot();
    const dedupKey = `pagasa:daily-sent:${dateKey}:${slot}`;
    if (await env.PAGASA_KV.get(dedupKey))
        return `daily ${dateKey} ${slot}: already sent`;
    const prev = await getLastDaily(env.PAGASA_KV);
    const text = buildDailySummary({
        overallStatus: snapshot?.overallStatus ?? "LOW",
        events,
        previousOverall: prev?.overall ?? null,
        dateLabel: manilaDateLabel(),
    });
    await sendDiscordReport(env.DISCORD_WEBHOOK_URL, `TerraGuard Weather Desk — ${dateKey} ${slot}`, text, snapshot?.overallStatus ?? "LOW", "https://www.pagasa.dost.gov.ph/", env.PAGASA_SATELLITE === "0" ? null : undefined);
    await putDaily(env.PAGASA_KV, `${dateKey}-${slot}`, text, snapshot?.overallStatus ?? "LOW");
    await env.PAGASA_KV.put(dedupKey, "1", { expirationTtl: 60 * 60 * 30 });
    return `daily ${dateKey} ${slot}: sent (${snapshot?.overallStatus ?? "LOW"})`;
}
// ---------------------------------------------------------------------------
// Private HTTP surface — 404 for anyone without the bearer secret.
// ---------------------------------------------------------------------------
function authorized(request, env) {
    const secret = env.PAGASA_API_SECRET || env.CRON_SECRET;
    if (!secret)
        return false;
    if ((request.headers.get("Authorization") ?? "") === `Bearer ${secret}`)
        return true;
    // Quick browser testing: ?key=<secret> works like the Bearer header.
    // (Header auth stays the recommended way — URLs can linger in history.)
    try {
        return new URL(request.url).searchParams.get("key") === secret;
    }
    catch {
        return false;
    }
}
function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...CORS },
    });
}
async function handlePrivateApi(request, env, url) {
    if (url.pathname === "/trigger" || url.pathname === "/cron-webhook") {
        try {
            return json({ success: true, message: await runMonitor(env) });
        }
        catch (e) {
            return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
        }
    }
    if (url.pathname === "/trigger-daily") {
        try {
            return json({ success: true, message: await runDaily(env) });
        }
        catch (e) {
            return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
        }
    }
    if (url.pathname === "/api/pagasa/latest") {
        const snapshot = await getSnapshot(env.PAGASA_KV);
        if (!snapshot)
            return json({ success: true, data: null });
        return json({ success: true, data: snapshot });
    }
    if (url.pathname === "/api/pagasa/events") {
        const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
        const index = await getIndex(env.PAGASA_KV);
        return json({ success: true, count: Math.min(limit, index.length), data: index.slice(0, limit) });
    }
    if (url.pathname === "/api/pagasa/event") {
        const id = url.searchParams.get("id") ?? "";
        if (!id)
            return json({ success: false, error: "Missing ?id=" }, 400);
        const event = await getEvent(env.PAGASA_KV, id);
        if (!event)
            return json({ success: false, error: "Not found" }, 404);
        return json({ success: true, data: event });
    }
    if (url.pathname === "/api/pagasa/daily") {
        const { dateKey } = manilaSlot();
        const date = url.searchParams.get("date") ?? dateKey;
        const morning = await getDaily(env.PAGASA_KV, `${date}-morning`);
        const evening = await getDaily(env.PAGASA_KV, `${date}-evening`);
        const legacy = await getDaily(env.PAGASA_KV, date);
        return json({ success: true, date, data: { morning, evening, legacy } });
    }
    return new Response("Not Found", { status: 404, headers: CORS });
}
export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS")
            return new Response(null, { headers: CORS });
        if (!authorized(request, env))
            return new Response("Not Found", { status: 404, headers: CORS });
        return handlePrivateApi(request, env, new URL(request.url));
    },
    async scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
            try {
                const msg = DAILY_CRONS.has(event.cron) ? await runDaily(env) : await runMonitor(env);
                console.log(`[cron][pagasa][${event.cron}] ${msg}`);
            }
            catch (e) {
                console.error("[cron][pagasa] failed", e);
            }
        })());
    },
};
