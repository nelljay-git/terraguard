// TerraGuard all-hazard monitor: weather (PAGASA) + volcano (PHIVOLCS) + haze (ASMC).
// ONE worker, ONE cron set. See worker-webhook/TERRA_README.md.

// ===== weather (from pagasa.js) =====
const Weather = (() => {
// Combined from worker-webhook modules - see PAGASA_README.md
// ===== config.ts =====
/**
 * Source registry + risk configuration.
 *
 * Official DOST-PAGASA sources ONLY. To change/extend sources, edit
 * DEFAULT_SOURCES here or override via the PAGASA_SOURCES_JSON secret —
 * no parser/fetch rewrites needed.
 */
const SOURCE_ATTRIBUTION = "DOST-PAGASA";
/** Verified official PAGASA pages (Sept 2026). */
const DEFAULT_SOURCES = [
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
function resolveSources(envSourcesJson) {
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
const DEFAULT_RISK_CONFIG = {
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
function resolveRiskConfig(envJson) {
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
const FETCH_TIMEOUT_MS = 15000;
const FETCH_USER_AGENT = "TerraGuard-PAGASA-Monitor/1.0 (hazard-monitoring; contact: Terra Guard PH)";
const RAW_CONTENT_MAX_CHARS = 12000;
const EVENT_TTL_SECONDS = 60 * 60 * 24 * 30;
const DAILY_TTL_SECONDS = 60 * 60 * 24 * 90;
const MAX_INDEX_DEFAULT = 100;
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
function fetchTropicalCycloneBulletin(source) {
    return fetchPage(source);
}
function fetchTropicalCycloneAdvisory(source) {
    return fetchPage(source);
}
function fetchSevereWeatherBulletin(source) {
    return fetchPage(source);
}
function fetchWeatherAdvisory(source) {
    return fetchPage(source);
}
function fetchForecastConditions(source) {
    return fetchPage(source);
}
function fetchHeavyRainfall(source) {
    return fetchPage(source);
}
function fetchFloodInfo(source) {
    return fetchPage(source);
}
function fetchGaleWarning(source) {
    return fetchPage(source);
}
function fetchThunderstormInfo(source) {
    return fetchPage(source);
}
function fetchMonsoonInfo(source) {
    return fetchPage(source);
}
function fetchGeneralAdvisory(source) {
    return fetchPage(source);
}
/** Dispatch a configured source to its dedicated fetcher. */
function fetchSource(source) {
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
function htmlToText(html) {
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
function parseTropicalCycloneBulletin(result, text) {
    return withAreaFallback(baseParse(result, text, "Tropical Cyclone Bulletin"), text);
}
/** Tropical Cyclone Advisory (outside-PAR / outlook family). */
function parseTropicalCycloneAdvisory(result, text) {
    return withAreaFallback(baseParse(result, text, "Tropical Cyclone Advisory"), text);
}
/** Severe Weather Bulletin (legacy/alternate TC bulletin path). */
function parseSevereWeatherBulletin(result, text) {
    return withAreaFallback(baseParse(result, text, "Severe Weather Bulletin"), text);
}
/** Weather Advisory (incl. heavy-rainfall outlooks). */
function parseWeatherAdvisory(result, text) {
    const parsed = baseParse(result, text, "Weather Advisory");
    if (!parsed.rainfall)
        parsed.rainfall = extractLine(text, /monsoon|rainfall|rains/i);
    return withAreaFallback(parsed, text);
}
/** Forecast Weather Conditions table page. */
function parseForecastConditions(result, text) {
    return withAreaFallback(baseParse(result, text, "Forecast Weather Conditions"), text);
}
/** Heavy Rainfall Warning page family. */
function parseHeavyRainfall(result, text) {
    return withAreaFallback(baseParse(result, text, "Heavy Rainfall Warning"), text);
}
/** Flood Information / General Flood Advisory family. */
function parseFloodInfo(result, text) {
    const parsed = baseParse(result, text, "Flood Information");
    if (!parsed.flood)
        parsed.flood = extractLine(text, /river|water ?level|dam|discharge/i);
    return withAreaFallback(parsed, text);
}
/** Gale Warning (marine) family. */
function parseGaleWarning(result, text) {
    return withAreaFallback(baseParse(result, text, "Gale Warning"), text);
}
/** Thunderstorm information family. */
function parseThunderstormInfo(result, text) {
    return withAreaFallback(baseParse(result, text, "Thunderstorm Information"), text);
}
/** Monsoon information family. */
function parseMonsoonInfo(result, text) {
    return withAreaFallback(baseParse(result, text, "Monsoon Information"), text);
}
/** Generic fallback — never invents structure, only shared extractors. */
function parseGeneric(result, text) {
    return withAreaFallback(baseParse(result, text, "PAGASA Advisory"), text);
}
/** Dispatch a fetch result to its dedicated parser. */
function parseSource(result) {
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
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/philippine standard time.*/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
async function sha256Hex(input) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function buildNormalized(result, parsed) {
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
function detectChanges(prev, curr, prevRisk, currRisk) {
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
            detail: `Terra Guard PH Risk Status: ${prevRisk.status} → ${currRisk.status}`,
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
function scoreAdvisory(parsed, previousStatus = null, riskConfigJson) {
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
function overallStatus(statuses) {
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
function sanitizeReport(text) {
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
function buildWeatherAlert(event) {
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
function buildWeatherNews(event) {
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
// ===== facebook weather + cyclone posts (same notify gate as Discord) =====
// Static branded images (public/ on the site): WEATHER REPORT for the daily
// forecast, CYCLONE REPORT for tropical cyclone bulletins. Only these two
// sources post to Facebook; the rest stay Discord-only.
const WEATHER_REPORT_IMG = "https://terraguard-ph.pages.dev/image-weather-report.png";
const CYCLONE_REPORT_IMG = "https://terraguard-ph.pages.dev/image-cyclone-report.png";
function weatherFbSlot(sourceKey) {
    if (sourceKey === "forecast") return { image: WEATHER_REPORT_IMG, kind: "weather" };
    if (sourceKey === "tc-bulletin") return { image: CYCLONE_REPORT_IMG, kind: "cyclone" };
    return null;
}
// First ~600 chars of the PAGASA "Synopsis" paragraph from raw page text.
function extractSynopsis(text) {
    const t = String(text ?? "");
    const m = /synopsis\s*([\s\S]+?)(?=forecast weather conditions|tc information|forecast wind|temperature and relative|tides and astronomical|$)/i.exec(t);
    const s = (m ? m[1] : "").replace(/\s+/g, " ").trim();
    if (s.length < 40) return "";
    return s.length > 600 ? s.slice(0, 600).trimEnd() + "…" : s;
}
// Bulletin number from title/text ("Bulletin #5", "Bulletin No. 5").
function cycloneBulletinNo(parsed) {
    const m = /(?:bulletin|advisory)\s*(?:no\.?|#|number)?\s*(\d+)/i.exec(`${parsed.title ?? ""}\n${parsed.text ?? ""}`);
    return m ? m[1] : "";
}
function cycloneLocationLine(text) {
    const m = /location[^:\n]{0,40}:\s*([^.\n]{10,220})/i.exec(String(text ?? ""));
    return m ? m[1].replace(/\s+/g, " ").trim() : "";
}
function nextBulletinLine(text) {
    const m = /next bulletin[^.\n]*/i.exec(String(text ?? ""));
    return m ? m[0].replace(/\s+/g, " ").trim() : "";
}
function signalFbLines(signals) {
    const list = (signals ?? []).slice().sort((a, b) => a.level - b.level);
    const out = [];
    for (const s of list) {
        const areas = (s.areas ?? []).slice(0, 8).join(", ");
        const extra = (s.areas ?? []).length > 8 ? ` (+${(s.areas ?? []).length - 8} more)` : "";
        out.push(`• Signal No. ${s.level}${areas ? ` — ${areas}` : ""}${extra}`);
    }
    return out;
}
function buildWeatherFbMessage(event, source) {
    const { parsed } = event;
    const issued = parsed.issuedAt || "latest PAGASA update";
    const synopsis = extractSynopsis(parsed.text) || buildNarrative(parsed);
    const lines = [
        `⛅ WEATHER UPDATE: ${issued} | Daily Weather Forecast | TerraGuard`,
        "",
        `🕐 Issued: ${issued}`,
        "",
        "📡 SYNOPSIS",
        synopsis,
    ];
    if (parsed.cycloneName && parsed.cycloneCategory) {
        lines.push("", "🌀 TROPICAL CYCLONE WATCH", `${titleCase(parsed.cycloneCategory)} ${parsed.cycloneName}.${parsed.cycloneMovement ? ` ${parsed.cycloneMovement}` : ""}${parsed.winds ? ` ${parsed.winds}` : ""}`);
    }
    else if (parsed.cycloneCategory) {
        lines.push("", "🌀 TROPICAL CYCLONE WATCH", buildNarrative(parsed));
    }
    const areas = (parsed.affectedAreas ?? []).slice(0, 10);
    if (areas.length > 0) {
        lines.push("", "🌧 FORECAST AREAS", ...areas.map((a) => `• ${a}`));
        if ((parsed.affectedAreas ?? []).length > 10)
            lines.push(`• (+${parsed.affectedAreas.length - 10} more areas in the full bulletin)`);
    }
    if (parsed.rainfall)
        lines.push("", "🌧 RAINFALL", parsed.rainfall);
    if (parsed.systems && parsed.systems.length > 0)
        lines.push("", "🌦️ SYSTEMS", `In effect: ${parsed.systems.join(", ")}.`);
    lines.push("", "Source: PAGASA", `Bulletin: ${source.url}`, "", "Join our discord for discussions: https://discord.gg/tdGrvnvehP", "", "#Weather #PAGASA #TerraGuardPH #StaySafe");
    return sanitizeReport(lines.join("\n"));
}
function buildCycloneFbMessage(event, source) {
    const { parsed } = event;
    const no = cycloneBulletinNo(parsed);
    const name = [parsed.cycloneCategory ? titleCase(parsed.cycloneCategory) : "", parsed.cycloneName || ""].filter(Boolean).join(" ") || "Tropical Cyclone";
    const issued = parsed.issuedAt || "latest PAGASA update";
    const lines = [
        `🌀 TROPICAL CYCLONE BULLETIN${no ? ` NO. ${no}` : ""}: ${name} - ${issued} | TerraGuard`,
        "",
    ];
    const loc = cycloneLocationLine(parsed.text);
    if (loc)
        lines.push(`📍 ${loc}`);
    if (parsed.cycloneMovement)
        lines.push(`🧭 ${parsed.cycloneMovement}`);
    if (parsed.winds)
        lines.push(`💨 ${parsed.winds}`);
    const sigs = signalFbLines(parsed.signals);
    if (sigs.length > 0)
        lines.push("", "🚨 WIND SIGNALS", ...sigs);
    else if ((parsed.affectedAreas ?? []).length > 0)
        lines.push("", "📍 AREAS", ...(parsed.affectedAreas ?? []).slice(0, 10).map((a) => `• ${a}`));
    if (parsed.rainfall)
        lines.push("", "🌧 RAINFALL", parsed.rainfall);
    if (parsed.surge)
        lines.push("", "🌊 STORM SURGE & SEAS", parsed.surge);
    const next = nextBulletinLine(parsed.text);
    if (next)
        lines.push("", `⏭ ${next}`);
    lines.push("", "Source: PAGASA", `Bulletin: ${source.url}`, "", "Join our discord for discussions: https://discord.gg/tdGrvnvehP", "", "#TropicalCyclone #PAGASA #TerraGuardPH #StaySafe");
    return sanitizeReport(lines.join("\n"));
}
async function postWeatherToFacebook(event, source, env) {
    const slot = weatherFbSlot(event.normalized?.sourceKey ?? source.key);
    if (!slot)
        return "skipped (no FB slot for source)";
    if ((env.PAGASA_FB ?? "1") === "0")
        return "skipped (PAGASA_FB=0)";
    if (event.parsed?.statesNoActive)
        return "skipped (no active warning)";
    const pageId = (env.FB_PAGE_ID ?? "").trim();
    const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
    if (!pageId || !userToken)
        return "skipped (FB_PAGE_ID / FB_USER_ACCESS_TOKEN not set)";
    let pageToken = await fbPageToken(env);
    if (!pageToken)
        pageToken = userToken; // stored token may already be a Page token
    const proof = await fbAppSecretProof(pageToken, (env.FB_APP_SECRET ?? "").trim());
    const withProof = (params) => {
        if (proof)
            params.appsecret_proof = proof;
        return params;
    };
    const message = slot.kind === "cyclone" ? buildCycloneFbMessage(event, source) : buildWeatherFbMessage(event, source);
    // Static branded image — plain file on Pages, no card warmup needed.
    try {
        const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(withProof({ access_token: pageToken, caption: message, url: slot.image })),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.post_id || data.id))
            return `posted photo ${data.post_id ?? data.id}`;
        console.error(`[fb][pagasa] photo post failed: ${String(data?.error?.message ?? `HTTP ${res.status}`).slice(0, 300)}`);
    }
    catch (e) {
        console.error("[fb][pagasa] photo post exception", e instanceof Error ? e.message : String(e));
    }
    try {
        const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/feed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(withProof({ access_token: pageToken, message, link: source.url })),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.id)
            return `error ${data?.error?.message ?? `HTTP ${res.status}`}`.slice(0, 200);
        return `posted ${data.id}`;
    }
    catch (e) {
        return `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
}
function manilaDateLabel(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila",
        day: "2-digit",
        month: "long",
        year: "numeric",
    }).format(now);
    return parts.toUpperCase();
}
function buildDailySummary(input) {
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
async function sendDiscordReport(webhookUrl, title, text, risk, sourceUrl, sat, footer) {
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
                        footer: { text: footer || (image ? "TerraGuard Weather Desk • DOST-PAGASA (source) • 🛰️ JMA Himawari imagery" : "TerraGuard Weather Desk • DOST-PAGASA (authoritative source)") },
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
async function getSnapshot(kv) {
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
async function putSnapshot(kv, snapshot) {
    await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: EVENT_TTL_SECONDS });
}
async function hasSeenHash(kv, sourceKey, hash) {
    return (await kv.get(`pagasa:seen:${sourceKey}:${hash}`)) !== null;
}
async function markSeenHash(kv, sourceKey, hash) {
    await kv.put(`pagasa:seen:${sourceKey}:${hash}`, "1", { expirationTtl: EVENT_TTL_SECONDS });
}
async function putEvent(kv, event) {
    await kv.put(`pagasa:event:${event.id}`, JSON.stringify(event), { expirationTtl: EVENT_TTL_SECONDS });
}
async function getEvent(kv, id) {
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
async function getIndex(kv) {
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
async function pushIndex(kv, event, max) {
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
async function getLastDaily(kv) {
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
async function putDaily(kv, dateKey, summaryText, overall) {
    await kv.put(`pagasa:daily:${dateKey}`, JSON.stringify({ date: dateKey, overall, text: summaryText }), {
        expirationTtl: DAILY_TTL_SECONDS,
    });
    await kv.put(LAST_DAILY_KEY, JSON.stringify({ date: dateKey, overall }), { expirationTtl: DAILY_TTL_SECONDS });
}
async function getDaily(kv, dateKey) {
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
                // Facebook: daily forecast + cyclone bulletins only, same
                // notify gate. Never throws, never blocks the loop.
                try {
                    const fbStatus = await postWeatherToFacebook(event, source, env);
                    outcomes.push(`${source.key}: fb ${fbStatus}`);
                }
                catch (e) {
                    outcomes.push(`${source.key}: fb error ${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}`);
                }
                // Discord mirror: the same FB template + branded image, in
                // addition to the technical report above. Same gate, same
                // never-throw contract.
                try {
                    const slot = weatherFbSlot(source.key);
                    if (slot && !event.parsed?.statesNoActive) {
                        const fbMessage = slot.kind === "cyclone" ? buildCycloneFbMessage(event, source) : buildWeatherFbMessage(event, source);
                        const fbTitle = slot.kind === "cyclone" ? "TerraGuard Cyclone Report" : "TerraGuard Weather Report";
                        await sendDiscordReport(env.DISCORD_WEBHOOK_URL, fbTitle, fbMessage, risk.status, source.url, slot.image, "TerraGuard • DOST-PAGASA (authoritative source)");
                        outcomes.push(`${source.key}: discord mirror sent`);
                    }
                }
                catch (e) {
                    outcomes.push(`${source.key}: discord mirror error ${e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120)}`);
                }
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

return { runMonitor, runDaily, getSnapshot, getIndex, getEvent, getDaily, manilaSlot };
})();

// ===== volcano (from volcano.js) =====
const Volcano = (() => {
/**
 * Terra Guard PH — PHIVOLCS Volcano Monitoring (PRIVATE, not for public use).
 *
 * Single-file Cloudflare Worker. PHIVOLCS is the authoritative source; this
 * worker only retrieves, organizes, analyzes, classifies, and summarizes
 * official DOST-PHIVOLCS information. Nothing here is rendered by the public
 * website. Every HTTP route requires Authorization: Bearer <secret> or
 * ?key=<secret>; anything else gets 404.
 *
 * Sources (official only, change in VOLCANO_SOURCES_JSON without code edits):
 *   - PHIVOLCS-LAVA hub (alert ticker + latest bulletin per observatory)
 *   - Per-volcano bulletin category pages (English bulletins only)
 *
 * Cron: every 10 min (see wrangler-volcano.toml). Notifies on Discord ONLY on:
 *   new bulletin with level change, alert level up/down, escalation keywords,
 *   or first sighting. Routine same-level daily bulletins are stored silently
 *   unless VOLCANO_DAILY_BRIEF=1.
 */

// ===== config =====
const SOURCE_ATTRIBUTION = "DOST-PHIVOLCS";
const FETCH_TIMEOUT_MS = 15000;
const FETCH_USER_AGENT = "TerraGuard-Volcano-Monitor/1.0 (hazard-monitoring; Terra Guard PH)";
const EVENT_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_INDEX = 100;

const DEFAULT_SOURCES = [
    {
        key: "lava-hub",
        type: "lava-hub",
        label: "PHIVOLCS-LAVA Volcano Status",
        url: "https://wovodat.phivolcs.dost.gov.ph/bulletin/list-of-bulletin",
        notifyEnabled: true,
    },
];
// NOTE (verified Sept 2026): the old Joomla category URLs
// (phivolcs.dost.gov.ph/index.php/volcano-hazard/volcano-bulletin2/...)
// now 301-redirect to slugs that 404 — the site migrated to WordPress.
// The LAVA hub already discovers every active volcano's latest bulletin,
// so it is the sole default source. The `volcano-category` type still works
// for any live category URL added later via VOLCANO_SOURCES_JSON.

function resolveSources(json) {
    if (!json)
        return DEFAULT_SOURCES;
    try {
        const parsed = JSON.parse(json);
        const valid = Array.isArray(parsed)
            ? parsed.filter((s) => s && typeof s.key === "string" && typeof s.url === "string" && typeof s.type === "string")
            : [];
        return valid.length > 0 ? valid : DEFAULT_SOURCES;
    }
    catch {
        return DEFAULT_SOURCES;
    }
}

/** PHIVOLCS Alert Level -> TerraGuard's own risk status (configurable). */
const DEFAULT_LEVEL_RISK = { 0: "LOW", 1: "ELEVATED", 2: "MODERATE", 3: "HIGH", 4: "CRITICAL", 5: "CRITICAL" };

function resolveLevelRisk(json) {
    if (!json)
        return DEFAULT_LEVEL_RISK;
    try {
        const parsed = JSON.parse(json);
        return { ...DEFAULT_LEVEL_RISK, ...parsed };
    }
    catch {
        return DEFAULT_LEVEL_RISK;
    }
}

const OBS_CODE_TO_VOLCANO = { tvo: "TAAL", kvo: "KANLAON", bvo: "BULUSAN", mvo: "MAYON", pvo: "PINATUBO" };
const VOLCANO_TO_OBS = { TAAL: "TVO", KANLAON: "KVO", BULUSAN: "BVO", MAYON: "MVO", PINATUBO: "PVO" };
const MONTH_NUM = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };

/**
 * Per-bulletin map image. Preferred: the bulletinMap file referenced in the
 * article HTML. Fallback: constructed OBScodeYYYY-MM-DD.jpg from the issued
 * date (caller verifies with HEAD before attaching).
 */
function bulletinMapUrl(html, volcano, issuedAt) {
    const m = /bulletinMap\/([A-Za-z0-9_.-]+\.jpe?g)/i.exec(html);
    if (m)
        return `https://wovodat.phivolcs.dost.gov.ph/img/bulletinMap/${m[1]}`;
    const code = VOLCANO_TO_OBS[volcano];
    const d = /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i.exec(issuedAt ?? "");
    if (code && d) {
        const mm = MONTH_NUM[d[2].toLowerCase()];
        const dd = String(parseInt(d[1], 10)).padStart(2, "0");
        return `https://wovodat.phivolcs.dost.gov.ph/img/bulletinMap/${code}${d[3]}-${mm}-${dd}.jpg`;
    }
    return null;
}

async function urlOk(url) {
    try {
        const r = await fetch(url, { method: "HEAD", headers: { "User-Agent": FETCH_USER_AGENT }, redirect: "follow" });
        return r.ok;
    }
    catch {
        return false;
    }
}

// ===== fetch =====
async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": FETCH_USER_AGENT, Accept: "text/html,application/xhtml+xml" },
            redirect: "follow",
        });
        if (!res.ok)
            return { ok: false, status: res.status, html: "", error: `HTTP ${res.status}` };
        return { ok: true, status: res.status, html: await res.text() };
    }
    catch (e) {
        return { ok: false, status: 0, html: "", error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) };
    }
    finally {
        clearTimeout(timer);
    }
}

// ===== parse =====
function htmlToText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<header[\s\S]*?<\/header>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .filter((l) => l.length > 0)
        .join("\n")
        .trim();
}

/** "Taal - 1" ticker spans on the LAVA hub page. */
function parseTicker(html) {
    const levels = {};
    const region = html.split("Alert Level Status:")[1] ?? html;
    const clipped = region.split("notice-row")[0];
    const re = />([A-Za-z ]+?)\s*-\s*([0-5])</g;
    let m;
    while ((m = re.exec(clipped)) !== null) {
        const name = m[1].trim().toUpperCase();
        if (name.length >= 3 && name.length <= 20)
            levels[name] = parseInt(m[2], 10);
    }
    return levels;
}

/** Latest English bulletin links per observatory on the LAVA hub. */
function parseHubBids(html) {
    const bids = {};
    const re = /href="(\/bulletin\/activity-([a-z]+)\?bid=(\d+))"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const code = m[2].toLowerCase();
        const volcano = OBS_CODE_TO_VOLCANO[code];
        if (volcano && !bids[volcano])
            bids[volcano] = { code, bid: m[3], url: `https://wovodat.phivolcs.dost.gov.ph${m[1]}&lang=en` };
    }
    return bids;
}

/** Latest English ("Summary of 24Hr Observation") article on a category page. */
function parseCategoryLatest(html, pageUrl) {
    const re = /href="([^"]+?volcano-bulletin2\/[a-z-]*volcano\/\d+-[a-z0-9-]*summary-of-24hr-observation[^"]*)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const href = m[1];
        if (/bulkan/i.test(href))
            continue; // Filipino edition — English only
        try {
            return new URL(href, pageUrl).toString();
        }
        catch {
            return href;
        }
    }
    return null;
}

function firstLine(text, re) {
    const line = text.split("\n").find((l) => re.test(l));
    return line ? line.trim().slice(0, 400) : null;
}
/**
 * Parameter tables put the label ("Plume") and value ("500 meters...")
 * on separate lines. Returns the value line when the label stands alone.
 */
function fieldValue(text, labelRe) {
    const lines = text.split("\n");
    const i = lines.findIndex((l) => labelRe.test(l));
    if (i < 0)
        return null;
    const cur = lines[i].trim();
    const rest = cur.replace(labelRe, "").replace(/^[:\s-]+/, "").trim();
    if (rest.length > 3)
        return cur.slice(0, 200);
    const nxt = (lines[i + 1] ?? "").trim();
    return (nxt || cur).slice(0, 200);
}

/** @type {Array<[RegExp, string]>} */
const VOLCANO_HAZARD_KEYWORDS = [
    [/phreatic eruption/i, "phreatic eruptions"],
    [/lava flow|lava fountaining/i, "lava activity"],
    [/pyroclastic/i, "pyroclastic density currents"],
    [/ashfall|ash fall/i, "ashfall"],
    [/rockfall|landslide|avalanche/i, "rockfalls/landslides"],
    [/lahar/i, "lahars"],
    [/volcanic earthquake|volcano-tectonic/i, "volcanic earthquakes"],
    [/sulfur dioxide/i, "sulfur dioxide emission"],
];

/** Extractive bulletin parse — missing fields stay null/empty, never guessed. */
function parseBulletin(html, volcano, sourceUrl, bid) {
    const text = htmlToText(html);
    const title = firstLine(text, new RegExp(`${volcano} VOLCANO|Summary of 24Hr`, "i")) ?? `${volcano} Volcano Bulletin`;
    const levelMatch = /ALERT LEVEL\s*([0-5])/i.exec(text);
    const level = levelMatch ? parseInt(levelMatch[1], 10) : null;
    const trendMatch = /\(([^)]*(?:unrest|eruption|activity)[^)]*)\)/i.exec(text);
    const issued = firstLine(text, /Date:\s*\d/i) ?? "";
    const quakeMatch = /(\d+)\s+volcanic earthquakes?/i.exec(text);
    const so2Match = /([\d,]+)\s*tonnes\s*\/\s*day/i.exec(text);
    const plume = fieldValue(text, /^plume\b/i);
    const deformation = fieldValue(text, /ground deformation|inflation|deflation/i);
    const glow = fieldValue(text, /crater glow/i);
    const pdzMatch = /(\d+)-kilometer radius Permanent Danger Zone/i.exec(text);
    const hazards = [];
    for (const [re, name] of VOLCANO_HAZARD_KEYWORDS) {
        if (re.test(text) && !hazards.includes(name))
            hazards.push(name);
    }
    return {
        volcano,
        title,
        bid: bid ?? null,
        mapImg: bulletinMapUrl(html, volcano, issued.replace(/^Date:\s*/i, "")),
        alertLevel: level,
        trend: trendMatch ? trendMatch[1].trim().slice(0, 80) : null,
        issuedAt: issued.replace(/^Date:\s*/i, ""),
        quakes: quakeMatch ? parseInt(quakeMatch[1].replace(/,/g, ""), 10) : null,
        so2: so2Match ? so2Match[1] : null,
        plume: plume ? plume.slice(0, 200) : null,
        deformation: deformation ? deformation.slice(0, 200) : null,
        glow: glow ? glow.slice(0, 160) : null,
        pdzKm: pdzMatch ? parseInt(pdzMatch[1], 10) : null,
        hazards,
        text: text.slice(0, 12000),
        sourceUrl,
    };
}

// ===== normalize / hash =====
function normalizeText(text) {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}

async function sha256Hex(input) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ===== risk =====
const RISK_ORDER = ["LOW", "ELEVATED", "MODERATE", "HIGH", "CRITICAL"];

function levelToRisk(level, levelRisk) {
    if (level === null || level === undefined)
        return "LOW";
    return levelRisk[level] ?? "LOW";
}

/** Escalation keywords force at least HIGH regardless of alert level. */
function forceRisk(text, base) {
    const t = (text ?? "").toLowerCase();
    const rank = (s) => RISK_ORDER.indexOf(s);
    let status = base;
    const reasons = [];
    if (/ongoing eruption|eruption column|lava flow|lava fountaining|pyroclastic density current/i.test(t)) {
        if (rank(status) < rank("HIGH")) {
            status = "HIGH";
            reasons.push("force rule: eruptive activity described");
        }
    }
    return { status, reasons };
}

// ===== change =====
function detectVolcanoChanges(prev, curr) {
    const changes = [];
    if (!prev) {
        changes.push({ kind: "new-bulletin", detail: `New bulletin: ${curr.title}`, material: true });
        return changes;
    }
    if (prev.bid !== curr.bid && curr.bid) {
        changes.push({ kind: "new-bulletin", detail: `New bulletin: ${curr.title}`, material: false });
    }
    if (prev.alertLevel !== curr.alertLevel && curr.alertLevel !== null) {
        const up = (curr.alertLevel ?? 0) > (prev.alertLevel ?? 0);
        changes.push({
            kind: up ? "level-raised" : "level-lowered",
            detail: `Alert Level: ${prev.alertLevel ?? "?"} → ${curr.alertLevel} (${curr.volcano})`,
            material: true,
        });
    }
    if ((prev.trend ?? "") !== (curr.trend ?? "") && curr.trend) {
        changes.push({ kind: "trend-changed", detail: `Activity trend: ${curr.trend}`, material: false });
    }
    if (curr.text && /ongoing eruption|eruption column|ashfall|lava flow|pyroclastic/i.test(curr.text) &&
        !(prev.text && /ongoing eruption|eruption column|ashfall|lava flow|pyroclastic/i.test(prev.text))) {
        changes.push({ kind: "activity-escalated", detail: "Escalation keywords appeared (eruption/ashfall/lava/pyroclastic)", material: true });
    }
    return changes;
}

// ===== report =====
const DISCLAIMER = "Terra Guard Risk Status is an automated classification based on available official information and is not an official PHIVOLCS warning.";
const BANNED_PHRASES = ["catastrophe incoming", "disaster guaranteed", "people will die", "major disaster is coming"];
const RISK_EMOJI = { LOW: "🟢", ELEVATED: "🔵", MODERATE: "🟡", HIGH: "🟠", CRITICAL: "🔴" };

function sanitizeReport(text) {
    let out = text;
    for (const phrase of BANNED_PHRASES) {
        out = out.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[removed]");
    }
    return out;
}

function titleCase(s) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extractive narrative — only states what the bulletin contains. */
function buildNarrative(parsed) {
    const name = titleCase(parsed.volcano.toLowerCase());
    const parts = [];
    if (parsed.alertLevel !== null && parsed.alertLevel !== undefined) {
        parts.push(`PHIVOLCS places ${name} Volcano at Alert Level ${parsed.alertLevel}${parsed.trend ? ` (${parsed.trend})` : ""}.`);
    }
    const obs = [];
    if (parsed.quakes !== null)
        obs.push(`${parsed.quakes} volcanic earthquakes`);
    if (parsed.so2)
        obs.push(`sulfur dioxide flux of ${parsed.so2} tonnes/day`);
    if (parsed.plume)
        obs.push(parsed.plume.charAt(0).toLowerCase() + parsed.plume.slice(1));
    if (parsed.deformation)
        obs.push(parsed.deformation.charAt(0).toLowerCase() + parsed.deformation.slice(1));
    if (obs.length > 0)
        parts.push(`Latest 24-hour observation: ${obs.join("; ")}.`);
    if (parsed.pdzKm)
        parts.push(`Entry into the ${parsed.pdzKm}-kilometer radius Permanent Danger Zone is not allowed.`);
    return parts.length > 0 ? parts.join(" ") : "PHIVOLCS has published updated official information.";
}

function changeLines(changes) {
    const lines = changes.map((c) => `• ${c.detail}`);
    return lines.length > 0 ? lines.slice(0, 12).join("\n") : "• Bulletin text refreshed with no material wording changes";
}

function buildVolcanoAlert(event) {
    const { parsed, risk, changes } = event;
    const emoji = RISK_EMOJI[risk.status] ?? "ℹ️";
    const name = titleCase(parsed.volcano.toLowerCase());
    return sanitizeReport([
        `${emoji} TERRAGUARD VOLCANO ALERT ${emoji}`,
        "",
        `TERRAGUARD RISK STATUS: ${risk.status} ${emoji}`,
        "",
        "📌 VOLCANO",
        `🌋 ${name} Volcano — Alert Level ${parsed.alertLevel ?? "unknown"}`,
        "",
        "📰 WHAT'S HAPPENING",
        buildNarrative(parsed),
        "",
        "🔄 CHANGES DETECTED",
        changeLines(changes),
        "",
        "⚠️ POSSIBLE HAZARDS",
        parsed.hazards.length > 0 ? parsed.hazards.map((h) => `• ${titleCase(h)}`).join("\n") : "• No specific hazards listed in the source",
        "",
        "📡 SOURCE",
        SOURCE_ATTRIBUTION,
        "",
        "🕒 ISSUED",
        parsed.issuedAt || "As published by PHIVOLCS (no issued time found)",
        "",
        DISCLAIMER,
    ].join("\n"));
}

function buildVolcanoNews(event) {
    const { parsed, risk } = event;
    const emoji = RISK_EMOJI[risk.status] ?? "ℹ️";
    const name = titleCase(parsed.volcano.toLowerCase());
    return sanitizeReport([
        "📰 TERRAGUARD VOLCANO NEWS",
        "",
        `TERRAGUARD RISK STATUS: ${risk.status} ${emoji}`,
        "",
        "📌 VOLCANO",
        `🌋 ${name} Volcano — Alert Level ${parsed.alertLevel ?? "unknown"}`,
        "",
        "📰 WHAT'S HAPPENING",
        buildNarrative(parsed),
        "",
        "⚠️ POSSIBLE HAZARDS",
        parsed.hazards.length > 0 ? parsed.hazards.map((h) => `• ${titleCase(h)}`).join("\n") : "• No specific hazards listed in the source",
        "",
        "📡 SOURCE",
        SOURCE_ATTRIBUTION,
        "",
        "🕒 ISSUED",
        parsed.issuedAt || "As published by PHIVOLCS (no issued time found)",
        "",
        DISCLAIMER,
    ].join("\n"));
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

// ===== discord =====
const RISK_COLOR = { LOW: 0x10b981, ELEVATED: 0x3b82f6, MODERATE: 0xf59e0b, HIGH: 0xef4444, CRITICAL: 0x7f1d1d };

async function sendDiscord(webhookUrl, title, text, risk, sourceUrl, sat) {
    if (!webhookUrl)
        throw new Error("DISCORD_WEBHOOK_URL not set");
    // sat === null disables the image; undefined auto-resolves Himawari.
    const image = sat === null ? null : (sat || await getSatImage());
    const credit = !image ? "Terra Guard PH Volcano Watch • DOST-PHIVOLCS (authoritative source)"
        : /phivolcs/i.test(image) ? "Terra Guard PH Volcano Watch • DOST-PHIVOLCS (source) • 🗺️ PHIVOLCS bulletin map"
            : "Terra Guard PH Volcano Watch • DOST-PHIVOLCS (source) • 🛰️ JMA Himawari imagery";
    const chunks = text.length <= 1900 ? [text] : (() => {
        const lines = text.split("\n");
        const out = [];
        let cur = "";
        for (const line of lines) {
            if ((cur + "\n" + line).length > 1900 && cur) {
                out.push(cur);
                cur = line;
            }
            else {
                cur = cur ? `${cur}\n${line}` : line;
            }
        }
        if (cur)
            out.push(cur);
        return out;
    })();
    for (let i = 0; i < chunks.length; i++) {
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: chunks[i],
                    embeds: i === 0 ? [{
                        title: title.slice(0, 256),
                        color: RISK_COLOR[risk] ?? 0x3b82f6,
                        ...(image ? { image: { url: image } } : {}),
                        footer: { text: credit },
                        timestamp: new Date().toISOString(),
                        url: sourceUrl || undefined,
                    }] : [],
            }),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(`Discord webhook ${res.status}: ${t.slice(0, 200)}`);
        }
        if (i < chunks.length - 1)
            await new Promise((r) => setTimeout(r, 500));
    }
}

// ===== facebook (alerts + news, same notify gate as Discord) =====
// Env (same Cloudflare secrets as earthquake.js):
//   FB_PAGE_ID, FB_USER_ACCESS_TOKEN, FB_APP_ID, FB_APP_SECRET (proof).
// Photo post with the bulletin/Himawari image, /feed fallback.
// Best-effort: never throws, never blocks Discord.
const FB_GRAPH_VERSION = "v21.0";

async function fbAppSecretProof(accessToken, appSecret) {
    try {
        if (!accessToken || !appSecret || !crypto?.subtle)
            return null;
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken));
        return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    catch {
        return null;
    }
}

async function fbPageToken(env) {
    const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
    const pageId = (env.FB_PAGE_ID ?? "").trim();
    if (!userToken || !pageId)
        return null;
    try {
        const proof = await fbAppSecretProof(userToken, (env.FB_APP_SECRET ?? "").trim());
        const url = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/me/accounts`);
        url.searchParams.set("access_token", userToken);
        url.searchParams.set("fields", "id,name,access_token");
        url.searchParams.set("limit", "50");
        if (proof)
            url.searchParams.set("appsecret_proof", proof);
        const res = await fetch(url.toString());
        if (!res.ok)
            return null;
        const data = await res.json();
        const match = (data?.data ?? []).find((p) => String(p.id) === String(pageId));
        return match?.access_token ? String(match.access_token) : null;
    }
    catch {
        return null;
    }
}

function volcanoTag(name) {
    const clean = String(name ?? "").replace(/[^A-Za-z ]/g, " ").split(" ").map((w) => w.trim()).filter(Boolean);
    if (clean.length === 0)
        return "";
    return clean.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("") + "Volcano";
}

function buildVolcanoFbMessage(event) {
    const { parsed, risk, changes, reportKind } = event;
    const emoji = RISK_EMOJI[risk.status] ?? "ℹ️";
    const name = titleCase(parsed.volcano.toLowerCase());
    const kind = reportKind === "VOLCANO ALERT" ? "ALERT" : "NEWS";
    const tag = volcanoTag(parsed.volcano);
    return sanitizeReport([
        `${emoji} VOLCANO ${kind} | ${name.toUpperCase()} — Alert Level ${parsed.alertLevel ?? "unknown"}`,
        "",
        buildNarrative(parsed),
        "",
        "Changes detected:",
        changeLines(changes),
        "",
        "Possible hazards:",
        parsed.hazards.length > 0 ? parsed.hazards.map((h) => `• ${titleCase(h)}`).join("\n") : "• No specific hazards listed in the source",
        "",
        `Issued: ${parsed.issuedAt || "As published by PHIVOLCS"}`,
        `Details: ${event.sourceUrl || ""}`,
        "",
        `Source: ${SOURCE_ATTRIBUTION}`,
        "",
        "Join our discord for more informations: https://discord.gg/tdGrvnvehP",
        ["#Volcano", tag ? `#${tag}` : "", "#PHIVOLCS", "#TerraGuard", "#TerraGuardPH", "#Philippines", "#StaySafe", "#DisasterPreparedness"].filter(Boolean).join(" "),
    ].join("\n"));
}

async function postVolcanoToFacebook(event, imageUrl, env) {
    const pageId = (env.FB_PAGE_ID ?? "").trim();
    const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
    const appSecret = (env.FB_APP_SECRET ?? "").trim();
    if (!pageId || !userToken)
        return "skipped (FB_PAGE_ID / FB_USER_ACCESS_TOKEN not set)";
    let pageToken = await fbPageToken(env);
    if (!pageToken)
        pageToken = userToken; // stored token may already be a Page token
    const proof = await fbAppSecretProof(pageToken, appSecret);
    const withProof = (params) => {
        if (proof)
            params.appsecret_proof = proof;
        return params;
    };
    const message = buildVolcanoFbMessage(event);
    // 1) Preferred: designed volcano card.
    const { parsed, risk } = event;
    const cardParams = new URLSearchParams({
        volcano: titleCase(parsed.volcano.toLowerCase()),
        level: String(parsed.alertLevel ?? "?"),
        risk: risk.status,
        issued: parsed.issuedAt || "",
        quakes: parsed.quakes != null ? String(parsed.quakes) : "",
        so2: parsed.so2 ? String(parsed.so2) : "",
        pdz: parsed.pdzKm ? String(parsed.pdzKm) : "",
    }).toString();
    const cardUrl = `https://terraguard-ph.pages.dev/api/volcano-card?${cardParams}`;
    const photoUrls = [cardUrl];
    if (imageUrl)
        photoUrls.push(imageUrl); // bulletin map / Himawari as backup
    // Warm the designed card first (cold WASM/tiles/fonts make FB's image
    // scraper time out, silently downgrading to the backup image).
    const isCard = (u) => String(u).includes("/api/volcano-card");
    async function warmCard(url) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 18000);
                const r = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { "User-Agent": "TerraGuard-FB-Warmup/1.0" } });
                clearTimeout(t);
                if (r.ok)
                    return true;
                console.error(`[fb][volcano] card warmup ${r.status} (attempt ${attempt}): ${url.slice(0, 120)}`);
            }
            catch (e) {
                console.error(`[fb][volcano] card warmup failed (attempt ${attempt}): ${e instanceof Error ? e.message : String(e)}`);
            }
            await new Promise((r) => setTimeout(r, 1000));
        }
        return false;
    }
    for (const photoUrl of photoUrls) {
        if (isCard(photoUrl) && !(await warmCard(photoUrl))) {
            console.error("[fb][volcano] card not renderable, using backup image");
            continue;
        }
        try {
            const body = withProof({ access_token: pageToken, caption: message, url: photoUrl });
            const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/photos`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && (data.post_id || data.id))
                return `posted photo ${data.post_id ?? data.id}`;
            console.error(`[fb][volcano] photo post failed (${String(photoUrl).slice(0, 80)}): ${String(data?.error?.message ?? `HTTP ${res.status}`).slice(0, 300)}`);
            // try next image, then fall through to /feed fallback
        }
        catch (e) {
            console.error("[fb][volcano] photo post exception", e instanceof Error ? e.message : String(e));
        }
    }
    // 2) Fallback: plain feed post with link.
    try {
        const body = withProof({ access_token: pageToken, message, link: event.sourceUrl || undefined });
        const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/feed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.id)
            return `error ${data?.error?.message ?? `HTTP ${res.status}`}`.slice(0, 200);
        return `posted ${data.id}`;
    }
    catch (e) {
        return `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
}

// ===== store (KV keys are volcano:-prefixed; safe to share a namespace) =====
const SNAPSHOT_KEY = "volcano:snapshot";
const INDEX_KEY = "volcano:index";

async function kvGetJson(kv, key) {
    try {
        const raw = await kv.get(key);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}

// ===== monitor =====
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function overallStatus(statuses) {
    const order = RISK_ORDER;
    return statuses.reduce((a, b) => (order.indexOf(a) >= order.indexOf(b) ? a : b), "LOW");
}

async function processBulletin(env, kv, snapshot, volcano, bulletin, sourceKey, sourceUrl, notifyEnabled, dailyBrief) {
    const outcomes = [];
    const prev = snapshot.byVolcano[volcano] ?? null;
    const prevRisk = prev?.risk ?? null;
    const levelRisk = resolveLevelRisk(env.VOLCANO_RISK_JSON);
    const base = levelToRisk(bulletin.alertLevel, levelRisk);
    const forced = forceRisk(bulletin.text, base);
    const reasons = forced.reasons;
    const risk = {
        status: forced.status,
        score: bulletin.alertLevel ?? 0,
        previousStatus: prevRisk?.status ?? null,
        changed: !!prevRisk && prevRisk.status !== forced.status,
        ...(reasons.length > 0 ? { reasons } : {}),
    };
    const hash = await sha256Hex(`${volcano}\n${bulletin.alertLevel ?? "?"}\n${normalizeText(bulletin.title + "\n" + bulletin.text)}`);
    if (await kv.get(`volcano:seen:${volcano}:${bulletin.bid ?? "nobid"}:${hash.slice(0, 12)}`)) {
        return { outcomes: [`${volcano}: duplicate`], dirty: false };
    }
    const changes = detectVolcanoChanges(prev?.parsed ?? null, bulletin);
    const levelChanged = changes.some((c) => c.kind === "level-raised" || c.kind === "level-lowered");
    const escalated = changes.some((c) => c.kind === "activity-escalated");
    const isFirst = !prev;
    // Routine same-level daily bulletins stay silent unless daily brief mode.
    const newBulletin = changes.some((c) => c.kind === "new-bulletin");
    const notify = notifyEnabled && (levelChanged || escalated || isFirst || (dailyBrief && newBulletin));
    const id = `${volcano}:${hash.slice(0, 12)}`;
    const event = {
        id,
        volcano,
        sourceKey,
        sourceUrl,
        parsed: bulletin,
        risk: { status: risk.status, score: risk.score, previousStatus: risk.previousStatus, changed: risk.changed },
        changes,
        isNew: isFirst,
        shouldNotify: notify,
        reportKind: !notify ? "NONE" : (risk.status === "HIGH" || risk.status === "CRITICAL" || levelChanged || escalated) ? "VOLCANO ALERT" : "VOLCANO NEWS",
        reportText: null,
        storedAt: new Date().toISOString(),
    };
    event.reportText = event.reportKind === "VOLCANO ALERT" ? buildVolcanoAlert(event) : event.reportKind === "VOLCANO NEWS" ? buildVolcanoNews(event) : null;
    await kv.put(`volcano:seen:${volcano}:${bulletin.bid ?? "nobid"}:${hash.slice(0, 12)}`, "1", { expirationTtl: EVENT_TTL_SECONDS });
    await kv.put(`volcano:event:${id}`, JSON.stringify(event), { expirationTtl: EVENT_TTL_SECONDS });
    const index = (await kvGetJson(kv, INDEX_KEY)) ?? [];
    await kv.put(INDEX_KEY, JSON.stringify([{ id, volcano, title: bulletin.title, level: bulletin.alertLevel, risk: event.risk, storedAt: event.storedAt }, ...index.filter((e) => e.id !== id)].slice(0, MAX_INDEX)), { expirationTtl: EVENT_TTL_SECONDS });
    snapshot.byVolcano[volcano] = event;
    if (notify && event.reportText) {
        // Prefer the PHIVOLCS bulletin map; fall back to Himawari (auto).
        let sat = env.VOLCANO_SATELLITE === "0" ? null : undefined;
        if (sat === undefined && bulletin.mapImg && await urlOk(bulletin.mapImg))
            sat = bulletin.mapImg;
        await sendDiscord(env.DISCORD_WEBHOOK_URL, `TerraGuard ${event.reportKind} — ${titleCase(volcano.toLowerCase())} (Alert Level ${bulletin.alertLevel ?? "?"})`, event.reportText, risk.status, sourceUrl, sat);
        outcomes.push(`${volcano}: sent ${event.reportKind} (L${bulletin.alertLevel ?? "?"} ${risk.status})`);
        // Facebook auto-post — same notify gate. Best-effort, never throws.
        // Resolve the same image Discord used (bulletin map, else Himawari).
        let fbStatus = "skipped";
        try {
            let fbImage = typeof sat === "string" && sat ? sat : null;
            if (!fbImage && env.VOLCANO_SATELLITE !== "0")
                fbImage = await getSatImage().catch(() => null);
            fbStatus = await postVolcanoToFacebook(event, fbImage, env);
        }
        catch (e) {
            fbStatus = `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
        }
        console.log(`[fb][volcano] ${id}: ${fbStatus}`);
        event.fbStatus = fbStatus;
        await kv.put(`volcano:event:${id}`, JSON.stringify(event), { expirationTtl: EVENT_TTL_SECONDS });
        outcomes.push(`${volcano}: fb ${fbStatus}`);
    }
    else {
        outcomes.push(`${volcano}: stored, no notify (L${bulletin.alertLevel ?? "?"} ${risk.status})`);
    }
    return { outcomes, dirty: true };
}

async function runMonitor(env) {
    const kv = env.VOLCANO_KV;
    const sources = resolveSources(env.VOLCANO_SOURCES_JSON);
    const dailyBrief = env.VOLCANO_DAILY_BRIEF === "1";
    const snapshot = (await kvGetJson(kv, SNAPSHOT_KEY)) ?? { updatedAt: new Date().toISOString(), overallStatus: "LOW", byVolcano: {} };
    let dirty = false;
    const outcomes = [];
    // Self-heal an empty snapshot from stored events.
    if (Object.keys(snapshot.byVolcano).length === 0) {
        try {
            const index = (await kvGetJson(kv, INDEX_KEY)) ?? [];
            for (const entry of index) {
                const ev = await kvGetJson(kv, `volcano:event:${entry.id}`);
                if (ev && ev.volcano && !snapshot.byVolcano[ev.volcano])
                    snapshot.byVolcano[ev.volcano] = ev;
            }
            if (Object.keys(snapshot.byVolcano).length > 0)
                dirty = true;
        }
        catch { /* best-effort */ }
    }

    for (const source of sources) {
        try {
            if (source.type === "lava-hub") {
                const hub = await fetchText(source.url);
                if (!hub.ok || !hub.html) {
                    outcomes.push(`${source.key}: fetch failed (${hub.error ?? `HTTP ${hub.status}`})`);
                    continue;
                }
                // Discover first: volcanoes with bulletin links are owned by the
                // article path below; the ticker only owns level-only volcanoes.
                const bids = parseHubBids(hub.html);
                const ticker = parseTicker(hub.html);
                for (const [volcano, level] of Object.entries(ticker)) {
                    if (bids[volcano])
                        continue;
                    const prev = snapshot.byVolcano[volcano];
                    const prevLevel = prev?.parsed?.alertLevel ?? null;
                    if (prev && prevLevel === level)
                        continue;
                    const pseudo = {
                        volcano, title: `${titleCase(volcano.toLowerCase())} Volcano Status`, bid: null,
                        alertLevel: level, trend: null, issuedAt: "", quakes: null, so2: null,
                        plume: null, deformation: null, glow: null, pdzKm: null, hazards: [],
                        text: `${volcano} alert level ${level}`, sourceUrl: source.url,
                    };
                    // Level-0 first sightings are pure baseline: store silently.
                    const audible = source.notifyEnabled && (level > 0 || prevLevel !== null);
                    const r = await processBulletin(env, kv, snapshot, volcano, pseudo, source.key, source.url, audible, dailyBrief);
                    outcomes.push(...r.outcomes);
                    dirty = dirty || r.dirty;
                }
                // Latest article per observatory (ticker level as fallback).
                for (const [volcano, info] of Object.entries(bids)) {
                    const art = await fetchText(info.url);
                    if (!art.ok || !art.html) {
                        outcomes.push(`${volcano}: article fetch failed (${art.error ?? `HTTP ${art.status}`})`);
                        continue;
                    }
                    const bulletin = parseBulletin(art.html, volcano, info.url, info.bid);
                    if (bulletin.alertLevel === null && ticker[volcano] !== undefined)
                        bulletin.alertLevel = ticker[volcano];
                    const r = await processBulletin(env, kv, snapshot, volcano, bulletin, source.key, info.url, source.notifyEnabled, dailyBrief);
                    outcomes.push(...r.outcomes);
                    dirty = dirty || r.dirty;
                }
            }
            else if (source.type === "volcano-category") {
                const page = await fetchText(source.url);
                if (!page.ok || !page.html) {
                    outcomes.push(`${source.key}: fetch failed (${page.error ?? `HTTP ${page.status}`})`);
                    continue;
                }
                const articleUrl = parseCategoryLatest(page.html, source.url);
                if (!articleUrl) {
                    outcomes.push(`${source.key}: no bulletin link found`);
                    continue;
                }
                const art = await fetchText(articleUrl);
                if (!art.ok || !art.html) {
                    outcomes.push(`${source.key}: article fetch failed (${art.error ?? `HTTP ${art.status}`})`);
                    continue;
                }
                const volcanoGuess = (/^([A-Z]+)\s+VOLCANO/i.exec(htmlToText(art.html)) ?? [])[1] ?? source.key.toUpperCase();
                const bidGuess = (/(\d{4,})-[a-z0-9-]*summary-of-24hr/i.exec(articleUrl) ?? [])[1] ?? null;
                const bulletin = parseBulletin(art.html, volcanoGuess, articleUrl, bidGuess);
                const r = await processBulletin(env, kv, snapshot, volcanoGuess, bulletin, source.key, articleUrl, source.notifyEnabled, dailyBrief);
                outcomes.push(...r.outcomes);
                dirty = dirty || r.dirty;
            }
            else {
                outcomes.push(`${source.key}: unknown type ${source.type}`);
            }
        }
        catch (e) {
            outcomes.push(`${source.key}: error ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`);
        }
    }

    if (dirty) {
        const actives = Object.values(snapshot.byVolcano);
        snapshot.overallStatus = overallStatus(actives.map((e) => e.risk.status));
        snapshot.updatedAt = new Date().toISOString();
        await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: EVENT_TTL_SECONDS });
    }
    return outcomes.join("; ");
}

// ===== private HTTP surface (404 without the secret) =====
function authorized(request, env) {
    const secret = env.VOLCANO_API_SECRET || env.CRON_SECRET;
    if (!secret)
        return false;
    if ((request.headers.get("Authorization") ?? "") === `Bearer ${secret}`)
        return true;
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


return { runMonitor, kvGet: kvGetJson, SNAPSHOT_KEY, INDEX_KEY };
})();

// ===== haze (from haze.js) =====
const Haze = (() => {
/**
 * Terra Guard PH — Transboundary Haze Monitoring (PRIVATE, not for public use).
 *
 * Single-file Cloudflare Worker. The ASEAN Specialised Meteorological Centre
 * (ASMC) is the authoritative source for regional haze; this worker only
 * retrieves, organizes, analyzes, classifies, and summarizes official ASMC
 * information. Nothing here is rendered by the public website. Every HTTP
 * route requires Authorization: Bearer <secret> or ?key=<secret>; anything
 * else gets 404.
 *
 * NOTE on DENR-EMB domestic AQI: air.emb.gov.ph renders station data
 * client-side with no server-side data or public feed (verified), so there
 * is no reliable official domestic feed to monitor. If EMB publishes one,
 * add it as a source in HAZE_SOURCES_JSON — no code change needed.
 *
 * Sources (official ASMC only):
 *   - asmc-home: daily "Latest Weather and Haze Situation" text
 *   - asmc-alerts: alert activation table (Level 1/2/3 per sub-region)
 *
 * Cron: every 30 min (see wrangler-haze.toml). Notifies on Discord ONLY on:
 *   alert level up/down, new alert activation, PH newly mentioned with haze,
 *   escalation wording, or first sighting. Routine daily refreshes store
 *   silently.
 */

// ===== config =====
const SOURCE_ATTRIBUTION = "ASMC – ASEAN Specialised Meteorological Centre";
const FETCH_TIMEOUT_MS = 15000;
const FETCH_USER_AGENT = "TerraGuard-Haze-Monitor/1.0 (hazard-monitoring; Terra Guard PH)";
const EVENT_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_INDEX = 100;

const DEFAULT_SOURCES = [
    {
        key: "asmc-home",
        type: "asmc-home",
        label: "ASMC Latest Weather and Haze Situation",
        url: "https://asmc.asean.org/home/",
        notifyEnabled: true,
    },
    {
        key: "asmc-alerts",
        type: "asmc-alerts",
        label: "ASMC Haze Alerts",
        url: "https://asmc.asean.org/asmc-alerts/",
        notifyEnabled: true,
    },
];

function resolveSources(json) {
    if (!json)
        return DEFAULT_SOURCES;
    try {
        const parsed = JSON.parse(json);
        const valid = Array.isArray(parsed)
            ? parsed.filter((s) => s && typeof s.key === "string" && typeof s.url === "string" && typeof s.type === "string")
            : [];
        return valid.length > 0 ? valid : DEFAULT_SOURCES;
    }
    catch {
        return DEFAULT_SOURCES;
    }
}

/** ASMC alert level -> TerraGuard's own risk status (configurable). */
const DEFAULT_LEVEL_RISK = { 0: "LOW", 1: "ELEVATED", 2: "MODERATE", 3: "HIGH" };

function resolveLevelRisk(json) {
    if (!json)
        return DEFAULT_LEVEL_RISK;
    try {
        return { ...DEFAULT_LEVEL_RISK, ...JSON.parse(json) };
    }
    catch {
        return DEFAULT_LEVEL_RISK;
    }
}

// ===== fetch =====
async function fetchText(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": FETCH_USER_AGENT, Accept: "text/html,application/xhtml+xml" },
            redirect: "follow",
        });
        if (!res.ok)
            return { ok: false, status: res.status, html: "", error: `HTTP ${res.status}` };
        return { ok: true, status: res.status, html: await res.text() };
    }
    catch (e) {
        return { ok: false, status: 0, html: "", error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) };
    }
    finally {
        clearTimeout(timer);
    }
}

// ===== parse =====
function htmlToText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<header[\s\S]*?<\/header>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .filter((l) => l.length > 0)
        .join("\n")
        .trim();
}

function firstLine(text, re) {
    const line = text.split("\n").find((l) => re.test(l));
    return line ? line.trim().slice(0, 400) : null;
}
/** Sentence-level search — ASMC paragraphs bundle several ideas per line. */
function findSentences(text, re, max = 2) {
    const sents = text.match(/[^.!?]+[.!?]+/g) ?? [];
    return sents.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 10 && re.test(s)).slice(0, max).map((s) => (s.length > 260 ? s.slice(0, 260) + "…" : s));
}

/** @type {Array<[RegExp, string]>} */
const HAZARD_KEYWORDS = [
    [/dense smoke haze|hazardous/i, "dense smoke haze"],
    [/moderate smoke haze|unhealthy/i, "moderate smoke haze"],
    [/transboundary haze/i, "transboundary haze"],
    [/hotspot/i, "hotspot activity"],
    [/dry weather|dry conditions/i, "dry conditions"],
];

/**
 * Extractive parse of the ASMC home situation text. Missing fields stay
 * null/empty — never guessed.
 */
function parseHome(html, sourceUrl) {
    const text = htmlToText(html);
    const start = text.search(/Latest Weather and Haze Situation/i);
    const body = start >= 0 ? text.slice(start, start + 8000) : text.slice(0, 8000);
    const levelMatch = /[Aa]t Alert Level\s*([0-3])/.exec(body);
    const level = levelMatch ? parseInt(levelMatch[1], 10) : null;
    const hotspots = [];
    const hsRe = /(\d+)\s+hotspots?\s+were detected in ([A-Za-z ]+?)(?:\s+on\s|\s+from\s|[.,])/gi;
    let m;
    while ((m = hsRe.exec(body)) !== null) {
        hotspots.push({ count: parseInt(m[1], 10), area: m[2].trim().slice(0, 60), qualifier: null, prep: "in" });
        if (hotspots.length >= 8)
            break;
    }
    // Uncounted phrasing ("Widespread hotspots were detected over ...").
    const hqRe = /(widespread|clusters? of (?:scattered )?|scattered|few|isolated)\s+hotspots?\s+(?:were\s+|have\s+been\s+)?detected\s+(over|in)\s+([A-Za-z][A-Za-z ,]{1,80}?)(?=\.|,?\s*while|;|$)/gi;
    while ((m = hqRe.exec(body)) !== null) {
        hotspots.push({ count: null, area: m[3].trim().slice(0, 60), qualifier: m[1].trim(), prep: m[2] });
        if (hotspots.length >= 8)
            break;
    }
    const density = findSentences(body, /moderate to dense|dense smoke|slight[^.!?]{0,60}smoke|no significant smoke/i, 1)[0] ?? null;
    const stations = findSentences(body, /(Hazardous|Unhealthy) levels?/i, 3);
    const winds = findSentences(body, /prevailing winds?|winds[^.!?]{0,40}blow|winds[^.!?]{0,40}forecast/i, 1)[0] ?? null;
    let phNote = findSentences(body, /philippines|palawan|mindanao|sulu/i, 1)[0] ?? null;
    if (phNote && phNote === winds)
        phNote = null; // same sentence already quoted as winds
    const hazards = [];
    for (const [re, name] of HAZARD_KEYWORDS) {
        if (re.test(body) && !hazards.includes(name))
            hazards.push(name);
    }
    return {
        kind: "situation", title: "Latest Weather and Haze Situation",
        alertLevel: level, hotspots, density, stations, winds, phNote, hazards,
        text: body.slice(0, 12000), sourceUrl,
    };
}

/** One row of the ASMC alerts table: date, Level N, region, description. */
function parseAlertRows(html) {
    const text = htmlToText(html);
    const rows = [];
    const re = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\s*\|\s*Level\s*([123])/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
        const after = text.slice(m.index, m.index + 1500);
        const regionMatch = /for (the\s+)?([A-Z][A-Za-z ]+?(?:sub-?region|Region|Kalimantan|Sumatra|Sarawak|Malaysia))/i.exec(after);
        rows.push({
            date: m[1],
            level: parseInt(m[2], 10),
            region: regionMatch ? regionMatch[2].trim().slice(0, 80) : "ASEAN region",
            detail: after.split("\n").slice(0, 6).join(" ").slice(0, 500),
        });
        if (rows.length >= 10)
            break;
    }
    return rows;
}

// ===== normalize / hash =====
function normalizeText(text) {
    return text.toLowerCase().replace(/\s+/g, " ").trim();
}

async function sha256Hex(input) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ===== risk =====
const RISK_ORDER = ["LOW", "ELEVATED", "MODERATE", "HIGH", "CRITICAL"];

function scoreHaze(parsed, levelRisk) {
    let status = levelToRisk(parsed.alertLevel, levelRisk);
    const reasons = [];
    const t = (parsed.text ?? "").toLowerCase();
    const rank = (s) => RISK_ORDER.indexOf(s);
    const bump = (to, reason) => {
        if (rank(to) > rank(status)) {
            status = to;
            reasons.push(reason);
        }
    };
    // PH explicitly in the haze picture escalates one tier (capped HIGH).
    if (parsed.phNote)
        bump(status === "LOW" ? "ELEVATED" : status === "ELEVATED" ? "MODERATE" : status === "MODERATE" ? "HIGH" : status, "PH mentioned in haze situation");
    if (/hazardous/i.test(t))
        bump("HIGH", "hazardous air quality reported");
    if (/dense smoke|widespread.*smoke/i.test(t) && rank(status) < rank("MODERATE"))
        bump("MODERATE", "dense/widespread smoke haze");
    if (/no significant smoke|remain subdued|no.*transboundary haze/i.test(t) && parsed.alertLevel === 0) {
        status = "LOW";
        reasons.push("situation subdued");
    }
    return { status, reasons };
}

function levelToRisk(level, levelRisk) {
    if (level === null || level === undefined)
        return "LOW";
    return levelRisk[level] ?? "LOW";
}

// ===== change =====
function detectHazeChanges(prev, curr) {
    const changes = [];
    if (!prev) {
        changes.push({ kind: "new-situation", detail: `New situation: ${curr.title}`, material: true });
        return changes;
    }
    if ((prev.alertLevel ?? null) !== (curr.alertLevel ?? null) && curr.alertLevel !== null) {
        const up = (curr.alertLevel ?? 0) > (prev.alertLevel ?? 0);
        changes.push({ kind: up ? "level-raised" : "level-lowered", detail: `ASMC Alert Level: ${prev.alertLevel ?? "?"} → ${curr.alertLevel}`, material: true });
    }
    if (!prev.phNote && curr.phNote) {
        changes.push({ kind: "ph-mentioned", detail: `Philippines now mentioned: ${curr.phNote.slice(0, 160)}`, material: true });
    }
    const prevRows = JSON.stringify((prev.alertRows ?? []).map((r) => `${r.date}|${r.level}|${r.region}`));
    for (const row of curr.alertRows ?? []) {
        const key = `${row.date}|${row.level}|${row.region}`;
        if (!prevRows.includes(key)) {
            changes.push({ kind: "new-alert", detail: `New ASMC alert: Level ${row.level} for ${row.region} (${row.date})`, material: true });
        }
    }
    if (curr.text && /severe transboundary haze|deteriorat/i.test(curr.text) &&
        !(prev.text && /severe transboundary haze|deteriorat/i.test(prev.text))) {
        changes.push({ kind: "situation-worsened", detail: "ASMC wording indicates deterioration", material: true });
    }
    return changes;
}

// ===== report =====
const DISCLAIMER = "Terra Guard Risk Status is an automated classification based on available official information and is not an official ASMC advisory.";
const BANNED_PHRASES = ["catastrophe incoming", "disaster guaranteed", "people will die", "major disaster is coming"];
const RISK_EMOJI = { LOW: "🟢", ELEVATED: "🔵", MODERATE: "🟡", HIGH: "🟠", CRITICAL: "🔴" };

function sanitizeReport(text) {
    let out = text;
    for (const phrase of BANNED_PHRASES) {
        out = out.replace(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[removed]");
    }
    return out;
}

function titleCase(s) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Extractive narrative — only states what ASMC published. */
function buildNarrative(parsed) {
    const parts = [];
    if (parsed.alertLevel !== null && parsed.alertLevel !== undefined)
        parts.push(`ASMC places the region at Alert Level ${parsed.alertLevel}.`);
    if (parsed.hotspots.length > 0) {
        const hs = parsed.hotspots.slice(0, 4).map((h) => h.count !== null && h.count !== undefined
            ? `${h.count} hotspots in ${h.area}`
            : `${h.qualifier} hotspots ${h.prep} ${h.area}`).join("; ");
        parts.push(`Satellite surveillance: ${hs}.`);
    }
    if (parsed.density)
        parts.push(parsed.density);
    if (parsed.stations.length > 0)
        parts.push(parsed.stations.join(" "));
    if (parsed.winds)
        parts.push(parsed.winds);
    if (parsed.phNote)
        parts.push(parsed.phNote);
    for (const row of (parsed.alertRows ?? []).slice(0, 2)) {
        parts.push(`Alert activation: Level ${row.level} for ${row.region} (${row.date}).`);
    }
    // Drop accidental repeats (e.g. a sentence matching two matchers).
    const unique = [...new Set(parts)];
    return unique.length > 0 ? unique.join(" ") : "ASMC has published updated official information.";
}

const UTC_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtStamp(iso) {
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime()))
            return "As published by ASMC";
        const p = (n) => String(n).padStart(2, "0");
        return `${p(d.getUTCDate())} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
    }
    catch {
        return "As published by ASMC";
    }
}

function changeLines(changes) {
    const lines = changes.map((c) => `• ${c.detail}`);
    return lines.length > 0 ? lines.slice(0, 12).join("\n") : "• Text refreshed with no material wording changes";
}

function buildHazeAlert(event) {
    const { parsed, risk, changes } = event;
    const emoji = RISK_EMOJI[risk.status] ?? "ℹ️";
    return sanitizeReport([
        `${emoji} TERRAGUARD HAZE ALERT ${emoji}`,
        "",
        `TERRAGUARD RISK STATUS: ${risk.status} ${emoji}`,
        "",
        "📌 EVENT",
        `🌫️ ${parsed.title}`,
        "",
        "📰 WHAT'S HAPPENING",
        buildNarrative(parsed),
        "",
        "🔄 CHANGES DETECTED",
        changeLines(changes),
        "",
        "⚠️ POSSIBLE HAZARDS",
        parsed.hazards.length > 0 ? parsed.hazards.map((h) => `• ${titleCase(h)}`).join("\n") : "• No specific hazards listed in the source",
        "",
        "📡 SOURCE",
        SOURCE_ATTRIBUTION,
        "",
        "🕒 UPDATED",
        fmtStamp(parsed.updatedAt),
        "",
        DISCLAIMER,
    ].join("\n"));
}

function buildHazeNews(event) {
    const { parsed, risk } = event;
    const emoji = RISK_EMOJI[risk.status] ?? "ℹ️";
    return sanitizeReport([
        "📰 TERRAGUARD HAZE NEWS",
        "",
        `TERRAGUARD RISK STATUS: ${risk.status} ${emoji}`,
        "",
        "📌 EVENT",
        `🌫️ ${parsed.title}`,
        "",
        "📰 WHAT'S HAPPENING",
        buildNarrative(parsed),
        "",
        "⚠️ POSSIBLE HAZARDS",
        parsed.hazards.length > 0 ? parsed.hazards.map((h) => `• ${titleCase(h)}`).join("\n") : "• No specific hazards listed in the source",
        "",
        "📡 SOURCE",
        SOURCE_ATTRIBUTION,
        "",
        "🕒 UPDATED",
        fmtStamp(parsed.updatedAt),
        "",
        DISCLAIMER,
    ].join("\n"));
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

// ===== discord =====
const RISK_COLOR = { LOW: 0x10b981, ELEVATED: 0x3b82f6, MODERATE: 0xf59e0b, HIGH: 0xef4444, CRITICAL: 0x7f1d1d };

async function sendDiscord(webhookUrl, title, text, risk, sourceUrl, sat) {
    if (!webhookUrl)
        throw new Error("DISCORD_WEBHOOK_URL not set");
    // sat === null disables the image; undefined auto-resolves the latest.
    const image = sat === null ? null : (sat || await getSatImage());
    const chunks = text.length <= 1900 ? [text] : (() => {
        const lines = text.split("\n");
        const out = [];
        let cur = "";
        for (const line of lines) {
            if ((cur + "\n" + line).length > 1900 && cur) {
                out.push(cur);
                cur = line;
            }
            else {
                cur = cur ? `${cur}\n${line}` : line;
            }
        }
        if (cur)
            out.push(cur);
        return out;
    })();
    for (let i = 0; i < chunks.length; i++) {
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: chunks[i],
                embeds: i === 0 ? [{
                        title: title.slice(0, 256),
                        color: RISK_COLOR[risk] ?? 0x3b82f6,
                        ...(image ? { image: { url: image } } : {}),
                        footer: { text: image ? "TerraGuard Haze Watch • ASMC (source) • 🛰️ JMA Himawari imagery" : "TerraGuard Haze Watch • ASMC (authoritative source)" },
                        timestamp: new Date().toISOString(),
                        url: sourceUrl || undefined,
                    }] : [],
            }),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(`Discord webhook ${res.status}: ${t.slice(0, 200)}`);
        }
        if (i < chunks.length - 1)
            await new Promise((r) => setTimeout(r, 500));
    }
}

// ===== store =====
const SNAPSHOT_KEY = "haze:snapshot";
const INDEX_KEY = "haze:index";

async function kvGetJson(kv, key) {
    try {
        const raw = await kv.get(key);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}

// ===== monitor =====
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function overallStatus(statuses) {
    const order = RISK_ORDER;
    return statuses.reduce((a, b) => (order.indexOf(a) >= order.indexOf(b) ? a : b), "LOW");
}

async function runMonitor(env) {
    const kv = env.HAZE_KV;
    const sources = resolveSources(env.HAZE_SOURCES_JSON);
    const levelRisk = resolveLevelRisk(env.HAZE_RISK_JSON);
    const snapshot = (await kvGetJson(kv, SNAPSHOT_KEY)) ?? { updatedAt: new Date().toISOString(), overallStatus: "LOW", bySource: {} };
    let dirty = false;
    const outcomes = [];
    if (Object.keys(snapshot.bySource).length === 0) {
        try {
            const index = (await kvGetJson(kv, INDEX_KEY)) ?? [];
            for (const entry of index) {
                const ev = await kvGetJson(kv, `haze:event:${entry.id}`);
                if (ev && ev.sourceKey && !snapshot.bySource[ev.sourceKey])
                    snapshot.bySource[ev.sourceKey] = ev;
            }
            if (Object.keys(snapshot.bySource).length > 0)
                dirty = true;
        }
        catch { /* best-effort */ }
    }

    // Home + alerts are parsed together: rows enrich the situation record.
    let alertRows = [];
    const byKey = {};
    for (const source of sources) {
        try {
            const res = await fetchText(source.url);
            if (!res.ok || !res.html) {
                outcomes.push(`${source.key}: fetch failed (${res.error ?? `HTTP ${res.status}`})`);
                continue;
            }
            if (source.type === "asmc-alerts") {
                alertRows = parseAlertRows(res.html);
                byKey[source.key] = { html: res.html, rows: alertRows };
                outcomes.push(`${source.key}: ${alertRows.length} alert rows read`);
            }
            else {
                byKey[source.key] = { html: res.html };
                outcomes.push(`${source.key}: fetched`);
            }
        }
        catch (e) {
            outcomes.push(`${source.key}: error ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`);
        }
    }

    for (const source of sources) {
        if (source.type !== "asmc-home" || !byKey[source.key])
            continue;
        try {
            const parsed = parseHome(byKey[source.key].html, source.url);
            parsed.alertRows = alertRows;
            parsed.updatedAt = new Date().toISOString();
            const prev = snapshot.bySource[source.key] ?? null;
            const prevRisk = prev?.risk ?? null;
            const scored = scoreHaze(parsed, levelRisk);
            const risk = { status: scored.status, score: parsed.alertLevel ?? 0, previousStatus: prevRisk?.status ?? null, changed: !!prevRisk && prevRisk.status !== scored.status };
            const hash = await sha256Hex(`${source.key}\n${normalizeText(parsed.title + "\n" + parsed.text + "\n" + JSON.stringify(alertRows.slice(0, 3)))}`);
            if (await kv.get(`haze:seen:${source.key}:${hash.slice(0, 12)}`)) {
                outcomes.push(`${source.key}: duplicate`);
                continue;
            }
            const changes = detectHazeChanges(prev?.parsed ?? null, parsed);
            const material = changes.some((c) => c.material);
            const shouldNotify = source.notifyEnabled && (!prev || material);
            const id = `${source.key}:${hash.slice(0, 12)}`;
            const event = {
                id, sourceKey: source.key, sourceUrl: source.url, parsed,
                risk, changes, isNew: !prev, shouldNotify,
                reportKind: !shouldNotify ? "NONE" : (risk.status === "HIGH" || risk.status === "CRITICAL" || changes.some((c) => ["level-raised", "new-alert", "ph-mentioned"].includes(c.kind))) ? "HAZE ALERT" : "HAZE NEWS",
                reportText: null, storedAt: new Date().toISOString(),
            };
            event.reportText = event.reportKind === "HAZE ALERT" ? buildHazeAlert(event) : event.reportKind === "HAZE NEWS" ? buildHazeNews(event) : null;
            await kv.put(`haze:seen:${source.key}:${hash.slice(0, 12)}`, "1", { expirationTtl: EVENT_TTL_SECONDS });
            await kv.put(`haze:event:${id}`, JSON.stringify(event), { expirationTtl: EVENT_TTL_SECONDS });
            const index = (await kvGetJson(kv, INDEX_KEY)) ?? [];
            await kv.put(INDEX_KEY, JSON.stringify([{ id, sourceKey: source.key, title: parsed.title, level: parsed.alertLevel, risk, storedAt: event.storedAt }, ...index.filter((e) => e.id !== id)].slice(0, MAX_INDEX)), { expirationTtl: EVENT_TTL_SECONDS });
            snapshot.bySource[source.key] = event;
            dirty = true;
            if (shouldNotify && event.reportText) {
                await sendDiscord(env.DISCORD_WEBHOOK_URL, `TerraGuard ${event.reportKind} — ASMC Alert Level ${parsed.alertLevel ?? "?"}`, event.reportText, risk.status, source.url, env.HAZE_SATELLITE === "0" ? null : undefined);
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

    if (dirty) {
        const actives = Object.values(snapshot.bySource);
        snapshot.overallStatus = overallStatus(actives.map((e) => e.risk.status));
        snapshot.updatedAt = new Date().toISOString();
        await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: EVENT_TTL_SECONDS });
    }
    return outcomes.join("; ");
}

// ===== private HTTP surface (404 without the secret) =====
function authorized(request, env) {
    const secret = env.HAZE_API_SECRET || env.CRON_SECRET;
    if (!secret)
        return false;
    if ((request.headers.get("Authorization") ?? "") === `Bearer ${secret}`)
        return true;
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


return { runMonitor, kvGet: kvGetJson, SNAPSHOT_KEY, INDEX_KEY };
})();

// ===== unified entry: ONE worker, ONE cron set, three monitors =====
// Dashboard: paste this whole file, attach KV bindings (PAGASA_KV,
// VOLCANO_KV, HAZE_KV to keep history — or a single TERRAGUARD_KV to start
// fresh), set secrets, add cron triggers: */10 * * * *, 0 23 * * *, 0 10 * * *.
//
// Webhooks: DISCORD_WEBHOOK_URL = weather + default for all.
// VOLCANO_DISCORD_WEBHOOK_URL = volcano's OWN channel (falls back to default).
// HAZE_DISCORD_WEBHOOK_URL = haze channel (falls back to default).
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const DAILY_CRONS = new Set(["0 23 * * *", "0 10 * * *"]);

function secretsOk(request, secrets) {
    const header = request.headers.get("Authorization") ?? "";
    if (secrets.some((s) => s && header === `Bearer ${s}`))
        return true;
    try {
        const key = new URL(request.url).searchParams.get("key");
        return secrets.some((s) => s && key === s);
    }
    catch {
        return false;
    }
}

const masterSecrets = (env) => [env.CRON_SECRET];
const weatherSecrets = (env) => [env.PAGASA_API_SECRET, env.CRON_SECRET];
const volcanoSecrets = (env) => [env.VOLCANO_API_SECRET, env.CRON_SECRET];
const hazeSecrets = (env) => [env.HAZE_API_SECRET, env.CRON_SECRET];

/** Per-monitor env: own KV (or shared TERRAGUARD_KV) + own webhook (or default). */
function monitorEnv(env, kvName, hookName) {
    const kv = env[kvName] || env.TERRAGUARD_KV || null;
    return { env: { ...env, [kvName]: kv, DISCORD_WEBHOOK_URL: env[hookName] || env.DISCORD_WEBHOOK_URL }, kv };
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...CORS },
    });
}

async function runGuarded(label, kv, fn) {
    if (!kv)
        return `${label}: KV not bound, skipped`;
    try {
        return await fn();
    }
    catch (e) {
        return `${label}: error ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`;
    }
}

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS")
            return new Response(null, { headers: CORS });
        const url = new URL(request.url);
        const path = url.pathname;
        const w = monitorEnv(env, "PAGASA_KV", "DISCORD_WEBHOOK_URL");
        const v = monitorEnv(env, "VOLCANO_KV", "VOLCANO_DISCORD_WEBHOOK_URL");
        const h = monitorEnv(env, "HAZE_KV", "HAZE_DISCORD_WEBHOOK_URL");

        // ---- manual triggers ----
        if (path === "/trigger") {
            if (!secretsOk(request, masterSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            const parts = [];
            parts.push("weather: " + await runGuarded("weather", w.kv, () => Weather.runMonitor(w.env)));
            parts.push("volcano: " + await runGuarded("volcano", v.kv, () => Volcano.runMonitor(v.env)));
            parts.push("haze: " + await runGuarded("haze", h.kv, () => Haze.runMonitor(h.env)));
            return json({ success: true, message: parts.join(" | ") });
        }
        if (path === "/trigger-weather") {
            if (!secretsOk(request, weatherSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            try {
                return json({ success: true, message: await runGuarded("weather", w.kv, () => Weather.runMonitor(w.env)) });
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }
        if (path === "/trigger-volcano") {
            if (!secretsOk(request, volcanoSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            try {
                return json({ success: true, message: await runGuarded("volcano", v.kv, () => Volcano.runMonitor(v.env)) });
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }
        if (path === "/trigger-haze") {
            if (!secretsOk(request, hazeSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            try {
                return json({ success: true, message: await runGuarded("haze", h.kv, () => Haze.runMonitor(h.env)) });
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }
        if (path === "/trigger-daily") {
            if (!secretsOk(request, weatherSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            try {
                return json({ success: true, message: await runGuarded("daily", w.kv, () => Weather.runDaily(w.env)) });
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }

        // ---- weather API ----
        if (path === "/api/pagasa/latest" || path === "/api/pagasa/events" || path === "/api/pagasa/event" || path === "/api/pagasa/daily") {
            if (!secretsOk(request, weatherSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            if (!w.kv)
                return json({ success: false, error: "KV not bound" }, 500);
            try {
                if (path === "/api/pagasa/latest") {
                    const snapshot = await Weather.getSnapshot(w.kv);
                    return json({ success: true, data: snapshot });
                }
                if (path === "/api/pagasa/events") {
                    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
                    const index = await Weather.getIndex(w.kv);
                    return json({ success: true, count: Math.min(limit, index.length), data: index.slice(0, limit) });
                }
                if (path === "/api/pagasa/event") {
                    const id = url.searchParams.get("id") ?? "";
                    if (!id)
                        return json({ success: false, error: "Missing ?id=" }, 400);
                    const event = await Weather.getEvent(w.kv, id);
                    if (!event)
                        return json({ success: false, error: "Not found" }, 404);
                    return json({ success: true, data: event });
                }
                if (path === "/api/pagasa/daily") {
                    const slot = Weather.manilaSlot();
                    const date = url.searchParams.get("date") ?? slot.dateKey;
                    const morning = await Weather.getDaily(w.kv, `${date}-morning`);
                    const evening = await Weather.getDaily(w.kv, `${date}-evening`);
                    const legacy = await Weather.getDaily(w.kv, date);
                    return json({ success: true, date, data: { morning, evening, legacy } });
                }
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }

        // ---- volcano API ----
        if (path === "/api/volcano/latest" || path === "/api/volcano/events" || path === "/api/volcano/event") {
            if (!secretsOk(request, volcanoSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            if (!v.kv)
                return json({ success: false, error: "KV not bound" }, 500);
            try {
                if (path === "/api/volcano/latest")
                    return json({ success: true, data: await Volcano.kvGet(v.kv, Volcano.SNAPSHOT_KEY) });
                if (path === "/api/volcano/events") {
                    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
                    const index = (await Volcano.kvGet(v.kv, Volcano.INDEX_KEY)) ?? [];
                    return json({ success: true, count: Math.min(limit, index.length), data: index.slice(0, limit) });
                }
                if (path === "/api/volcano/event") {
                    const id = url.searchParams.get("id") ?? "";
                    if (!id)
                        return json({ success: false, error: "Missing ?id=" }, 400);
                    const ev = await Volcano.kvGet(v.kv, `volcano:event:${id}`);
                    if (!ev)
                        return json({ success: false, error: "Not found" }, 404);
                    return json({ success: true, data: ev });
                }
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }

        // ---- haze API ----
        if (path === "/api/haze/latest" || path === "/api/haze/events" || path === "/api/haze/event") {
            if (!secretsOk(request, hazeSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            if (!h.kv)
                return json({ success: false, error: "KV not bound" }, 500);
            try {
                if (path === "/api/haze/latest")
                    return json({ success: true, data: await Haze.kvGet(h.kv, Haze.SNAPSHOT_KEY) });
                if (path === "/api/haze/events") {
                    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
                    const index = (await Haze.kvGet(h.kv, Haze.INDEX_KEY)) ?? [];
                    return json({ success: true, count: Math.min(limit, index.length), data: index.slice(0, limit) });
                }
                if (path === "/api/haze/event") {
                    const id = url.searchParams.get("id") ?? "";
                    if (!id)
                        return json({ success: false, error: "Missing ?id=" }, 400);
                    const ev = await Haze.kvGet(h.kv, `haze:event:${id}`);
                    if (!ev)
                        return json({ success: false, error: "Not found" }, 404);
                    return json({ success: true, data: ev });
                }
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }

        return new Response("Not Found", { status: 404, headers: CORS });
    },

    async scheduled(event, env, ctx) {
        const w = monitorEnv(env, "PAGASA_KV", "DISCORD_WEBHOOK_URL");
        const v = monitorEnv(env, "VOLCANO_KV", "VOLCANO_DISCORD_WEBHOOK_URL");
        const h = monitorEnv(env, "HAZE_KV", "HAZE_DISCORD_WEBHOOK_URL");
        ctx.waitUntil((async () => {
            try {
                if (DAILY_CRONS.has(event.cron)) {
                    console.log(`[cron][weather][daily] ${await runGuarded("daily", w.kv, () => Weather.runDaily(w.env))}`);
                    return;
                }
                console.log(`[cron][weather] ${await runGuarded("weather", w.kv, () => Weather.runMonitor(w.env))}`);
                console.log(`[cron][volcano] ${await runGuarded("volcano", v.kv, () => Volcano.runMonitor(v.env))}`);
                console.log(`[cron][haze] ${await runGuarded("haze", h.kv, () => Haze.runMonitor(h.env))}`);
            }
            catch (e) {
                console.error("[cron][terraguard] failed", e);
            }
        })());
    },
};
