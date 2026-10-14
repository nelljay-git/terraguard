// TerraGuard all-hazard monitor: weather (PAGASA) + volcano (PHIVOLCS) + haze (ASMC).
// ONE worker, ONE cron set. See worker-webhook/TERRA_README.md.

// Shared Facebook Graph helpers (used by Weather, Volcano, Haze)
const FB_GRAPH_VERSION = "v21.0";
async function fbAppSecretProof(accessToken, appSecret) {
    try {
        if (!accessToken || !appSecret || !crypto?.subtle) return null;
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken));
        return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch { return null; }
}
async function fbPageToken(env) {
    const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
    const pageId = (env.FB_PAGE_ID ?? "").trim();
    if (!userToken || !pageId) return null;
    try {
        const proof = await fbAppSecretProof(userToken, (env.FB_APP_SECRET ?? "").trim());
        const url = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/me/accounts`);
        url.searchParams.set("access_token", userToken);
        url.searchParams.set("fields", "id,name,access_token");
        url.searchParams.set("limit", "50");
        if (proof) url.searchParams.set("appsecret_proof", proof);
        const res = await fetch(url.toString());
        if (!res.ok) return null;
        const data = await res.json().catch(() => ({}));
        const page = (data.data ?? []).find((p) => String(p.id) === String(pageId));
        return page?.access_token ?? null;
    } catch { return null; }
}

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
// PAGASA cyclone track image (e.g. https://pubfiles.pagasa.dost.gov.ph/tamss/weather/track_queenie.png)
// Found in <img src="...tamss/weather/track_*.png"> on the severe-weather-bulletin page.
// Falls back to null — caller uses branded pubmat instead.
// ---------------------------------------------------------------------------
function extractCycloneTrackImage(html) {
    if (!html) return null;
    // Primary: <img src="https://pubfiles...tamss/...track_*.png"> — only tamss/track images count, not sidebar icons.
    const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const candidates = [];
    let m;
    while ((m = imgRe.exec(html)) !== null) {
        let url = (m[1] || "").trim();
        if (!url) continue;
        if (url.startsWith("//")) url = "https:" + url;
        else if (url.startsWith("/")) url = "https://www.pagasa.dost.gov.ph" + url;
        if (/pubfiles\.pagasa\.dost\.gov\.ph/i.test(url) && /\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/i.test(url)) {
            if (/\/track_/i.test(url) || /\/tamss\//i.test(url)) candidates.push(url);
        }
    }
    if (candidates.length > 0) {
        const track = candidates.find((u) => /\/track_/i.test(u));
        return track || candidates[0];
    }
    // Fallback: raw pubfiles URL outside an img tag — also require tamss/track.
    const urlRe = /https?:\/\/pubfiles\.pagasa\.dost\.gov\.ph\/[^\s"'<>]+\.(?:png|jpe?g|gif|webp)/gi;
    const rawAll = [...html.matchAll(urlRe)].map((x) => x[0]);
    const raw = rawAll.filter((u) => /\/track_/i.test(u) || /\/tamss\//i.test(u));
    if (raw.length > 0) {
        const track = raw.find((u) => /\/track_/i.test(u));
        return track || raw[0];
    }
    return null;
}
// ---------------------------------------------------------------------------
// PAGASA daily forecast images (e.g. surface_map.jpg, chart.png, we98.png, himawari gif)
// Found on the /weather page bottom: 4 images (see screenshot). Used for DAILY WEATHER UPDATE.
// Falls back to [] — caller uses branded pubmat instead.
// ---------------------------------------------------------------------------
function extractForecastImages(html) {
    if (!html) return [];
    const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const raw = [];
    let m;
    while ((m = imgRe.exec(html)) !== null) {
        let url = (m[1] || "").trim();
        if (!url) continue;
        if (url.startsWith("//")) url = "https:" + url;
        else if (url.startsWith("/")) url = "https://www.pagasa.dost.gov.ph" + url;
        const isTamss = /pubfiles\.pagasa\.dost\.gov\.ph[^?]*\/tamss\/weather\//i.test(url);
        const isMeteo = /src\.meteopilipinas\.gov\.ph/i.test(url);
        if ((isTamss || isMeteo) && /\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/i.test(url)) {
            if (/\/track_/i.test(url)) continue; // cyclone track belongs to cyclone path, not daily
            raw.push(url);
        }
    }
    const uniq = [...new Set(raw)];
    const score = (u) => {
        if (/surface_map/i.test(u)) return 1;
        if (/\/chart\.png/i.test(u)) return 2;
        if (/\/we\d+\.png/i.test(u)) return 3;
        if (/pubfiles.*tamss/i.test(u)) return 4;
        if (/meteopilipinas/i.test(u)) return 5;
        return 6;
    };
    uniq.sort((a, b) => score(a) - score(b));
    return uniq;
}
function extractPrimaryWeatherImage(html) {
    const arr = extractForecastImages(html);
    return arr[0] || null;
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
        trackImage: extractCycloneTrackImage(result.html),
        weatherImages: extractForecastImages(result.html),
        weatherImage: extractPrimaryWeatherImage(result.html),
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
    const normalizedBody = normalizeText([parsed.title, parsed.issuedAt, parsed.text, parsed.trackImage ?? "", (parsed.weatherImages ?? []).join("\n"), parsed.weatherImage ?? ""].filter(Boolean).join("\n"));
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
    const { parsed, risk } = event;
    const issued = parsed.issuedAt || "latest PAGASA update";
    const synopsis = extractSynopsis(parsed.text) || buildNarrative(parsed);
    const riskEmoji = RISK_EMOJI[risk?.status ?? "LOW"] ?? "⛅";
    const lines = [
        `${riskEmoji} DAILY WEATHER UPDATE — ${issued} | TerraGuard PH`,
        "",
        `🕐 Officially issued: ${issued}`,
        `🏷️ TERRAGUARD RISK STATUS: ${risk?.status ?? "LOW"} ${riskEmoji}`,
        "",
        "📡 WHAT'S HAPPENING (SYNOPSIS)",
        synopsis,
    ];
    // Plain-language context for non-experts
    if (parsed.systems && parsed.systems.length > 0) {
        const expl = {
            "Southwest Monsoon": "Southwest Monsoon (Habagat) — warm, moist winds from the southwest bringing scattered rains, especially over western Luzon & Visayas",
            "Northeast Monsoon": "Northeast Monsoon (Amihan) — cool, dry winds from the northeast",
            "Intertropical Convergence Zone": "Intertropical Convergence Zone (ITCZ) — where trade winds meet, often causing cloudiness and thunderstorms",
            "Low Pressure Area": "Low Pressure Area (LPA) — a cloud cluster being monitored for possible cyclone development",
            "Shear Line": "Shear Line — boundary of contrasting winds, can trigger prolonged rains",
            "Easterlies": "Easterlies — warm winds from the Pacific, often bringing isolated thunderstorms and warm weather",
            "Thunderstorm": "Localized thunderstorms — typically brief but intense afternoon/evening rain",
            "Tropical Cyclone": "Tropical Cyclone — a developing or active storm system inside/outside PAR",
        };
        const details = parsed.systems.map(s => `• ${expl[s] ?? s}`).join("\n");
        lines.push("", "🌦️ WEATHER SYSTEMS IN EFFECT", details);
    }
    if (parsed.cycloneName && parsed.cycloneCategory) {
        lines.push("", "🌀 TROPICAL CYCLONE WATCH", `PAGASA is monitoring ${titleCase(parsed.cycloneCategory)} ${parsed.cycloneName}.${parsed.cycloneMovement ? ` ${parsed.cycloneMovement}` : ""}${parsed.winds ? ` ${parsed.winds}` : ""}`, `We are actively tracking this system. No need to panic — just stay updated, especially if you are in coastal or low-lying areas.`);
    } else if (parsed.cycloneCategory) {
        lines.push("", "🌀 TROPICAL CYCLONE WATCH", buildNarrative(parsed));
    }
    // Forecast by area — with friendly context
    const forecastBlock = (() => {
        const t = String(parsed.text ?? "");
        const m = /forecast weather conditions([\s\S]+?)(?=forecast wind|temperature and relative|tides and astronomical|satellite image|$)/i.exec(t);
        return m ? m[1].replace(/\s+/g, " ").trim().slice(0, 1200) : "";
    })();
    if (forecastBlock) {
        lines.push("", "🗺️ WHAT TO EXPECT TODAY (BY AREA)", forecastBlock, "", "💡 Tip: “Scattered rains and thunderstorms” means not everyone will get rain, but when it does, it can be heavy and brief. Plan outdoor activities for the morning if possible.");
    } else {
        const areas = (parsed.affectedAreas ?? []).slice(0, 10);
        if (areas.length > 0) {
            lines.push("", "🗺️ AREAS TO WATCH", ...areas.map((a) => `• ${a}`));
            if ((parsed.affectedAreas ?? []).length > 10) lines.push(`• (+${parsed.affectedAreas.length - 10} more in the full bulletin)`);
        }
    }
    if (parsed.rainfall) lines.push("", "🌧️ RAINFALL OUTLOOK", parsed.rainfall, "If a heavy rainfall warning is in effect, consider flood-prone routes and keep essentials ready.");
    if (parsed.hazards && parsed.hazards.length > 0) lines.push("", "⚠️ POSSIBLE HAZARDS", ...parsed.hazards.map(h => `• ${titleCase(h)}`), "Stay safe: avoid flooded roads, secure loose items outdoors, and follow local advisories.");
    lines.push("", "—", "📚 CONTEXT: This is an automated summary. PAGASA is the authoritative source — we only retrieve, organize, and reword for easier reading. We never add forecasts or change warnings.", `🔗 Official bulletin: ${source.url}`, "💬 Join our community for discussions and quick updates: https://discord.gg/tdGrvnvehP", "", "#WeatherPH #PAGASA #Habagat #TerraGuardPH #StaySafe #WeatherUpdate");
    return sanitizeReport(lines.join("\n"));
}
function buildCycloneFbMessage(event, source) {
    const { parsed, risk } = event;
    const no = cycloneBulletinNo(parsed);
    const name = [parsed.cycloneCategory ? titleCase(parsed.cycloneCategory) : "", parsed.cycloneName || ""].filter(Boolean).join(" ") || "Tropical Cyclone";
    const issued = parsed.issuedAt || "latest PAGASA update";
    const riskEmoji = RISK_EMOJI[risk?.status ?? "LOW"] ?? "🌀";
    const lines = [
        `${riskEmoji} TROPICAL CYCLONE BULLETIN${no ? ` NO. ${no}` : ""}: ${name} — ${issued} | TerraGuard PH`,
        "",
        `🕐 Issued: ${issued}`,
        `🏷️ TERRAGUARD RISK STATUS: ${risk?.status ?? "LOW"} ${riskEmoji}`,
    ];
    const loc = cycloneLocationLine(parsed.text);
    if (loc) lines.push("", "📍 CURRENT LOCATION & INTENSITY", `• ${loc}`);
    if (parsed.cycloneMovement) lines.push(`• 🧭 ${parsed.cycloneMovement}`);
    if (parsed.winds) lines.push(`• 💨 ${parsed.winds}`);
    if (!loc && !parsed.cycloneMovement && !parsed.winds) lines.push("", "📍 STATUS", buildNarrative(parsed));
    const sigs = signalFbLines(parsed.signals);
    if (sigs.length > 0) {
        lines.push("", "🚨 WIND SIGNALS — WHAT THEY MEAN", ...sigs, "", "• Signal 1: Strong winds expected within 36h — be alert, secure light structures", "• Signal 2+: Stronger winds — avoid sea travel, stay indoors as advised by LGU");
    } else if ((parsed.affectedAreas ?? []).length > 0) {
        lines.push("", "📍 AREAS CURRENTLY MENTIONED", ...(parsed.affectedAreas ?? []).slice(0, 12).map((a) => `• ${a}`));
    }
    if (parsed.rainfall) lines.push("", "🌧️ HEAVY RAINFALL OUTLOOK", parsed.rainfall, "Flooding and landslides are possible in high-risk areas — please avoid flood-prone routes and monitor your LGU/PDRRMO updates.");
    if (parsed.surge) lines.push("", "🌊 STORM SURGE & COASTAL WATERS", parsed.surge, "Sea travel can be risky — fisherfolk and small vessels are advised to follow PAGASA's gale warning.");
    if (parsed.hazards && parsed.hazards.length > 0) lines.push("", "⚠️ OTHER HAZARDS TO NOTE", ...parsed.hazards.map(h => `• ${titleCase(h)}`));
    const next = nextBulletinLine(parsed.text);
    if (next) lines.push("", `⏭️ NEXT UPDATE: ${next}`, "Tip: Set a reminder to check again around that time — conditions can change quickly.");
    lines.push("", "—", "Reminder: No need to panic. Being informed and prepared is the best protection. Keep your emergency kit ready, charge your devices, and look out for neighbors.", "📚 PAGASA remains the authoritative source — TerraGuard only summarizes for easier reading.", `🔗 Official bulletin: ${source.url}`, "💬 Questions or want to share updates from your area? Join us: https://discord.gg/tdGrvnvehP", "", "#TropicalCyclonePH #PAGASA #BagyoPH #TerraGuardPH #StaySafe");
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
    // Prefer official PAGASA images straight from the bulletin; fallback to branded pubmat.
    //  - Cyclone: track_*.png (pubfiles tamss) — single image
    //  - Daily forecast: surface_map.jpg / chart.png / we*.png / himawari gif — up to 4 images
    // For daily: try multi-photo post (unpublished upload + attached_media) first; fallback to single loops.
    if (slot.kind === "weather") {
        const wImgs = (event.parsed?.weatherImages ?? []).filter((u) => /^https?:\/\/(pubfiles\.pagasa\.dost\.gov\.ph|src\.meteopilipinas\.gov\.ph)\//i.test(u));
        if (wImgs.length > 1) {
            const uploadedIds = [];
            for (const url of wImgs) {
                try {
                    const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/photos`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(withProof({ access_token: pageToken, url, published: false })),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok && data.id) uploadedIds.push(data.id);
                    else console.error(`[fb][pagasa] unpublished upload failed (${url.slice(0, 80)}): ${String(data?.error?.message ?? `HTTP ${res.status}`).slice(0, 300)}`);
                } catch (e) {
                    console.error(`[fb][pagasa] unpublished upload exception (${url.slice(0, 80)})`, e instanceof Error ? e.message : String(e));
                }
            }
            if (uploadedIds.length > 0) {
                try {
                    const attached = uploadedIds.map((id) => ({ media_fbid: id }));
                    const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/feed`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(withProof({ access_token: pageToken, message, attached_media: attached })),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (res.ok && data.id) return `posted multi ${data.id} with ${uploadedIds.length} bulletin images`;
                    console.error(`[fb][pagasa] multi feed post failed: ${String(data?.error?.message ?? `HTTP ${res.status}`).slice(0, 400)}`);
                } catch (e) {
                    console.error("[fb][pagasa] multi feed exception", e instanceof Error ? e.message : String(e));
                }
            }
        }
    }
    // Single-photo fallback (cyclone single track, or weather single + pubmat fallback chain)
    let photoUrls = [slot.image];
    if (slot.kind === "cyclone" && event.parsed?.trackImage && /^https?:\/\/pubfiles\.pagasa\.dost\.gov\.ph\//i.test(event.parsed.trackImage)) {
        photoUrls = [event.parsed.trackImage, slot.image];
    } else if (slot.kind === "weather") {
        const wImgs = (event.parsed?.weatherImages ?? []).filter((u) => /^https?:\/\/(pubfiles\.pagasa\.dost\.gov\.ph|src\.meteopilipinas\.gov\.ph)\//i.test(u));
        if (wImgs.length > 0) photoUrls = [...wImgs, slot.image];
        else if (event.parsed?.weatherImage && /^https?:\/\/(pubfiles\.pagasa\.dost\.gov\.ph|src\.meteopilipinas\.gov\.ph)\//i.test(event.parsed.weatherImage)) {
            photoUrls = [event.parsed.weatherImage, slot.image];
        }
    }
    for (const photoUrl of photoUrls) {
        try {
            const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/photos`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(withProof({ access_token: pageToken, caption: message, url: photoUrl })),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && (data.post_id || data.id)) {
                const via = /pubfiles/i.test(photoUrl) ? (slot.kind === "cyclone" ? "track" : "bulletin") : /meteopilipinas/i.test(photoUrl) ? "satellite" : "pubmat";
                return `posted photo ${data.post_id ?? data.id} via ${via}`;
            }
            console.error(`[fb][pagasa] photo post failed (${photoUrl.slice(0, 90)}): ${String(data?.error?.message ?? `HTTP ${res.status}`).slice(0, 300)}`);
        }
        catch (e) {
            console.error(`[fb][pagasa] photo post exception (${photoUrl.slice(0, 90)})`, e instanceof Error ? e.message : String(e));
        }
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
async function runMonitor(env, opts = {}) {
    // Single-flight layer 1 (tick claim): Cloudflare may occasionally deliver
    // the same cron twice, and two concurrent invocations would both pass the
    // content-hash gate before either marks it — posting identical duplicates
    // minutes apart. Claim the current 10-minute tick first; a YOUNG foreign
    // claim means a sibling invocation is actively running this tick, so stand
    // down. The window is deliberately short (120s, runs take seconds): a retry
    // arriving minutes later after a crash proceeds, and the hash gate still
    // dedupes anything the first run actually sent — so alerts are never lost.
    // Manual triggers pass { manual: true } and always run. A missing /
    // unreadable KV must never suppress a run; worst case is the status quo.
    if (!opts?.manual && env.PAGASA_KV) {
        const slot = Math.floor(Date.now() / 600000);
        const tickToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        try {
            const raw = await env.PAGASA_KV.get(`pagasa:tickclaim:${slot}`);
            if (raw) {
                try {
                    const c = JSON.parse(raw);
                    if (c && c.token !== tickToken && Date.now() - c.at < 120000)
                        return `tick ${slot}: duplicate invocation already running, stood down`;
                } catch { /* corrupt claim: proceed below */ }
            }
            await env.PAGASA_KV.put(`pagasa:tickclaim:${slot}`, JSON.stringify({ token: tickToken, at: Date.now() }), { expirationTtl: 660 });
        } catch { /* KV hiccup: proceed */ }
    }
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
            // Single-flight layer 2 (send claim): backs up the tick claim for
            // the residual case where two invocations start within the same
            // millisecond. A fresh foreign claim for this exact content hash
            // means a sibling is already sending it. Stale/missing claims and
            // KV hiccups never suppress a send.
            if (shouldNotify && event.reportText) {
                const sendKey = `pagasa:sendclaim:${source.key}:${normalized.contentHash.slice(0, 12)}`;
                const sendToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
                let stoodDown = false;
                try {
                    const raw = await env.PAGASA_KV.get(sendKey);
                    if (raw) {
                        try {
                            const c = JSON.parse(raw);
                            if (c && c.token !== sendToken && Date.now() - c.at < 120000) stoodDown = true;
                        } catch { /* corrupt claim: proceed */ }
                    }
                    if (!stoodDown) await env.PAGASA_KV.put(sendKey, JSON.stringify({ token: sendToken, at: Date.now() }), { expirationTtl: 300 });
                } catch { stoodDown = false; }
                if (stoodDown) {
                    outcomes.push(`${source.key}: duplicate invocation already sending (hash ${normalized.contentHash.slice(0, 8)}), stood down`);
                    continue;
                }
            }
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
                // Discord mirror: same FB template; prefer official bulletin images (all 4 for daily), else branded pubmat.
                try {
                    const slot = weatherFbSlot(source.key);
                    if (slot && !event.parsed?.statesNoActive) {
                        const fbMessage = slot.kind === "cyclone" ? buildCycloneFbMessage(event, source) : buildWeatherFbMessage(event, source);
                        const fbTitle = slot.kind === "cyclone" ? "TerraGuard Cyclone Report" : "TerraGuard Weather Report";
                        if (slot.kind === "cyclone" && event.parsed?.trackImage && /^https?:\/\/pubfiles\.pagasa\.dost\.gov\.ph\//i.test(event.parsed.trackImage)) {
                            await sendDiscordReport(env.DISCORD_WEBHOOK_URL, fbTitle, fbMessage, risk.status, source.url, event.parsed.trackImage, "TerraGuard • DOST-PAGASA (authoritative source)");
                            outcomes.push(`${source.key}: discord mirror sent via track`);
                        } else if (slot.kind === "weather") {
                            const wImgs = (event.parsed?.weatherImages ?? []).filter((u) => /^https?:\/\/(pubfiles\.pagasa\.dost\.gov\.ph|src\.meteopilipinas\.gov\.ph)\//i.test(u));
                            const allImgs = wImgs.length > 0 ? wImgs : (event.parsed?.weatherImage && /^https?:\/\/(pubfiles\.pagasa\.dost\.gov\.ph|src\.meteopilipinas\.gov\.ph)\//i.test(event.parsed.weatherImage) ? [event.parsed.weatherImage] : []);
                            if (allImgs.length > 1) {
                                const labelFor = (u) => {
                                    if (/surface_map/i.test(u)) return "Surface Map Analysis";
                                    if (/\/chart\.png/i.test(u)) return "Predicted Mean Sea Level Pressure Analysis";
                                    if (/\/we\d+\.png/i.test(u)) return "Predicted Wind Analysis";
                                    if (/meteopilipinas/i.test(u) || /1irsml/i.test(u)) return "Himawari Satellite Image";
                                    if (/pubfiles/i.test(u)) return "PAGASA Bulletin Image";
                                    return "Weather Chart";
                                };
                                // First image carries the full FB message
                                await sendDiscordReport(env.DISCORD_WEBHOOK_URL, fbTitle, fbMessage, risk.status, source.url, allImgs[0], "TerraGuard • DOST-PAGASA (authoritative source)");
                                outcomes.push(`${source.key}: discord mirror sent via bulletin (1/${allImgs.length})`);
                                for (let i = 1; i < allImgs.length; i++) {
                                    const url = allImgs[i];
                                    const label = labelFor(url);
                                    await new Promise((r) => setTimeout(r, 600));
                                    await sendDiscordReport(env.DISCORD_WEBHOOK_URL, `${fbTitle} — ${label}`, `**${label}**\n${source.url}`, risk.status, source.url, url, "TerraGuard • DOST-PAGASA (authoritative source)");
                                    outcomes.push(`${source.key}: discord mirror extra ${i + 1}/${allImgs.length} via ${/meteopilipinas/i.test(url) ? "satellite" : "bulletin"}`);
                                }
                            } else {
                                const img = allImgs[0] || slot.image;
                                await sendDiscordReport(env.DISCORD_WEBHOOK_URL, fbTitle, fbMessage, risk.status, source.url, img, "TerraGuard • DOST-PAGASA (authoritative source)");
                                const via = /pubfiles/i.test(img) ? "bulletin" : /meteopilipinas/i.test(img) ? "satellite" : "pubmat";
                                outcomes.push(`${source.key}: discord mirror sent via ${via}`);
                            }
                        } else {
                            await sendDiscordReport(env.DISCORD_WEBHOOK_URL, fbTitle, fbMessage, risk.status, source.url, slot.image, "TerraGuard • DOST-PAGASA (authoritative source)");
                            outcomes.push(`${source.key}: discord mirror sent via pubmat`);
                        }
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

return { runMonitor, runDaily, getSnapshot, getIndex, getEvent, getDaily, manilaSlot, weatherFbSlot, buildWeatherFbMessage, buildCycloneFbMessage, postWeatherToFacebook, sendDiscordReport };
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

/** Friendly, detailed narrative — still extractive, never invents, but explains in plain language. */
function buildNarrative(parsed) {
    const name = titleCase(parsed.volcano.toLowerCase());
    const level = parsed.alertLevel;
    const trend = parsed.trend;
    const levelMeaning = {
        0: "No alert — volcano is quiet at background levels.",
        1: "Low-level unrest — slight activity, but no eruption is expected imminently.",
        2: trend ? `Moderate unrest — ${trend}.` : "Moderate unrest — elevated activity, but no magmatic eruption yet.",
        3: "Relatively high unrest — magma is close to the surface; eruption is possible within weeks.",
        4: "Hazardous eruption is imminent — intense unrest, eruption expected within hours to days.",
        5: "Hazardous eruption is ongoing — eruption is in progress.",
    }[level ?? -1] ?? "";
    const parts = [];
    if (level !== null && level !== undefined) {
        parts.push(`PHIVOLCS keeps **${name} Volcano** at **Alert Level ${level}**${trend ? ` — ${trend}` : ""}. ${levelMeaning}`);
    }
    const obs = [];
    if (parsed.quakes !== null) obs.push(`${parsed.quakes} volcanic earthquakes in the last 24 hours`);
    if (parsed.so2) obs.push(`sulfur dioxide emission at **${parsed.so2} tonnes/day** — a key gas being watched closely`);
    if (parsed.plume) obs.push(parsed.plume.charAt(0).toLowerCase() + parsed.plume.slice(1));
    if (parsed.deformation) obs.push(parsed.deformation.charAt(0).toLowerCase() + parsed.deformation.slice(1));
    if (parsed.glow) obs.push(`crater glow was **${String(parsed.glow).toLowerCase()}** — often visible at night when the volcano is restless`);
    if (obs.length > 0) parts.push(`**What PHIVOLCS observed in the last 24 hours:** ${obs.join("; ")}.`);
    if (parsed.pdzKm) parts.push(`👉 **Safety reminder:** Please stay outside the **${parsed.pdzKm}-km Permanent Danger Zone**. Entry is strictly prohibited — this zone is at highest risk for rockfalls, pyroclastic flows, and ash.`);
    return parts.length > 0 ? parts.join(" ") : "PHIVOLCS has published an update for this volcano — no major change in activity, but 24/7 monitoring continues. Stay tuned for the next bulletin.";
}

function changeLines(changes) {
    const lines = changes.map((c) => `• ${c.detail}`);
    return lines.length > 0 ? lines.slice(0, 12).join("\n") : "• Bulletin text refreshed with no material wording changes";
}

function buildVolcanoAlert(event) {
    const { parsed, risk, changes } = event;
    const emoji = RISK_EMOJI[risk.status] ?? "ℹ️";
    const name = titleCase(parsed.volcano.toLowerCase());
    const levelHelp = {
        0: "No action needed — but PHIVOLCS still watches 24/7.",
        1: "Stay informed and avoid the danger zone — no evacuation needed yet.",
        2: "Be prepared — review your family’s evacuation plan and emergency kit.",
        3: "Be ready to evacuate quickly if PHIVOLCS raises the alert again — keep monitoring.",
        4: "Be ready to evacuate NOW if advised by authorities — eruption could happen within hours.",
        5: "Eruption is ongoing — follow evacuation orders immediately.",
    }[parsed.alertLevel ?? -1] ?? "Follow PHIVOLCS and your LGU’s advice.";
    return sanitizeReport([
        `${emoji} TERRAGUARD VOLCANO ALERT ${emoji}`,
        "",
        `TERRAGUARD RISK STATUS: ${risk.status} ${emoji}`,
        `PHIVOLCS Alert Level ${parsed.alertLevel ?? "unknown"} — ${name}`,
        "",
        "📌 VOLCANO",
        `🌋 ${name} Volcano — Alert Level ${parsed.alertLevel ?? "unknown"}${parsed.trend ? ` (${parsed.trend})` : ""}`,
        "",
        "📰 WHAT'S HAPPENING — IN PLAIN LANGUAGE",
        buildNarrative(parsed),
        "",
        "🔄 WHAT CHANGED SINCE THE LAST BULLETIN",
        changeLines(changes),
        "",
        "💡 WHAT THIS ALERT LEVEL MEANS FOR YOU",
        `• ${levelHelp}`,
        "",
        "⚠️ POSSIBLE HAZARDS (if activity escalates)",
        parsed.hazards.length > 0 ? parsed.hazards.map((h) => `• ${titleCase(h)}`).join("\n") : "• No specific hazards listed in this bulletin — but PHIVOLCS still advises caution near the danger zone.",
        "",
        "🛡️ FRIENDLY SAFETY REMINDERS",
        "• Stay outside the Permanent Danger Zone and respect Extended Danger Zones if declared.",
        "• Prepare a go-bag (water, masks for ash, flashlight, documents) and keep it accessible.",
        "• Follow only PHIVOLCS and your LGU/PDRRMO — avoid unverified social media posts.",
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
        `PHIVOLCS Alert Level ${parsed.alertLevel ?? "unknown"} — ${name}`,
        "",
        "📌 VOLCANO",
        `🌋 ${name} Volcano — Alert Level ${parsed.alertLevel ?? "unknown"}${parsed.trend ? ` (${parsed.trend})` : ""}`,
        "",
        "📰 WHAT'S HAPPENING — IN PLAIN LANGUAGE",
        buildNarrative(parsed),
        "",
        "⚠️ POSSIBLE HAZARDS TO BE AWARE OF",
        parsed.hazards.length > 0 ? parsed.hazards.map((h) => `• ${titleCase(h)}`).join("\n") : "• No specific hazards listed in this bulletin — but staying clear of the danger zone is still advised.",
        "",
        "🛡️ QUICK SAFETY NOTES",
        "• No need to worry, but stay updated — PHIVOLCS posts a new bulletin daily.",
        "• If you live near the volcano, know your barangay’s evacuation route.",
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
    const kind = reportKind === "VOLCANO ALERT" ? "ALERT" : "UPDATE";
    const tag = volcanoTag(parsed.volcano);
    const levelHelp = {
        0: "Volcano is quiet — no action needed, but daily monitoring continues.",
        1: "Low-level unrest — stay informed and avoid the danger zone.",
        2: "Moderate unrest — be prepared and keep your emergency kit ready.",
        3: "High unrest — be ready to evacuate if PHIVOLCS raises the alert.",
        4: "Eruption imminent — be ready to evacuate NOW if advised.",
        5: "Eruption in progress — follow evacuation orders immediately.",
    }[parsed.alertLevel ?? -1] ?? "Follow PHIVOLCS and LGU advice.";
    // Facebook has no markdown — strip the ** used for Discord bold
    const fbNarrative = buildNarrative(parsed).replace(/\*\*/g, "");
    return sanitizeReport([
        `${emoji} VOLCANO ${kind} — ${name.toUpperCase()} | Alert Level ${parsed.alertLevel ?? "unknown"} ${parsed.trend ? `(${parsed.trend})` : ""} | TerraGuard PH`,
        "",
        `🕐 Issued: ${parsed.issuedAt || "As published by PHIVOLCS"}`,
        `🏷️ TERRAGUARD RISK STATUS: ${risk.status} ${emoji}`,
        "",
        "📡 WHAT'S HAPPENING",
        fbNarrative,
        "",
        "🔄 WHAT CHANGED SINCE THE LAST BULLETIN",
        changeLines(changes),
        "",
        `💡 WHAT ALERT LEVEL ${parsed.alertLevel ?? "?"} MEANS`,
        `• ${levelHelp}`,
        "",
        "⚠️ POSSIBLE HAZARDS",
        parsed.hazards.length > 0 ? parsed.hazards.map((h) => `• ${titleCase(h)}`).join("\n") : "• No specific hazards listed — but staying clear of the danger zone is still advised.",
        "",
        "🛡️ FRIENDLY REMINDERS",
        "• Respect the Permanent Danger Zone and any Extended Danger Zone.",
        "• Keep a go-bag ready if you live nearby, and follow only PHIVOLCS/LGU updates.",
        "",
        `🔗 Details & map: ${event.sourceUrl || ""}`,
        `📚 Source: ${SOURCE_ATTRIBUTION} — PHIVOLCS is the authoritative source.`,
        "",
        "💬 Questions or updates from your area? Join our community: https://discord.gg/tdGrvnvehP",
        ["#Volcano", tag ? `#${tag}` : "", "#PHIVOLCS", "#TerraGuardPH", "#StaySafe", `#${name.replace(/\s+/g, "")}`].filter(Boolean).join(" "),
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
    const cardUrl = `https://trikefare.x10.mx/terraguard/api/volcano-card.php?${cardParams}`;
    const cardBackup = `https://terraguard-auto.page.gd/terraguard/api/volcano-card.php?${cardParams}`;
    const photoUrls = [cardUrl, cardBackup];
    if (imageUrl)
        photoUrls.push(imageUrl); // bulletin map / Himawari as backup
    // Warm the PHP card first (ensure GD tiles are ready for FB's scraper).
    const isCard = (u) => String(u).includes("volcano-card.php");
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


return { runMonitor, kvGet: kvGetJson, SNAPSHOT_KEY, INDEX_KEY, buildAlert: buildVolcanoAlert, buildNews: buildVolcanoNews, sendDiscord, postToFacebook: postVolcanoToFacebook, buildFbMessage: buildVolcanoFbMessage };
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
// ===== tsunami (from tsunami.js) — merged, no separate Worker needed =====
const Tsunami = (() => {
/**
 * Cloudflare Worker — Tsunami Advisory (JS version for dashboard paste)
 * Paste this as a SEPARATE Worker (terraguard-tsunami), not into index.js
 * Source: tsunami.gov + NWS api.weather.gov/alerts
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function fetchTsunamiAlerts() {
  try {
    const r = await fetch("https://api.weather.gov/alerts?active=1", {
      headers: {
        "User-Agent": "TerraGuard-Tsunami/1.0",
        Accept: "application/geo+json",
      },
    });
    if (r.ok) {
      const j = await r.json();
      const feats = (j.features || []).filter((f) =>
        /tsunami/i.test(f.properties.event),
      );
      if (feats.length > 0)
        return feats.map((f) => ({
          id: f.id || f.properties.id,
          event: f.properties.event,
          headline: f.properties.headline,
          description: f.properties.description,
          areaDesc: f.properties.areaDesc,
          sent: f.properties.sent,
          effective: f.properties.effective,
          expires: f.properties.expires,
          status: f.properties.status || "",
          messageType: f.properties.messageType || "",
          link: `https://api.weather.gov/alerts/${encodeURIComponent(f.properties.id)}`,
          tsunamiGovLink: "https://www.tsunami.gov/",
          quake: parseQuakeFromText(
            `${f.properties.headline || ""}\n${f.properties.description || ""}`,
          ),
        }));
    }
  } catch (e) {
    console.warn(e);
  }
  try {
    const r = await fetch("https://www.tsunami.gov/", {
      headers: { "User-Agent": "TerraGuard-Tsunami/1.0" },
    });
    if (r.ok) {
      const html = await r.text();
      const linkRe =
        /href=["']\?p=([^"']+)["'][^>]*>([^<]*Tsunami[^<]*|[^<]*Warning[^<]*|[^<]*Advisory[^<]*)/gi;
      let m;
      const ids = [];
      while ((m = linkRe.exec(html)) !== null) {
        ids.push({ id: m[1], event: m[2].trim() });
        if (ids.length >= 5) break;
      }
      if (ids.length > 0) {
        const first = ids[0];
        const detail = await fetch(`https://www.tsunami.gov/?p=${first.id}`, {
          headers: { "User-Agent": "TerraGuard-Tsunami/1.0" },
        })
          .then((x) => x.text())
          .catch(() => "");
        const headline = (
          /Message:\s*([^<\n]+)/i.exec(detail)?.[1] || first.event
        ).trim();
        const detailText = detail
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return [
          {
            id: first.id,
            event: /Warning/i.test(headline)
              ? "Tsunami Warning"
              : /Advisory/i.test(headline)
                ? "Tsunami Advisory"
                : /Watch/i.test(headline)
                  ? "Tsunami Watch"
                  : headline,
            headline,
            description: detailText.slice(0, 1200),
            areaDesc: "See tsunami.gov",
            sent: new Date().toISOString(),
            effective: new Date().toISOString(),
            link: `https://www.tsunami.gov/?p=${first.id}`,
            tsunamiGovLink: `https://www.tsunami.gov/?p=${first.id}`,
            quake: parseQuakeFromText(detailText),
          },
        ];
      }
    }
  } catch (e) {
    console.warn(e);
  }
  return [];
}
// ===== PHIVOLCS (tsunami.phivolcs.dost.gov.ph) =====
// tsunami.gov / NWS only covers the US Pacific + Atlantic/Caribbean basins, so it
// is silent for the events a PH audience actually cares about. This reads the
// in-repo PHP scraper, which normalises PHIVOLCS bulletins into JSON.
// NB: the host directory is "terraguard". A near-miss like "terragad" (one char off)
  // is not a directory here and falls through to the SPA catch-all, which answers
  // 200 text/html instead of failing loudly.
// falls through to the host's SPA catch-all and returns the TrikeFare Gensan
// index.html with a 404, which looks like a working host but is not.
// Same endpoint without a query string. PHIVOLCS_TSUNAMI_API already carries
// "?page=events", so appending "?detail=1" to it would fold detail into the page
// parameter and silently return the list instead of the advisory.
const PHIVOLCS_TSUNAMI_BASE =
  "https://trikefare.x10.mx/terraguard/api/tsunami.php";
const PHIVOLCS_TSUNAMI_API =
  "https://trikefare.x10.mx/terraguard/api/tsunami.php?page=events";
// Backup host (InfinityFree) — tried when the primary 503s / is unreachable.
const PHIVOLCS_TSUNAMI_API_BACKUP =
  "https://terraguard-auto.page.gd/terraguard/api/tsunami.php?page=events";

// One alert per advisory bulletin. PHIVOLCS re-issues numbered advisories for the
// same earthquake (sometimes a .html and a .pdf), and each new one is genuinely
// new information, so the advisory URL is the unit of novelty — and the dedup id.
async function fetchPhivolcsTsunamiAlerts() {
  try {
    let r = null;
    for (const apiUrl of [PHIVOLCS_TSUNAMI_API, PHIVOLCS_TSUNAMI_API_BACKUP]) {
      try {
        r = await fetch(apiUrl, {
          headers: {
            "User-Agent": "TerraGuard-Tsunami/1.0",
            Accept: "application/json",
          },
        });
        if (r.ok) break;
        console.warn(`[tsunami] PHIVOLCS HTTP ${r.status} from ${apiUrl}, trying backup…`);
      } catch (e) {
        console.warn(`[tsunami] PHIVOLCS fetch failed for ${apiUrl}, trying backup…`);
        r = null;
      }
    }
    if (!r || !r.ok) {
      console.warn(`[tsunami] PHIVOLCS all hosts unreachable`);
      return [];
    }
    const j = await r.json();
    if (!j || j.success !== true || !Array.isArray(j.data)) {
      console.warn("[tsunami] PHIVOLCS returned an unexpected payload");
      return [];
    }
    const out = [];
    for (const row of j.data) {
      if (!row) continue;
      const advisories =
        Array.isArray(row.advisories) && row.advisories.length
          ? row.advisories
          : row.link
            ? [{ label: "Tsunami Information", url: row.link, isPdf: false }]
            : [];
      for (const a of advisories) {
        if (!a || !a.url) continue;
        // Coordinates are already structured, so quakeCoords() can read them
        // straight off latLon instead of re-parsing bulletin prose.
        const lat = row.latitude;
        const lon = row.longitude;
        const latLon =
          lat != null && lon != null
            ? `Lat: ${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"} ` +
              `Lon: ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`
            : "";
        const occurred = row.occurredAtUtc || "";
        out.push({
          id: a.url,
          source: "phivolcs",
          event: a.label || "Tsunami Information",
          headline: a.label || "Tsunami Information",
          description: [
            row.location,
            row.magnitude != null ? `Magnitude ${row.magnitude}` : "",
            row.depth != null ? `Depth ${row.depth} km` : "",
          ]
            .filter(Boolean)
            .join(" — "),
          areaDesc: row.location || "See PHIVOLCS",
          sent: occurred || new Date().toISOString(),
          effective: occurred || new Date().toISOString(),
          // PHIVOLCS has no CAP status field; mark it real so isTestAlert() can
          // never mistake a genuine bulletin for a drill.
          status: "actual",
          messageType: "Tsunami Information",
          link: a.url,
          tsunamiGovLink: a.url,
          isPdf: !!a.isPdf,
          advisoryNumber: a.number ?? null,
          // The list endpoint exposes no verdict — only the advisory detail page
          // does ("NO TSUNAMI THREAT" / "TSUNAMI WARNING"). Default to
          // informational rather than guessing a threat from the label; the card
          // then renders a neutral blue banner instead of a false red one.
          threat: "information",
          quake: {
            originTime: occurred || row.dateTimePST || "",
            magnitude: row.magnitude != null ? String(row.magnitude) : "",
            depth: row.depth != null ? `${row.depth} km` : "",
            location: row.location || "",
            latLon,
          },
        });
      }
    }
    return out;
  } catch (e) {
    console.warn("[tsunami] PHIVOLCS fetch failed", e);
    return [];
  }
}

// PHIVOLCS first, then the US basin sources as a supplement.
/**
 * The PHIVOLCS list endpoint carries no threat field, so every advisory would
 * render as a neutral blue "TSUNAMI INFORMATION" banner — a real tsunami
 * warning would look identical to a routine M6.5. The verdict ("NO TSUNAMI
 * THREAT" / "TSUNAMI THREAT") lives only on the advisory's own page, which the
 * scraper already parses via ?detail=1&url=...
 *
 * Called only for advisories that are about to be posted or previewed, so it
 * costs about one request per new bulletin. Failure is non-fatal: the alert
 * falls back to list data and keeps its neutral banner.
 */
async function enrichPhivolcsAlert(alert) {
  if (alert.source !== "phivolcs" || !alert.link) return { ...alert, detailFetched: false };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(
      `${PHIVOLCS_TSUNAMI_BASE}?detail=1&url=${encodeURIComponent(alert.link)}`,
      { headers: { "User-Agent": "TerraGuard-Detail/1.0" }, signal: ctrl.signal },
    );
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const d = j && j.success === true ? j.data : null;
    // The list endpoint answers with success:true and a `data` ARRAY of events.
    // Without this guard a malformed detail request (e.g. ?page=events?detail=1)
    // looks like a success and silently merges nothing.
    if (!d || Array.isArray(d) || typeof d !== "object")
      throw new Error("response had no detail object");
    if (!d.threat && !d.headline)
      throw new Error("detail object carried no verdict");

    const out = { ...alert, detailFetched: true };
    if (d.threat) out.threat = d.threat;
    if (d.headline) out.detailHeadline = d.headline;
    if (d.evaluation) out.evaluation = d.evaluation;
    if (d.recommendedAction) out.recommendedAction = d.recommendedAction;
    if (d.important) out.important = d.important;
    if (d.issuedBy) out.issuedBy = d.issuedBy;

    // The detail page carries the authoritative quake parameters. Prefer them
    // over the values scraped from the list row, and keep the coordinates in
    // the latLon string too, since buildTsunamiMessage reads that field.
    const q = { ...(alert.quake || {}) };
    if (d.magnitude != null) q.magnitude = String(d.magnitude);
    if (d.depth != null) q.depth = `${d.depth} km`;
    if (d.location) q.location = d.location;
    if (d.latitude != null && d.longitude != null) {
      q.lat = d.latitude;
      q.lng = d.longitude;
      const fmt = (v, pos, neg) =>
        `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;
      q.latLon = `Lat: ${fmt(d.latitude, "N", "S")} Lon: ${fmt(d.longitude, "E", "W")}`;
    }
    if (Object.keys(q).length) out.quake = q;

    // Reflect the verdict in the event string, because tsunamiColor(),
    // tsunamiEmoji() and the @everyone gate all key off it. "none" keeps the
    // original wording, which already reads as a no-threat information note.
    const verdict = String(d.threat || "").toLowerCase();
    if (verdict === "warning") out.event = `Tsunami Warning${d.number != null ? ` # ${d.number}` : ""}`;
    else if (verdict === "threat") out.event = `Tsunami Threat${d.number != null ? ` # ${d.number}` : ""}`;
    else if (verdict === "advisory") out.event = `Tsunami Advisory${d.number != null ? ` # ${d.number}` : ""}`;
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[tsunami] detail fetch failed for ${alert.id}: ${msg}`);
    return { ...alert, detailFetched: false, detailError: msg.slice(0, 160) };
  }
}

async function fetchAllTsunamiAlerts() {
  const [phivolcs, us] = await Promise.all([
    fetchPhivolcsTsunamiAlerts(),
    fetchTsunamiAlerts(),
  ]);
  return { alerts: [...phivolcs, ...us], phivolcsCount: phivolcs.length, usCount: us.length };
}

function tsunamiColor(e) {
  e = e.toLowerCase();
  if (e.includes("warning")) return 0xef4444;
  if (e.includes("advisory")) return 0xf59e0b;
  if (e.includes("watch")) return 0x3b82f6;
  return 0x10b981;
}
function tsunamiEmoji(e) {
  e = e.toLowerCase();
  if (e.includes("warning")) return "🚨";
  if (e.includes("advisory")) return "⚠️";
  if (e.includes("watch")) return "👀";
  return "🌊";
}

function tsunamiSeverityLabel(e) {
  const s = String(e || "").toLowerCase();
  if (s.includes("warning")) return "WARNING";
  if (s.includes("advisory")) return "ADVISORY";
  if (s.includes("watch")) return "WATCH";
  return String(e || "INFORMATION").toUpperCase();
}

// Pull the triggering earthquake's parameters out of alert text.
// Handles tsunami.gov message pages ("Magnitude: 5.2", "Origin Time: ...",
// "Depth: 12 mi.", "Lat: 51.2° N Lon: 178.5° W", "Location: ...") and NWS
// CAP style ("MAG - 5.2", "ORIGIN TIME - ...", "COORDINATES - ...").
// Captures stop at the next known label so flattened single-line text
// doesn't bleed one field into another.
function parseQuakeFromText(text) {
  const t = String(text || "");
  const stop = "(?:Depth|Lat|Lon|Location|Magnitude|\\bMAG\\b|Origin|Coordinates|Note:|See the|$)";
  const q = {};
  const mag =
    /magnitude\s*[:\-]?\s*([\d.]+)/i.exec(t)?.[1] ||
    /\bMAG\s*[-:]?\s*([\d.]+)/i.exec(t)?.[1];
  if (mag) q.magnitude = mag;
  const origin = new RegExp(`origin\\s*time\\s*[:\\-]?\\s*(.+?)(?=\\s*${stop})`, "i").exec(t)?.[1];
  if (origin) q.originTime = origin.trim().replace(/\s+/g, " ");
  const depth = new RegExp(`depth\\s*[:\\-]?\\s*(.+?)(?=\\s*${stop})`, "i").exec(t)?.[1];
  if (depth) q.depth = depth.trim().replace(/\s+/g, " ").replace(/\.\s*$/, "");
  const lat = /Lat:\s*(.+?)(?=\s+Lon:)/i.exec(t)?.[1];
  const lon = new RegExp(`Lon:\\s*(.+?)(?=\\s*${stop})`, "i").exec(t)?.[1];
  if (lat && lon) {
    q.latLon = `Lat: ${lat.trim()} Lon: ${lon.trim()}`.replace(/\s+/g, " ");
  } else {
    const coords = new RegExp(`COORDINATES?\\s*[:\\-]?\\s*(.+?)(?=\\s*${stop})`, "i").exec(t)?.[1];
    if (coords) q.latLon = coords.trim().replace(/\s+/g, " ");
  }
  const loc = new RegExp(`location\\s*[:\\-]?\\s*(.+?)(?=\\s*${stop})`, "i").exec(t)?.[1];
  if (loc) {
    const clean = loc.trim().replace(/\s+/g, " ");
    if (clean.length >= 3 && !/^lat:|^lon:|^coordinates/i.test(clean))
      q.location = clean;
  }
  return q;
}

// Real threat (posts to Facebook) vs informational (Discord only).
function isTsunamiThreat(alert) {
  return (
    !/no tsunami|no warning.*or threat/i.test(alert.event) &&
    /warning|advisory|watch/i.test(alert.event)
  );
}

// NWS drills must never reach Discord or Facebook. Primary signal is the
// CAP `status` field (Actual vs Test/Exercise/System/Draft); headline and
// event text are the backup (tsunami.gov fallback carries no status).
function isTestAlert(alert) {
  const status = String(alert?.status || "").trim().toLowerCase();
  if (status && status !== "actual") return true;
  const text = `${alert?.event || ""} ${alert?.headline || ""}`;
  return /\b(TEST|EXERCISE|DEMO|DRILL)\b/i.test(text);
}

// NWS areaDesc can list hundreds of zones (entire coastlines). Summarize
// to a readable prefix instead of dumping it into the FB Location line.
function summarizeAreas(areaDesc, maxLen = 300) {
  const raw = String(areaDesc || "").trim();
  if (!raw) return "";
  const zones = raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (zones.length <= 3 && raw.length <= maxLen) return raw;
  const head = zones.slice(0, 3).join("; ");
  const shown = head.length > maxLen ? head.slice(0, maxLen - 1) + "…" : head;
  return `${shown} … (+${Math.max(0, zones.length - 3)} more zones)`;
}

// ===== Facebook auto-post (THREATS ONLY — statements never post) =====
// Env (same Cloudflare secrets as earthquake.js):
//   FB_PAGE_ID, FB_USER_ACCESS_TOKEN, FB_APP_ID, FB_APP_SECRET (proof),
//   FB_TSUNAMI_AREA_FOCUS (optional substring match on areas+headline,
//   "ALL"/"*" or empty = worldwide). Text-only /feed post (no map image).
// Best-effort: never throws, never blocks Discord.

const FB_GRAPH_VERSION = "v21.0";

async function fbAppSecretProof(accessToken, appSecret) {
  try {
    if (!accessToken || !appSecret || !crypto?.subtle) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(appSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(accessToken),
    );
    return [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

async function getFacebookPageToken(env) {
  const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
  const pageId = (env.FB_PAGE_ID ?? "").trim();
  if (!userToken || !pageId) return null;
  try {
    const proof = await fbAppSecretProof(
      userToken,
      (env.FB_APP_SECRET ?? "").trim(),
    );
    const url = new URL(
      `https://graph.facebook.com/${FB_GRAPH_VERSION}/me/accounts`,
    );
    url.searchParams.set("access_token", userToken);
    url.searchParams.set("fields", "id,name,access_token");
    url.searchParams.set("limit", "50");
    if (proof) url.searchParams.set("appsecret_proof", proof);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const match = (data?.data ?? []).find((p) => String(p.id) === String(pageId));
    return match?.access_token ? String(match.access_token) : null;
  } catch {
    return null;
  }
}

function buildTsunamiMessage(alert) {
  const sentDate = new Date(alert.sent || alert.effective);
  const isPhivolcs = alert.source === "phivolcs";
  const sourceLine = isPhivolcs
    ? `PHIVOLCS (tsunami.phivolcs.dost.gov.ph)`
    : `tsunami.gov / NWS`;
  const sentStr = `${sentDate.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "2-digit",
  })} - ${sentDate.toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })} UTC`;
  const emoji = tsunamiEmoji(alert.event);
  const label = tsunamiSeverityLabel(alert.event);
  const q = alert.quake || {};
  const dateTime = q.originTime || sentStr;
  const coordsLine = q.latLon
    ? q.location
      ? `${q.latLon} - ${q.location}`
      : q.latLon
    : q.location || summarizeAreas(alert.areaDesc) || "See details";
  const link = alert.tsunamiGovLink || alert.link;
  // "Issued Wed Aug 05 04:24:02 UTC 2026" style (message issue time, UTC).
  const issuedDate = new Date(alert.sent || alert.effective);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad2 = (n) => String(n).padStart(2, "0");
  const issuedUtc = isNaN(issuedDate.getTime())
    ? ""
    : `${DAYS[issuedDate.getUTCDay()]} ${MONTHS[issuedDate.getUTCMonth()]} ${pad2(issuedDate.getUTCDate())} ` +
      `${pad2(issuedDate.getUTCHours())}:${pad2(issuedDate.getUTCMinutes())}:${pad2(issuedDate.getUTCSeconds())} UTC ${issuedDate.getUTCFullYear()}`;
  // tsunamiSeverityLabel() falls through to the event text itself for anything
  // that is not Warning/Advisory/Watch (e.g. PHIVOLCS "Tsunami Information # 1"),
  // so avoid printing the same string twice.
  const eventUp = String(alert.event || "TSUNAMI INFORMATION").toUpperCase();
  const titleLine =
    label === eventUp
      ? `${emoji} ${eventUp} ${emoji}`
      : `${emoji}${label}: ${eventUp} ${emoji}`;
  // PHIVOLCS's own verdict, when the detail page was fetched. Without it the
  // banner reads a neutral "TSUNAMI INFORMATION" and gives no indication of
  // whether a destructive tsunami is actually possible.
  const verdict = alert.detailHeadline ? [`Verdict: ${alert.detailHeadline}`] : [];
  const evaluation = alert.evaluation ? [`Evaluation: ${alert.evaluation}`] : [];
  const action = alert.recommendedAction ? [`Recommended action: ${alert.recommendedAction}`] : [];
  return [
    titleLine,
    ``,
    ...verdict,
    ...evaluation,
    ...action,
    ...(verdict.length || evaluation.length || action.length ? [``] : []),
    `Date & Time: ${dateTime}`,
    `Magnitude: ${q.magnitude || "N/A"}`,
    `Depth: ${q.depth || "N/A"}`,
    `Location: ${coordsLine}`,
    ``,
    `Details: ${link}`,
    `A visual representation of the tsunami threat based on available advisory data.`,
    ``,
    `Message: ${alert.headline || alert.event}`,
    ...(issuedUtc ? [`Issued ${issuedUtc}`] : []),
    ``,
    `Source: ${sourceLine}`,
    ``,
    `Join our discord for more informations: https://discord.gg/tdGrvnvehP`,
    `#Tsunami #TsunamiWarning #TsunamiAdvisory #TerraGuard #TerraGuardPH #StaySafe #DisasterPreparedness #BreakingNews #NaturalDisaster #BeSafe`,
  ].join("\n");
}

// Numeric epicenter from a parsed quake latLon string, e.g.
// "Lat: 51.2° N Lon: 178.5° W" or "51.2 NORTH 178.5 WEST".
// Returns { lat, lng } or null when unparseable (photo post is skipped).
function quakeCoords(alert) {
  const s = String(alert?.quake?.latLon || "");
  if (!s) return null;
  const num = (v, dir) => {
    if (v == null) return null;
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
    if (isNaN(n)) return null;
    const d = String(dir || "").toUpperCase();
    return d === "S" || d === "W" || d === "SOUTH" || d === "WEST" ? -n : n;
  };
  let m = /Lat:\s*([\d.]+)\s*°?\s*([NS])[^0-9]*Lon:\s*([\d.]+)\s*°?\s*([EW])/i.exec(s);
  if (m) {
    const lat = num(m[1], m[2]);
    const lng = num(m[3], m[4]);
    if (lat != null && lng != null) return { lat, lng };
  }
  m = /([\d.]+)\s*(NORTH|SOUTH)\s+([\d.]+)\s*(EAST|WEST)/i.exec(s);
  if (m) {
    const lat = num(m[1], m[2]);
    const lng = num(m[3], m[4]);
    if (lat != null && lng != null) return { lat, lng };
  }
  return null;
}

/**
 * Build the Facebook card URL for an alert, or "" when the epicenter is unknown.
 * Shared by the real photo post and the ?dryrun preview so the two can never
 * drift apart.
 */
function tsunamiCardUrl(alert, coords) {
  // Dedicated tsunami card (apiphp/tsunami-card.php): shows the PHIVOLCS
  // threat level as a colour-coded banner, which the generic quake card cannot.
  // Host directory must be exactly "terraguard". This shipped once as "terragad",
  // which is not a directory here: the SPA catch-all answers 200 text/html, the
  // Facebook photo post silently downgraded to /feed, and Discord got no image.
  // ensureTsunamiCard() now blocks that, but keep the path right.
  const issuedStr = (() => {
    const d = new Date(alert.sent || alert.effective);
    if (isNaN(d.getTime())) return "";
    const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getUTCDate())} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()} - ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
  })();
  // PHIVOLCS advisories carry an explicit threat. US-basin alerts (tsunami.gov /
  // NWS) only have an event string, so map its severity onto the card's
  // vocabulary — otherwise a real Tsunami Warning would render with a neutral
  // blue "TSUNAMI INFORMATION" banner.
  //
  // Order matters. "threat" is checked first because the card's most severe
  // level is TSUNAMI THREAT (red); without that branch a destructive-tsunami
  // bulletin fell through to "information" and rendered blue, i.e. harmless.
  // "no ... threat" is excluded so a negated headline is never escalated.
  const eventStr = String(alert.event || "");
  const negatedThreat = /no\s+(?:\w+\s+){0,3}?threat|not\s+a\s+threat/i.test(eventStr);
  const threatLevel =
    alert.threat ||
    (negatedThreat ? "none"
      : /\bthreat\b/i.test(eventStr) ? "threat"
        : /warning/i.test(eventStr) ? "warning"
          : /advisory|watch/i.test(eventStr) ? "advisory"
            : /cancel|all clear/i.test(eventStr) ? "cancelled"
              : "information");
  return (
    `https://trikefare.x10.mx/terraguard/api/tsunami-card.php` +
    `?lat=${coords.lat}&lng=${coords.lng}` +
    `&mag=${encodeURIComponent(alert.quake?.magnitude ?? "")}` +
    // Keep the depth unit as-is: PHIVOLCS gives "18", NWS gives "12 mi". The card
    // decides how to label it, so only strip a redundant "km".
    `&depth=${encodeURIComponent(String(alert.quake?.depth ?? "").replace(/\s*km$/i, ""))}` +
    `&place=${encodeURIComponent(alert.quake?.location || alert.areaDesc || "")}` +
    `&threat=${encodeURIComponent(threatLevel)}` +
    `&source=${encodeURIComponent(alert.source === "phivolcs" ? "PHIVOLCS" : "tsunami.gov / NWS")}` +
    (alert.advisoryNumber != null ? `&info=${encodeURIComponent(alert.advisoryNumber)}` : "") +
    (issuedStr ? `&issued=${encodeURIComponent(issuedStr)}` : "")
  );
}

/**
 * Confirm the card URL really renders a PNG, and memoise the result.
 *
 * Both the Facebook photo post and the Discord embed need this. Without the
 * check a bad host path is invisible: Facebook quietly downgrades to a text
 * /feed post and Discord shows an embed with no image, and neither reports a
 * failure. The memo avoids fetching the same ~750 KB PNG twice per advisory.
 */
const tsunamiCardMemo = new Map();
async function ensureTsunamiCard(alert) {
  const coords = quakeCoords(alert);
  if (!coords) return { url: "", ok: false, reason: "no epicenter" };
  const url = tsunamiCardUrl(alert, coords);
  const backupUrl = url.replace("https://trikefare.x10.mx/terraguard", "https://terraguard-auto.page.gd/terraguard");
  const candidates = backupUrl !== url ? [url, backupUrl] : [url];
  if (tsunamiCardMemo.has(url)) return tsunamiCardMemo.get(url);
  let ok = false, reason = "unknown";
  let workingUrl = url;
  for (const candidate of candidates) {
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const r = await fetch(candidate, {
          method: "GET",
          signal: ctrl.signal,
          headers: { "User-Agent": "TerraGuard-CardCheck/1.0" },
        });
        clearTimeout(timer);
        // Require an actual image. A 200 that is text/html means we hit the SPA
        // catch-all (wrong host path) rather than a card.
        const ctype = String(r.headers?.get?.("content-type") ?? "").toLowerCase();
        if (r.ok && ctype.startsWith("image/")) { ok = true; workingUrl = candidate; }
        else reason = `HTTP ${r.status} ${ctype || "(no content-type)"}`;
      } catch (e) {
        reason = e instanceof Error ? e.message : String(e);
      }
      if (!ok) await new Promise((r) => setTimeout(r, 800));
    }
    if (ok) break;
  }
  const out = { url: workingUrl, ok, reason: ok ? "" : reason };
  if (ok) {
    // Only successes are memoised. Caching a failure would suppress the card
    // image for the remaining life of this isolate after a single transient
    // 404, which is exactly the silent failure this check exists to prevent.
    if (tsunamiCardMemo.size > 20) tsunamiCardMemo.clear();
    tsunamiCardMemo.set(url, out);
  } else {
    console.error(`[tsunami] card not renderable (${reason}) url=${url}`);
  }
  return out;
}

async function postTsunamiToFacebook(alert, env) {
  const pageId = (env.FB_PAGE_ID ?? "").trim();
  const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
  const appSecret = (env.FB_APP_SECRET ?? "").trim();
  if (!pageId || !userToken)
    return "skipped (FB_PAGE_ID / FB_USER_ACCESS_TOKEN not set)";
  // PHIVOLCS bulletins are posted as-is: each new advisory is new information,
  // even when it carries no threat. tsunami.gov items keep the threat-only gate.
  if (alert.source !== "phivolcs" && !isTsunamiThreat(alert))
    return `skipped (not a threat: ${alert.event})`;
  if (isTestAlert(alert))
    return "skipped (test/exercise alert)";
  const focusRaw = (env.FB_TSUNAMI_AREA_FOCUS ?? "").trim();
  const focusUpper = focusRaw.toUpperCase();
  if (focusRaw && focusUpper !== "ALL" && focusUpper !== "*") {
    const haystack = `${alert.areaDesc ?? ""} ${alert.headline ?? ""}`.toUpperCase();
    const focuses = focusRaw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (
      !focuses.includes("ALL") &&
      !focuses.includes("*") &&
      !focuses.some((f) => haystack.includes(f))
    )
      return `skipped (outside FB_TSUNAMI_AREA_FOCUS ${focusRaw})`;
  }
  let pageToken = await getFacebookPageToken(env);
  if (!pageToken) pageToken = userToken; // may already be a Page token
  const proof = await fbAppSecretProof(pageToken, appSecret);
  const message = buildTsunamiMessage(alert);
  const withProof = (params) => {
    if (proof) params.appsecret_proof = proof;
    return params;
  };
  // 1) Preferred: world-view card photo when the epicenter is known.
  // Warmed first: the first hit fetches map tiles, and FB's scraper times out on
  // slow responses (then we'd silently downgrade).
  const coords = quakeCoords(alert);
  if (coords) {
    try {
      const card = await ensureTsunamiCard(alert);
      const cardOk = card.ok;
      if (!cardOk) {
        console.error(`[fb][tsunami] card unusable (${card.reason}), using /feed fallback`);
      } else {
        const body = withProof({ access_token: pageToken, caption: message, url: card.url });
      const res = await fetch(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/photos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.post_id || data.id))
        return `posted photo ${data.post_id ?? data.id}`;
      console.error(
        `[fb][tsunami] photo post failed: ${String(data?.error?.message ?? `HTTP ${res.status}`).slice(0, 300)}`,
      );
      // fall through to /feed fallback
      }
    } catch (e) {
      console.error("[fb][tsunami] photo post exception", e instanceof Error ? e.message : String(e));
    }
  }
  // 2) Fallback: plain feed post with link (also used when coords unknown).
  const body = withProof({ access_token: pageToken, message, link: alert.tsunamiGovLink || alert.link });
  try {
    const res = await fetch(
      `https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/feed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id)
      return `error ${data?.error?.message ?? `HTTP ${res.status}`}`.slice(0, 200);
    return `posted ${data.id}`;
  } catch (e) {
    return `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
  }
}
async function sendTsunamiWebhook(alert, env) {
  const webhook = env.TSUNAMI_WEBHOOK_URL;
  if (!webhook) throw new Error("TSUNAMI_WEBHOOK_URL not set");
  const color = tsunamiColor(alert.event),
    emoji = tsunamiEmoji(alert.event);
  const sentDate = new Date(alert.sent || alert.effective);
  const dateStr = sentDate.toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "2-digit",
  });
  const timeStr = sentDate.toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
  const isThreat =
    !/no tsunami|no warning.*or threat/i.test(alert.event) &&
    /warning|advisory|watch/i.test(alert.event);
  const mention = isThreat ? "@everyone " : "";
  const srcLine =
    alert.source === "phivolcs"
      ? "PHIVOLCS (tsunami.phivolcs.dost.gov.ph)"
      : "tsunami.gov / NWS";
  // PHIVOLCS advisories already read "Tsunami Information # 1", so blindly
  // prefixing TSUNAMI produced "TSUNAMI TSUNAMI INFORMATION # 1".
  const eventUpper = String(alert.event || "").toUpperCase();
  const heading = /^TSUNAMI\b/.test(eventUpper) ? eventUpper : `TSUNAMI ${eventUpper}`;
  // PHIVOLCS's own verdict and evaluation, present only when the advisory's
  // detail page was fetched. Without these a genuine tsunami warning reads the
  // same as a routine information note.
  const verdict = alert.detailHeadline ? `\n**Verdict: ${alert.detailHeadline}**` : "";
  const evaluation = alert.evaluation ? `\n🧭 ${alert.evaluation}` : "";
  const action = alert.recommendedAction ? `\n✅ ${alert.recommendedAction}` : "";
  const content = `${mention}${emoji} **${heading}** ${emoji}\n\n**${alert.headline}**${verdict}${evaluation}${action}\n\n📍 **Areas:** ${alert.areaDesc?.slice(0, 400) || "See details"}\n📅 **Issued:** ${dateStr} ${timeStr}\n🔗 **Details:** ${alert.link}\n\n${alert.description?.slice(0, 900) || ""}\n\n*Source: ${srcLine}*`;
  // Attach the world-view card to the embed. Verified first: a bad host path
  // returns the SPA catch-all as text/html, and Discord would render an embed
  // with a silently missing image rather than reporting anything.
  const card = await ensureTsunamiCard(alert);
  if (!card.ok) console.error(`[tsunami][discord] no card image: ${card.reason}`);
  const payload = {
    content,
    ...(isThreat ? { allowed_mentions: { parse: ["everyone"] } } : {}),
    embeds: [
      {
        title: `${emoji} ${alert.event} — ${alert.headline.slice(0, 80)}`,
        description: `${alert.description?.slice(0, 1000) || ""}\n\n[View on tsunami.gov](${alert.tsunamiGovLink || alert.link})`,
        color,
        ...(card.ok ? { image: { url: card.url } } : {}),
        footer: { text: `TerraGuard Tsunami • ${dateStr} ${timeStr}` },
        timestamp: sentDate.toISOString(),
      },
    ],
  };
  const waitUrl = webhook.includes("?")
    ? `${webhook}&wait=true`
    : `${webhook}?wait=true`;
  const res = await fetch(waitUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Tsunami webhook ${res.status}: ${t.slice(0, 500)}`);
  }
  try {
    const msg = await res.json();
    if (msg?.id) {
      const emojis = ["%F0%9F%8C%8A", "%E2%9A%A0%EF%B8%8F"];
      if (env.BOT_TOKEN && msg.channel_id) {
        for (const e of emojis) {
          await fetch(
            `https://discord.com/api/v10/channels/${msg.channel_id}/messages/${msg.id}/reactions/${e}/@me`,
            {
              method: "PUT",
              headers: { Authorization: `Bot ${env.BOT_TOKEN}` },
            },
          ).catch(() => {});
          await new Promise((r) => setTimeout(r, 300));
        }
      } else {
        const m = /\/webhooks\/(\d+)\/([^/?]+)/.exec(webhook);
        if (m) {
          const whId = m[1],
            whToken = m[2];
          for (const e of emojis) {
            await fetch(
              `https://discord.com/api/webhooks/${whId}/${whToken}/messages/${msg.id}/reactions/${e}/@me`,
              { method: "PUT" },
            ).catch(() => {});
            await new Promise((r) => setTimeout(r, 300));
          }
        }
      }
    }
  } catch {}
}
// Advisory URLs already posted, kept as one bounded set rather than one KV key
// per bulletin. PHIVOLCS serves ~80 historical advisories on ?page=events, so the
// very first run seeds this set instead of firing the whole backlog at the channel.
const PHIVOLCS_SEED_KEY = "tsunami:phivolcs:seen";
const PHIVOLCS_SEED_MAX = 400;

async function loadPhivolcsSeen(env) {
  const raw = await env.WEBHOOK_KV.get(PHIVOLCS_SEED_KEY);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}
async function savePhivolcsSeen(env, list) {
  // Keep the most recent entries; PHIVOLCS advisories never change once issued,
  // but trimming keeps the value small.
  const trimmed = list.slice(-PHIVOLCS_SEED_MAX);
  await env.WEBHOOK_KV.put(PHIVOLCS_SEED_KEY, JSON.stringify(trimmed), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
}

/**
 * Read-only preview for /trigger-tsunami?dryrun=1. Fetches both sources and
 * reports exactly what would be posted — message text, card URL, coords, threat
 * and whether the dedup gate would let it through — without posting anything or
 * writing to KV. Safe to call as often as you like.
 */
async function previewAlerts(env, limit) {
  const { alerts, phivolcsCount, usCount } = await fetchAllTsunamiAlerts();
  const seen = (await loadPhivolcsSeen(env)) ?? null;
  const seenSetPresent = seen !== null;
  const isNew = async (a) =>
    a.source === "phivolcs"
      ? !(seenSetPresent && seen.includes(a.id))
      : !(await env.WEBHOOK_KV.get(`tsunami:${a.id}`));

  // Count over every alert, not just the previewed slice, so the totals are real.
  let newCount = 0;
  for (const a of alerts) if (await isNew(a)) newCount++;

  const previews = [];
  for (const a of alerts) {
    if (previews.length >= limit) break;
    const isNewItem = await isNew(a);
    // Only advisories that would actually be posted need their detail page, so
    // a preview costs at most one extra request per pending bulletin.
    const view =
      a.source === "phivolcs" && isNewItem && seenSetPresent
        ? await enrichPhivolcsAlert(a)
        : a;
    const coords = quakeCoords(view);
    previews.push({
      source: view.source,
      event: view.event,
      isTest: isTestAlert(view),
      seenAlready: !isNewItem,
      // A real run only posts when the seen-set already exists; with no seen-set
      // the next run seeds and posts nothing.
      wouldPost: isNewItem && seenSetPresent,
      threat: view.threat ?? null,
      detailHeadline: view.detailHeadline ?? null,
      coords,
      cardUrl: coords ? tsunamiCardUrl(view, coords) : "",
      message: buildTsunamiMessage(view),
    });
  }
  return {
    dryRun: true,
    fetched: { phivolcs: phivolcsCount, tsunamiGov: usCount, total: alerts.length },
    seenSetPresent,
    seenSetSize: seenSetPresent ? seen.length : 0,
    newCount,
    wouldPostNow: seenSetPresent ? newCount : 0,
    note: seenSetPresent
      ? "Preview only — nothing was posted and KV was not modified."
      : "No seen-set yet: the next real run would SEED and post nothing.",
    previews,
  };
}

/**
 * Synthetic tsunami.gov / NWS advisory for /admin?fixture=nws.
 *
 * There is rarely a live US-basin tsunami advisory, so the NWS branch of the
 * pipeline (CAP parsing, miles-vs-km depth, world-view card, threat colours,
 * Facebook threat gate) would otherwise go untested until the US basin actually
 * issues something. This builds an alert shaped exactly like a real
 * api.weather.gov CAP feature and feeds it through the same send path, so only
 * the input is fake.
 *
 * The body uses the labelled form the parser expects, matching the tsunami.gov
 * message layout: Magnitude / Origin Time / Depth / Lat / Lon / Location.
 */
const NWS_FIXTURES = {
  warning: {
    event: "Tsunami Warning",
    lat: 19.2, lng: -155.6, mag: 7.8, depth: "12 mi.",
    place: "290 km SE of Hilo, Hawaii",
    area: "Hawaii; American Samoa; Guam",
    headline: "Tsunami Warning for Hawaii and the South Pacific",
  },
  threat: {
    event: "Tsunami Threat",
    lat: -33.5, lng: -72.0, mag: 8.2, depth: "25 km",
    place: "Coast of Chile",
    area: "Chile; Peru",
    headline: "Tsunami Threat for the Coast of Chile and Peru",
  },
  advisory: {
    event: "Tsunami Advisory",
    lat: 38.3, lng: 142.4, mag: 7.5, depth: "10 km",
    place: "Off the coast of Japan",
    area: "Japan; Kuril Islands",
    headline: "Tsunami Advisory for Japan and the Kuril Islands",
  },
  watch: {
    event: "Tsunami Watch",
    lat: 47.9, lng: -125.0, mag: 7.1, depth: "20 km",
    place: "Off the coast of Washington",
    area: "Washington; Oregon; California; Alaska; British Columbia; Baja California",
    headline: "Tsunami Watch for the Cascadia and Baja Coasts",
  },
  information: {
    event: "Tsunami Information",
    lat: -21.2, lng: 168.5, mag: 7.0, depth: "18 km",
    place: "Loyalty Islands",
    area: "New Caledonia; Vanuatu; Fiji",
    headline: "Tsunami Information Bulletin",
  },
  cancelled: {
    event: "Tsunami Cancellation",
    lat: 51.2, lng: -178.5, mag: 7.8, depth: "12 mi.",
    place: "Aleutian Islands, Alaska",
    area: "Alaska; British Columbia; Washington; Oregon; California",
    headline: "Tsunami Cancellation for the Coast of the Pacific Northwest",
  },
};

function buildNwsFixture(level) {
  const key = String(level || "warning").toLowerCase();
  const p = NWS_FIXTURES[key];
  if (!p)
    return { error: `unknown fixture level "${level}". Use one of: ${Object.keys(NWS_FIXTURES).join(", ")}` };
  const issued = new Date();
  const body = [
    `Magnitude: ${p.mag}`,
    `Origin Time: ${issued.toISOString().slice(0, 16)} UTC`,
    `Depth: ${p.depth}`,
    `Lat: ${Math.abs(p.lat).toFixed(1)}° ${p.lat >= 0 ? "N" : "S"} Lon: ${Math.abs(p.lng).toFixed(1)}° ${p.lng >= 0 ? "E" : "W"}`,
    `Location: ${p.place}`,
  ].join("\n");
  const description = [
    `WWUS54 KWNH 261812`,
    `TSUNAMI - TSUNAMI MESSAGE`,
    `NATIONAL WEATHER SERVICE HONOLULU HI`,
    ``,
    `...${p.event.toUpperCase()} FOR ${p.area.toUpperCase()}...`,
    ``,
    `THE ${p.event.toUpperCase()} FOR ${p.area.toUpperCase()} IS IN EFFECT.`,
    ``,
    `An earthquake has been detected. Preliminary tsunami arrival times follow.`,
    ``,
    body,
    ``,
    `This message is a SYNTHETIC FIXTURE generated by TerraGuard for pipeline`,
    `testing. It is not a real bulletin and describes no real earthquake.`,
  ].join("\n");
  return {
    id: `fixture-nws-${key}`,
    source: "us",
    fixture: true,
    fixtureLevel: key,
    event: p.event,
    headline: p.headline,
    description,
    areaDesc: p.area,
    sent: issued.toISOString(),
    effective: issued.toISOString(),
    expires: new Date(issued.getTime() + 3600000).toISOString(),
    status: "Actual",
    messageType: "Alert",
    link: "https://www.tsunami.gov/?p=fixture-nws",
    tsunamiGovLink: "https://www.tsunami.gov/",
    isPdf: false,
    // Parsed with the same routine the live NWS path uses.
    quake: parseQuakeFromText(body),
  };
}

/**
 * Everything the admin UI can post, in one list: live PHIVOLCS advisories, live
 * tsunami.gov/NWS alerts, and the synthetic NWS fixtures. Sorted newest first so
 * the dropdowns open on the most recent bulletin.
 */
async function listCandidates(env) {
  const { alerts, phivolcsCount, usCount } = await fetchAllTsunamiAlerts();
  const seen = await loadPhivolcsSeen(env);
  const seenSetPresent = seen !== null;
  const candidates = [];
  for (const a of alerts) {
    const already =
      a.source === "phivolcs"
        ? Boolean(seenSetPresent && seen.includes(a.id))
        : Boolean(await env.WEBHOOK_KV.get(`tsunami:${a.id}`));
    candidates.push({
      id: a.id,
      source: a.source,
      event: a.event,
      headline: a.headline || "",
      sent: a.sent || a.effective || null,
      latLon: a.quake?.latLon ?? null,
      magnitude: a.quake?.magnitude ?? null,
      seen: already,
    });
  }
  for (const lvl of Object.keys(NWS_FIXTURES)) {
    const p = NWS_FIXTURES[lvl];
    candidates.push({
      id: `fixture-nws-${lvl}`,
      source: "fixture",
      fixtureLevel: lvl,
      event: p.event,
      headline: p.headline,
      sent: null,
      latLon: `Lat: ${Math.abs(p.lat).toFixed(1)}° ${p.lat >= 0 ? "N" : "S"} Lon: ${Math.abs(p.lng).toFixed(1)}° ${p.lng >= 0 ? "E" : "W"}`,
      magnitude: String(p.mag),
      seen: false,
    });
  }
  candidates.sort((x, y) => {
    // Fixtures and date-less entries go last, newest real advisory first.
    const tx = x.sent ? Date.parse(x.sent) : NaN;
    const ty = y.sent ? Date.parse(y.sent) : NaN;
    const ax = Number.isNaN(tx) ? -Infinity : tx;
    const ay = Number.isNaN(ty) ? -Infinity : ty;
    return ay - ax;
  });
  const last = parseInt((await env.WEBHOOK_KV.get(ADMIN_LASTPOST_KEY)) || "0", 10);
  const since = last ? Math.floor(Date.now() / 1000) - last : null;
  return {
    candidates,
    seenSetPresent,
    seenSetSize: seenSetPresent ? seen.length : 0,
    counts: { phivolcs: phivolcsCount, us: usCount },
    cooldownSecondsRemaining: since === null ? 0 : Math.max(0, MANUAL_COOLDOWN_S - since),
    maxPerPost: MANUAL_MAX_POSTS,
  };
}

/** One result row for a manual post, including what the card would show. */
function resultRow(view, alert, discord, fb) {
  const coords = quakeCoords(view);
  return {
    id: alert.id,
    source: view.source,
    event: view.event,
    fixture: Boolean(view.fixture),
    threat: view.threat ?? null,
    detailHeadline: view.detailHeadline ?? null,
    detailFetched: Boolean(view.detailFetched),
    detailError: view.detailError ?? null,
    quake: view.quake ?? null,
    cardUrl: coords ? tsunamiCardUrl(view, coords) : "",
    discord,
    facebook: fb,
  };
}

/**
 * Manual post for /admin — bypasses the dedup gate so a real Discord/Facebook
 * post can be exercised on demand. Marks what it posted as seen, so the next
 * cron tick will not re-announce it (a manual test should not leave a duplicate
 * trap). Refuses within COOLDOWN of the last manual post.
 */
const MANUAL_COOLDOWN_S = 45;
const MANUAL_MAX_POSTS = 3;
const ADMIN_LASTPOST_KEY = "tsunami:admin:lastpost";



async function forcePost(env, limit, opts) {
  const now = () => Math.floor(Date.now() / 1000);
  // Clamp here as well as in the route, so no caller can flood the channel.
  limit = Math.max(1, Math.min(MANUAL_MAX_POSTS, Number(limit) || 1));

  // Cooldown gates real posts only. A dry run must stay completely inert, so it
  // neither reads the gate nor writes it.
  if (!opts.dryRunOnly) {
    const last = parseInt((await env.WEBHOOK_KV.get(ADMIN_LASTPOST_KEY)) || "0", 10);
    const wait = last ? MANUAL_COOLDOWN_S - (now() - last) : 0;
    if (wait > 0) {
      return {
        manual: true,
        refused: true,
        reason: `cooldown — a manual tsunami post ran ${now() - last}s ago; wait ${wait}s`,
        cooldown: { secondsRemaining: wait },
        posted: 0,
        results: [],
      };
    }
  }

  const fetched = await fetchAllTsunamiAlerts();
  const seen = (await loadPhivolcsSeen(env)) ?? [];
  const results = [];

  // A fixture replaces the live list entirely: there is usually no US advisory
  // to post, and the point is to exercise the NWS branch of the pipeline. It is
  // never written to the seen-set, so it cannot suppress or impersonate a real
  // bulletin later.
  let fixture = null;
  let alerts = fetched.alerts;

  // An explicitly chosen advisory wins over every other filter: the admin UI
  // picks one row, and "already announced" must not stop you re-posting it.
  const explicit = Boolean(opts.targetId);
  if (explicit) {
    const FIX_PREFIX = "fixture-nws-";
    if (opts.targetId.startsWith(FIX_PREFIX)) {
      fixture = buildNwsFixture(opts.targetId.slice(FIX_PREFIX.length));
      if (fixture.error) {
        return { manual: true, refused: true, reason: fixture.error, posted: 0, results: [] };
      }
      // Must replace the list, not just set `fixture`: otherwise the loop below
      // walks the live advisories and posts a PHIVOLCS alert for a fixture target.
      alerts = [fixture];
    } else {
      alerts = alerts.filter((a) => a.id === opts.targetId);
      if (alerts.length === 0) {
        return { manual: true, refused: true, reason: `no advisory matches id ${opts.targetId}`, posted: 0, results: [] };
      }
    }
  } else if (opts.fixture) {
    fixture = opts.fixture === "nws" ? buildNwsFixture(opts.level) : { error: `unknown fixture "${opts.fixture}"` };
    if (fixture.error) {
      return { manual: true, refused: true, reason: fixture.error, posted: 0, results: [] };
    }
    alerts = [fixture];
  }
  const isFixtureRun = Boolean(fixture);

  for (const a of alerts) {
    if (results.length >= limit) break;
    const isPhivolcs = a.source === "phivolcs";
    if (!isFixtureRun && !explicit) {
      if (opts.source === "phivolcs" && !isPhivolcs) continue;
      if (opts.source === "us" && isPhivolcs) continue;
      const already = isPhivolcs
        ? seen.includes(a.id)
        : Boolean(await env.WEBHOOK_KV.get(`tsunami:${a.id}`));
      // Default re-posts something already announced (so you can re-test); &fresh=1
      // instead targets something never announced, simulating a brand-new event.
      if (opts.fresh) { if (already) continue; }
      else if (!already) continue;
    }
    if (isTestAlert(a)) { results.push({ id: a.id, event: a.event, skipped: "test/exercise" }); continue; }

    // Same enrichment the cron path uses, so a manual post shows the real
    // verdict rather than a neutral "TSUNAMI INFORMATION" banner.
    const view = isPhivolcs ? await enrichPhivolcsAlert(a) : a;

    let discord = "skipped", fb = "skipped";
    if (opts.dryRunOnly) {
      discord = "would-send"; fb = "would-post";
    } else {
      if (opts.skipDiscord) {
        discord = "skipped (skipDiscord=1)";
      } else {
        try { await sendTsunamiWebhook(view, env); discord = "sent"; }
        catch (e) { discord = `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 160); }
      }
      if (opts.skipFacebook) {
        fb = "skipped (skipFacebook=1)";
      } else {
        try { fb = await postTsunamiToFacebook(view, env); }
        catch (e) { fb = `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 160); }
      }
    }
    if (opts.dryRunOnly) {
      results.push({ ...resultRow(view, a, "would-send", "would-post"), markedSeen: false });
      continue;
    }
    // A fixture is never recorded as announced: it must not suppress a real
    // bulletin, and it must not linger in the dedup set.
    if (!isFixtureRun) {
      if (isPhivolcs) {
        seen.push(a.id);
        await savePhivolcsSeen(env, seen);
      } else {
        await env.WEBHOOK_KV.put(`tsunami:${a.id}`, JSON.stringify({ ...view, manual: true, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 7 });
      }
    }
    results.push({ ...resultRow(view, a, discord, fb), markedSeen: !isFixtureRun });
  }

  // Only a real post arms the cooldown. results.length counts dry-run selections
  // too, so the guard has to exclude them explicitly.
  if (!opts.dryRunOnly && results.length > 0) {
    await env.WEBHOOK_KV.put(ADMIN_LASTPOST_KEY, String(now()));
  }
  return {
    manual: true,
    refused: false,
    dryRun: Boolean(opts.dryRunOnly),
    targetId: opts.targetId || null,
    fixture: fixture ? { kind: "nws", level: fixture.fixtureLevel, synthetic: true } : null,
    fetched: { phivolcs: fetched.phivolcsCount, tsunamiGov: fetched.usCount },
    requested: limit,
    posted: results.length,
    results,
  };
}

/** Reports the remaining cooldown without posting anything. */
async function adminStatus(env) {
  const { alerts, phivolcsCount, usCount } = await fetchAllTsunamiAlerts();
  const seen = (await loadPhivolcsSeen(env)) ?? null;
  const last = parseInt((await env.WEBHOOK_KV.get(ADMIN_LASTPOST_KEY)) || "0", 10);
  const since = last ? Math.floor(Date.now() / 1000) - last : null;
  return {
    fetched: { phivolcs: phivolcsCount, tsunamiGov: usCount, total: alerts.length },
    seenSetPresent: seen !== null,
    seenSetSize: seen === null ? 0 : seen.length,
    cooldownSecondsRemaining: since === null ? 0 : Math.max(0, MANUAL_COOLDOWN_S - since),
    usage: {
      status: "/admin?key=...",
      preview: "/admin?key=...&post=1&confirm=1&dryrun=1",
      post: "/admin?key=...&post=1&confirm=1",
      options: "post=<1..3>  source=phivolcs|us|both  fresh=1  skipDiscord=1  skipFacebook=1",
      nwsFixture: "/admin?key=...&post=1&confirm=1&fixture=nws&level=warning",
      fixtureLevels: Object.keys(NWS_FIXTURES).join("|"),
      note: "fixture=nws injects a SYNTHETIC tsunami.gov/NWS advisory (there is rarely a live one) and never marks it seen.",
      cooldown: `${MANUAL_COOLDOWN_S}s between real manual posts`,
    },
  };
}

async function handleCron(env) {
  const { alerts, phivolcsCount, usCount } = await fetchAllTsunamiAlerts();

  // First PHIVOLCS run: record what already exists so only genuinely new
  // bulletins are announced from here on.
  let phivolcsSeen = await loadPhivolcsSeen(env);
  let bootstrapped = false;
  const currentIds = alerts.filter((a) => a.source === "phivolcs").map((a) => a.id);
  if (phivolcsSeen === null && currentIds.length > 0) {
    phivolcsSeen = currentIds;
    bootstrapped = true;
    await savePhivolcsSeen(env, phivolcsSeen);
    console.log(
      `[tsunami] PHIVOLCS seeded with ${currentIds.length} existing advisories (backlog not posted)`,
    );
  }

  if (alerts.length === 0)
    return "no active tsunami alert (PHIVOLCS + tsunami.gov: nothing new)";

  let sent = 0;
  let sentPhivolcs = 0;
  let skippedTests = 0;
  for (const a of alerts) {
    const isPhivolcs = a.source === "phivolcs";
    if (isPhivolcs) {
      // PHIVOLCS: post every advisory we have not announced yet, whatever the
      // threat level. The seen-set is the only gate.
      if (phivolcsSeen.includes(a.id)) continue;
    } else {
      const key = `tsunami:${a.id}`;
      const already = await env.WEBHOOK_KV.get(key);
      if (already) continue;
    }
    // NWS drills go nowhere — not Discord, not Facebook. Deliberately NOT
    // marked sent: if the same ID flips to a real alert, it must still fire.
    if (isTestAlert(a)) {
      skippedTests++;
      console.log(`[tsunami] test/exercise skipped (not sent): ${a.id}`);
      continue;
    }
    // TSUNAMI_MIN_SEVERITY is a tsunami.gov/NWS concept. PHIVOLCS bulletins are
    // announced whatever they say, so the filter does not apply to them.
    const min = (env.TSUNAMI_MIN_SEVERITY || "").toLowerCase();
    if (min && !isPhivolcs) {
      const e = a.event.toLowerCase();
      if (min === "warning" && !e.includes("warning")) continue;
      if (
        min === "advisory" &&
        !(e.includes("warning") || e.includes("advisory"))
      )
        continue;
    }
    // Fetch the advisory's own page for the real verdict before posting, so the
    // card shows the correct banner instead of a neutral "TSUNAMI INFORMATION".
    const enriched = isPhivolcs ? await enrichPhivolcsAlert(a) : a;
    if (isPhivolcs && enriched.detailFetched) {
      console.log(`[tsunami] ${enriched.id}: threat=${enriched.threat} "${enriched.detailHeadline}"`);
    }
    await sendTsunamiWebhook(enriched, env);
    // Facebook auto-post — best-effort: never blocks or throws.
    let fbStatus = "skipped";
    try {
      fbStatus = await postTsunamiToFacebook(enriched, env);
    } catch (e) {
      fbStatus = `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
    console.log(`[fb][tsunami] ${a.id}: ${fbStatus}`);
    if (isPhivolcs) {
      phivolcsSeen.push(a.id);
      await savePhivolcsSeen(env, phivolcsSeen);
    } else {
      await env.WEBHOOK_KV.put(
        `tsunami:${a.id}`,
        JSON.stringify({ ...a, fbStatus, sentAt: new Date().toISOString() }),
        { expirationTtl: 60 * 60 * 24 * 7 },
      );
    }
    sent++;
    if (isPhivolcs) sentPhivolcs++;
    if (sent >= 3) break;
  }
  if (bootstrapped && sent === 0)
    return `PHIVOLCS seeded (${currentIds.length} advisories, backlog not posted); no new bulletins yet`;
  if (sent === 0)
    return skippedTests > 0
      ? `no real alerts (${skippedTests} test/exercise skipped)`
      : `all ${alerts.length} tsunami alerts already sent (PHIVOLCS ${phivolcsCount}, US ${usCount})`;
  return `sent ${sent} tsunami alert(s) (PHIVOLCS ${sentPhivolcs}, US ${sent - sentPhivolcs}): ${alerts
    .slice(0, sent)
    .map((a) => a.event)
    .join(", ")}`;
}
// Named exports for unit testing (harmless in the worker runtime).
  // Expose for terraguard entry (runMonitor is the cron handler, helpers for tests)
  return {
    runMonitor: handleCron,
    preview: previewAlerts,
    forcePost,
    adminStatus,
    listCandidates,
    ensureCard: ensureTsunamiCard,
    buildCardUrl: tsunamiCardUrl,
    enrich: enrichPhivolcsAlert,
    buildNwsFixture,
    NWS_FIXTURES,
    quakeCoords,
    MANUAL_COOLDOWN_S,
    fetchAlerts: fetchTsunamiAlerts,
    fetchPhivolcsAlerts: fetchPhivolcsTsunamiAlerts,
    fetchAllAlerts: fetchAllTsunamiAlerts,
    parseQuake: parseQuakeFromText,
    buildMessage: buildTsunamiMessage,
    isThreat: isTsunamiThreat,
    isTest: isTestAlert,
    quakeCoords,
    summarizeAreas,
  };
})();

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
const tsunamiSecrets = (env) => [env.TSUNAMI_API_SECRET, env.CRON_SECRET];
// /admin serves tsunami + volcano + weather tabs, so it accepts any monitor
// secret (each list/post path still enforces its own monitor secret).
const adminSecrets = (env) => [env.CRON_SECRET, env.TSUNAMI_API_SECRET, env.PAGASA_API_SECRET, env.VOLCANO_API_SECRET];

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

// ---- manual-post guardrails shared by volcano + weather tabs ----
// Mirrors the tsunami monitor's MANUAL_COOLDOWN_S / ADMIN_LASTPOST_KEY: real
// posts are rate-limited, dry runs neither read nor write the gate.
const VOLCANO_COOLDOWN_S = 45;
const WEATHER_COOLDOWN_S = 45;
const VOLCANO_LASTPOST_KEY = "volcano:admin:lastpost";
const WEATHER_LASTPOST_KEY = "weather:admin:lastpost";
function manualCooldownWait(nowS, last, cooldownS) {
    if (!last) return 0;
    return Math.max(0, cooldownS - (nowS - last));
}

/** Candidate list driving the /admin volcano tab dropdown. */
async function listVolcanoCandidates(v) {
    const snap = v.kv ? await Volcano.kvGet(v.kv, Volcano.SNAPSHOT_KEY).catch(() => null) : null;
    const byVolcano = snap?.byVolcano ?? {};
    const last = v.kv ? parseInt((await v.kv.get(VOLCANO_LASTPOST_KEY).catch(() => null)) || "0", 10) : 0;
    const candidates = Object.keys(byVolcano).map((name) => {
        const e = byVolcano[name];
        return {
            id: name,
            source: "volcano",
            event: e.reportKind && e.reportKind !== "NONE" ? e.reportKind : (e.parsed?.title ?? name),
            headline: e.parsed?.title ?? "",
            sent: e.storedAt ?? e.parsed?.issuedAt ?? null,
            alertLevel: e.parsed?.alertLevel ?? null,
            risk: e.risk?.status ?? null,
            hasImage: Boolean(e.parsed?.mapImg),
            seen: false,
        };
    });
    return {
        monitor: "volcano",
        candidates,
        counts: { volcanoes: candidates.length },
        cooldownSecondsRemaining: manualCooldownWait(Math.floor(Date.now() / 1000), last, VOLCANO_COOLDOWN_S),
        maxPerPost: 1,
    };
}

/** News-desk cooldown: same convention as the other manual posts. */
const NEWS_COOLDOWN_S = 45;
const NEWS_LASTPOST_KEY = "news:admin:lastpost";
/** Max images per news-desk post (keeps FB album + Discord embeds sane). */
const MAX_NEWS_IMAGES = 4;

/**
 * Normalize the image list from a /post-news body. Accepts the new
 * `imageUrls` array plus the legacy single `imageUrl` string. Returns a
 * deduped list of https URLs, capped at MAX_NEWS_IMAGES.
 */
function normalizeNewsImages(body) {
    const out = [];
    const push = (u) => {
        const s = String(u ?? "").trim();
        if (!s || out.length >= MAX_NEWS_IMAGES) return;
        if (!/^https:\/\//i.test(s)) return;
        if (!out.includes(s)) out.push(s);
    };
    const arr = body?.imageUrls;
    if (Array.isArray(arr)) for (const u of arr) push(u);
    push(body?.imageUrl);
    return out;
}

/** Who may use /post-news. Override with env.AI_ADMIN_EMAILS (comma-separated). */
const DEFAULT_NEWS_ADMINS = ["gianganwneljae@gmail.com"];
function parseNewsAdmins(env) {
    const raw = (env.AI_ADMIN_EMAILS ?? "").trim();
    if (!raw) return DEFAULT_NEWS_ADMINS;
    return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function b64urlDecode(s) {
    const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

/**
 * Verify a Supabase access token (JWT, HS256, signed with the project's JWT
 * secret). Returns the payload. Throws on malformed / wrong-alg / bad
 * signature / expired tokens. Fail-closed: any doubt rejects.
 */
async function verifySupabaseJwt(token, jwtSecret) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw new Error("malformed token");
    let header, payload;
    try {
        header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
        payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
    }
    catch {
        throw new Error("malformed token");
    }
    if (header.alg !== "HS256") throw new Error(`unexpected alg ${header.alg}`);
    if (!crypto?.subtle) throw new Error("crypto unavailable");
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(jwtSecret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
    );
    const ok = await crypto.subtle.verify(
        "HMAC",
        key,
        b64urlDecode(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) throw new Error("bad signature");
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && payload.exp < now - 30)
        throw new Error("token expired");
    return payload;
}

function splitNewsText(text, max = 1900) {
    const out = [];
    let rest = String(text);
    while (rest.length > max) {
        let cut = rest.lastIndexOf("\n", max);
        if (cut < max * 0.5) cut = max;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut).replace(/^\n+/, "");
    }
    if (rest) out.push(rest);
    return out;
}

/** Generic Discord post for news-desk items. Returns a status string. */
async function postNewsToDiscord(title, text, imageUrls, webhookUrl) {
    const stripBoilerplate = (s) =>
        String(s ?? "")
            .split("\n")
            .filter((line) => !/^\s*\**\s*TerraGuard News\s*\**\s*$/i.test(line.trim()))
            .join("\n")
            .trim();
    const cleanTitle = stripBoilerplate(title).slice(0, 256);
    const cleanText = stripBoilerplate(text);
    const images = (Array.isArray(imageUrls) ? imageUrls : [imageUrls])
        .map((u) => String(u ?? "").trim())
        .filter((u) => /^https:\/\//i.test(u))
        .slice(0, MAX_NEWS_IMAGES);
    const chunks = cleanText ? splitNewsText(cleanText) : [""];
    for (let i = 0; i < chunks.length; i++) {
        // First message carries the title + cover + footer; extra images
        // each get their own embed (Discord allows up to 10 per message).
        const embeds = [];
        if (i === 0) {
            let idx = 0;
            if (cleanTitle) {
                embeds.push({
                    title: cleanTitle,
                    color: 0x3b82f6,
                    ...(images[0] ? { image: { url: images[0] } } : {}),
                    footer: { text: "TerraGuard AI News Desk" },
                    timestamp: new Date().toISOString(),
                });
                idx = images[0] ? 1 : 0;
            } else if (images[0]) {
                embeds.push({
                    color: 0x3b82f6,
                    image: { url: images[0] },
                    footer: { text: "TerraGuard AI News Desk" },
                    timestamp: new Date().toISOString(),
                });
                idx = 1;
            } else {
                embeds.push({
                    color: 0x3b82f6,
                    footer: { text: "TerraGuard AI News Desk" },
                    timestamp: new Date().toISOString(),
                });
            }
            for (; idx < images.length; idx++) {
                embeds.push({ color: 0x3b82f6, image: { url: images[idx] } });
            }
        }
        const payload = {
            ...(chunks[i] ? { content: chunks[i] } : {}),
            embeds,
        };
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => "");
            throw new Error(`Discord webhook ${res.status}: ${t.slice(0, 200)}`);
        }
        if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
    return `discord: posted (${chunks.length} part${chunks.length === 1 ? "" : "s"})`;
}

/** Generic Facebook post for news-desk items. Photo(s) when images are set. */
async function postNewsToFacebook(title, text, imageUrls, env) {
    const images = (Array.isArray(imageUrls) ? imageUrls : [imageUrls])
        .map((u) => String(u ?? "").trim())
        .filter((u) => /^https:\/\//i.test(u))
        .slice(0, MAX_NEWS_IMAGES);
    const pageId = (env.FB_PAGE_ID ?? "").trim();
    const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
    const appSecret = (env.FB_APP_SECRET ?? "").trim();
    if (!pageId || !userToken)
        return "fb: skipped (FB_PAGE_ID / FB_USER_ACCESS_TOKEN not set)";
    // NOTE: getFacebookPageToken() lives inside the Tsunami module and is not
    // visible here, so resolve the Page token locally (same /me/accounts flow).
    let pageToken = null;
    try {
        const proof = await fbAppSecretProof(userToken, appSecret);
        const listUrl = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/me/accounts`);
        listUrl.searchParams.set("access_token", userToken);
        listUrl.searchParams.set("fields", "id,name,access_token");
        listUrl.searchParams.set("limit", "50");
        if (proof) listUrl.searchParams.set("appsecret_proof", proof);
        const listRes = await fetch(listUrl.toString());
        if (listRes.ok) {
            const listed = await listRes.json();
            const match = (listed?.data ?? []).find((p) => String(p.id) === String(pageId));
            if (match?.access_token) pageToken = String(match.access_token);
        }
    }
    catch { /* fall through to userToken */ }
    if (!pageToken) pageToken = userToken; // may already be a Page token
    const proof = await fbAppSecretProof(pageToken, appSecret);
    const withProof = (params) => {
        if (proof) params.appsecret_proof = proof;
        return params;
    };
    // Plain text only: Facebook does not render **bold** / _italic_ markdown,
    // so never add it. Title is optional — omit it when empty. Strip any
    // leftover "TerraGuard News" boilerplate so an empty title truly posts
    // with no header.
    const stripNewsBoilerplate = (s) =>
        String(s ?? "")
            .split("\n")
            .filter((line) => !/^\s*\**\s*TerraGuard News\s*\**\s*$/i.test(line.trim()))
            .join("\n")
            .trim();
    const cleanTitle = stripNewsBoilerplate(title).slice(0, 200);
    const cleanText = stripNewsBoilerplate(text);
    const caption = [cleanTitle, cleanText].filter(Boolean).join("\n\n");
    if (images.length === 1) {
        const body = withProof({ access_token: pageToken, caption, url: images[0] });
        const res = await fetch(
            `https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/photos`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.post_id || data.id))
            return `fb: posted photo ${data.post_id ?? data.id}`;
        throw new Error(`FB photo ${res.status}: ${String(data?.error?.message ?? "").slice(0, 200)}`);
    }
    if (images.length > 1) {
        // Multi-photo album: upload each photo unpublished, then publish one
        // feed post with all media attached so they land as a single post.
        const fbids = [];
        for (const url of images) {
            const up = withProof({ access_token: pageToken, url, published: false });
            const upRes = await fetch(
                `https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/photos`,
                { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(up) },
            );
            const upData = await upRes.json().catch(() => ({}));
            if (!upRes.ok || !upData?.id) {
                throw new Error(`FB album upload ${upRes.status}: ${String(upData?.error?.message ?? "").slice(0, 200)}`);
            }
            fbids.push(upData.id);
        }
        const album = withProof({
            access_token: pageToken,
            message: caption,
            attached_media: fbids.map((id) => ({ media_fbid: id })),
        });
        const res = await fetch(
            `https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/feed`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(album) },
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.id)
            return `fb: posted album (${images.length} photos) ${data.id}`;
        throw new Error(`FB album ${res.status}: ${String(data?.error?.message ?? "").slice(0, 200)}`);
    }
    const body = withProof({ access_token: pageToken, message: caption });
    const res = await fetch(
        `https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/feed`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.id)
        return `fb: posted ${data.id}`;
    throw new Error(`FB feed ${res.status}: ${String(data?.error?.message ?? "").slice(0, 200)}`);
}

/** Candidate list driving the /admin weather (PAGASA) tab dropdown. */
async function listWeatherCandidates(w) {
    const snap = w.kv ? await Weather.getSnapshot(w.kv).catch(() => null) : null;
    const bySource = snap?.bySource ?? {};
    const last = w.kv ? parseInt((await w.kv.get(WEATHER_LASTPOST_KEY).catch(() => null)) || "0", 10) : 0;
    const candidates = Object.keys(bySource).map((key) => {
        const e = bySource[key];
        return {
            id: key,
            source: "weather",
            event: e.normalized?.title ?? e.parsed?.title ?? key,
            headline: e.parsed?.title ?? "",
            sent: e.storedAt ?? e.normalized?.fetchedTime ?? null,
            risk: e.risk?.status ?? null,
            hasFbSlot: Boolean(Weather.weatherFbSlot(key)),
            inactive: Boolean(e.parsed?.statesNoActive),
            seen: false,
        };
    });
    return {
        monitor: "weather",
        candidates,
        counts: { sources: candidates.length },
        cooldownSecondsRemaining: manualCooldownWait(Math.floor(Date.now() / 1000), last, WEATHER_COOLDOWN_S),
        maxPerPost: 1,
    };
}











// >>> BEGIN GENERATED admin page (built from admin.html; do not hand-edit)
/**
 * The /admin UI. Served when the caller asks for HTML; the JSON API stays
 * available to curl and scripts via content negotiation.
 */
function adminPageHtml() {
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="robots" content="noindex,nofollow">\n<title>TerraGuard &middot; Admin</title>\n<style>\n  :root{\n    --bg:#0b1220; --panel:#131c2e; --panel2:#0f1726; --line:#24314a;\n    --text:#e6edf7; --muted:#93a4bf; --accent:#3b82f6; --accent2:#1d4ed8;\n    --ok:#16a34a; --warn:#d97706; --bad:#dc2626; --fixture:#a855f7;\n  }\n  *{box-sizing:border-box}\n  body{margin:0;background:var(--bg);color:var(--text);\n    font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}\n  header{padding:18px 22px;border-bottom:1px solid var(--line);background:var(--panel2);\n    display:flex;align-items:center;gap:14px;flex-wrap:wrap}\n  header h1{font-size:16px;margin:0;letter-spacing:.3px}\n  header h1 span{color:var(--muted);font-weight:400}\n  .pill{font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);\n    color:var(--muted);background:#0a1220;white-space:nowrap}\n  .pill.live{border-color:#14532d;color:#4ade80}\n  .pill.bad{border-color:#7f1d1d;color:#f87171}\n  main{max-width:1080px;margin:0 auto;padding:22px;display:grid;gap:18px}\n  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}\n  .card h2{font-size:12px;text-transform:uppercase;letter-spacing:.9px;color:var(--muted);\n    margin:0 0 14px;font-weight:600}\n  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}\n  .stat{background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:11px 13px}\n  .stat b{display:block;font-size:20px;font-weight:600;letter-spacing:-.3px}\n  .stat span{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px}\n  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}\n  @media(max-width:720px){.grid{grid-template-columns:1fr}}\n  label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.6px;\n    color:var(--muted);margin-bottom:6px}\n  select,input[type=text]{width:100%;background:#0a1220;color:var(--text);\n    border:1px solid var(--line);border-radius:8px;padding:9px 10px;font:inherit;font-size:13px}\n  select:focus,input:focus{outline:2px solid var(--accent);outline-offset:-1px}\n  .toggles{display:flex;gap:18px;flex-wrap:wrap;margin-top:14px}\n  .toggles label{display:flex;align-items:center;gap:7px;text-transform:none;\n    letter-spacing:0;font-size:13px;color:var(--text);margin:0;cursor:pointer}\n  .toggles input{accent-color:var(--accent);width:15px;height:15px}\n  .actions{display:flex;gap:10px;margin-top:18px;flex-wrap:wrap}\n  button{font:inherit;font-size:13px;font-weight:600;padding:10px 18px;border-radius:8px;\n    border:1px solid var(--line);background:#1a2438;color:var(--text);cursor:pointer}\n  button:hover:not(:disabled){background:#223049}\n  button:disabled{opacity:.45;cursor:not-allowed}\n  button.primary{background:var(--accent2);border-color:var(--accent)}\n  button.primary:hover:not(:disabled){background:var(--accent)}\n  button.discord{background:#23283f;border-color:#4a5c9e;color:#c7d2fe}\n  button.discord:hover:not(:disabled){background:#2e3550}\n  button.fb{background:#1b2a4a;border-color:#3b5f9e;color:#bcd4fb}\n  button.fb:hover:not(:disabled){background:#24375e}\n  .hint{font-size:12px;color:var(--muted);margin-top:12px}\n  .hint code{background:#0a1220;border:1px solid var(--line);border-radius:5px;padding:1px 5px;\n    font-size:11.5px}\n  pre{background:#080e18;border:1px solid var(--line);border-radius:9px;padding:14px;\n    overflow:auto;max-height:460px;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;\n    color:#cfe0f5;white-space:pre-wrap;word-break:break-word;margin:0}\n  pre:empty::before{content:"Response will appear here.";color:#5b6b85}\n  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n  .tag{font-size:10.5px;padding:2px 7px;border-radius:5px;letter-spacing:.4px;\n    text-transform:uppercase;font-weight:700;flex:none}\n  .tag.phivolcs{background:#0e3a5c;color:#7dd3fc}\n  .tag.us{background:#3b2f0e;color:#fcd34d}\n  .tag.fixture{background:#3b1d5c;color:#d8b4fe}\n  .tag.new{background:#052e1a;color:#4ade80}\n  .tag.seen{background:#1e293b;color:#64748b}\n  optgroup{background:#0a1220;color:var(--muted);font-style:normal;font-size:11px;\n    text-transform:uppercase;letter-spacing:.5px}\n  option{color:var(--text);background:#0a1220;font-size:13px}\n  .err{color:#fca5a5}\n  .tabs{display:flex;gap:8px;flex-wrap:wrap}\n  .tabs button{padding:9px 20px}\n  .tabs button[aria-selected="true"]{background:var(--accent2);border-color:var(--accent)}\n  .tabpanel[hidden]{display:none}\n</style>\n</head>\n<body>\n<header>\n  <h1>TerraGuard <span>&middot; Admin</span></h1>\n  <span class="pill" id="authPill">checking&hellip;</span>\n  <span class="pill" id="livePill">&nbsp;</span>\n  <button id="refreshBtn" style="margin-left:auto;padding:7px 14px">Refresh</button>\n</header>\n\n<main>\n  <div class="card">\n    <h2>Monitor</h2>\n    <div class="tabs" role="tablist" aria-label="Monitor">\n      <button id="tabTsunami" role="tab" aria-selected="true" aria-controls="panelTsunami">Tsunami</button>\n      <button id="tabVolcano" role="tab" aria-selected="false" aria-controls="panelVolcano">Volcano</button>\n      <button id="tabWeather" role="tab" aria-selected="false" aria-controls="panelWeather">Weather (PAGASA)</button>\n    </div>\n  </div>\n\n  <div id="panelTsunami" class="tabpanel" role="tabpanel" aria-labelledby="tabTsunami">\n  <div class="card">\n    <h2>Status &middot; Tsunami</h2>\n    <div class="stats">\n      <div class="stat"><b id="sPh">&mdash;</b><span>PHIVOLCS</span></div>\n      <div class="stat"><b id="sUs">&mdash;</b><span>tsunami.gov</span></div>\n      <div class="stat"><b id="sSeen">&mdash;</b><span>Seen set</span></div>\n      <div class="stat"><b id="sCool">&mdash;</b><span>Cooldown</span></div>\n      <div class="stat"><b id="sPend">&mdash;</b><span>Unseen</span></div>\n    </div>\n  </div>\n\n  <div class="card">\n    <h2>Compose &middot; Tsunami</h2>\n    <div class="grid">\n      <div>\n        <label for="srcSel">Source</label>\n        <select id="srcSel">\n          <option value="all">All sources</option>\n          <option value="phivolcs">PHIVOLCS bulletins</option>\n          <option value="us">tsunami.gov / NWS (live)</option>\n          <option value="fixture">NWS test fixture (synthetic)</option>\n        </select>\n      </div>\n      <div>\n        <label for="limitSel">How many to post</label>\n        <select id="limitSel">\n          <option value="1">1</option>\n          <option value="2">2</option>\n          <option value="3">3 (max)</option>\n        </select>\n      </div>\n    </div>\n    <div style="margin-top:14px">\n      <label for="advSel">Advisory</label>\n      <select id="advSel"><option value="">Loading&hellip;</option></select>\n    </div>\n    <div class="toggles">\n      <label><input type="checkbox" id="skipFb"> Skip Facebook</label>\n      <label><input type="checkbox" id="skipDc"> Skip Discord</label>\n      <label><input type="checkbox" id="useFresh"> Only unseen (simulate a new event)</label>\n    </div>\n    <div class="actions">\n      <button id="prevBtn">Preview</button>\n      <!-- data-skip declares which channel this button suppresses. It lives\n           next to the label so the two can never drift apart in the handler. -->\n      <button id="postBtn" class="primary" data-skip="none">Post to Discord &amp; Facebook</button>\n      <button id="postDcBtn" class="discord" data-skip="facebook">Discord only</button>\n      <button id="postFbBtn" class="fb" data-skip="discord">Facebook only</button>\n    </div>\n    <p class="hint" id="hint"></p>\n    <p class="hint" style="margin-top:6px">\n      Channel buttons respect the checkboxes above &mdash; tick <em>Skip Facebook</em> to\n      force Discord only, or <em>Skip Discord</em> to force Facebook only.\n    </p>\n  </div>\n\n  <div class="card">\n    <h2>Response &middot; Tsunami</h2>\n    <pre id="out"></pre>\n  </div>\n  </div>\n\n  <div id="panelVolcano" class="tabpanel" role="tabpanel" aria-labelledby="tabVolcano" hidden>\n  <div class="card">\n    <h2>Status &middot; Volcano</h2>\n    <div class="stats">\n      <div class="stat"><b id="vCount">&mdash;</b><span>Volcanoes</span></div>\n      <div class="stat"><b id="vCool">&mdash;</b><span>Cooldown</span></div>\n    </div>\n  </div>\n\n  <div class="card">\n    <h2>Compose &middot; Volcano</h2>\n    <div>\n      <label for="vSel">Volcano bulletin</label>\n      <select id="vSel"><option value="">Loading&hellip;</option></select>\n    </div>\n    <p class="hint">Posts the latest stored bulletin for that volcano to its Discord (and Facebook if configured). Bypasses the monitor dedup.</p>\n    <div class="actions">\n      <button id="vPrevBtn">Preview</button>\n      <button id="vPostBtn" class="primary" data-skip="none">Post to Discord &amp; Facebook</button>\n      <button id="vPostDcBtn" class="discord" data-skip="facebook">Discord only</button>\n      <button id="vPostFbBtn" class="fb" data-skip="discord">Facebook only</button>\n    </div>\n    <p class="hint" id="vHint"></p>\n  </div>\n\n  <div class="card">\n    <h2>Response &middot; Volcano</h2>\n    <pre id="vOut"></pre>\n  </div>\n  </div>\n\n  <div id="panelWeather" class="tabpanel" role="tabpanel" aria-labelledby="tabWeather" hidden>\n  <div class="card">\n    <h2>Status &middot; Weather (PAGASA)</h2>\n    <div class="stats">\n      <div class="stat"><b id="wCount">&mdash;</b><span>Sources</span></div>\n      <div class="stat"><b id="wCool">&mdash;</b><span>Cooldown</span></div>\n    </div>\n  </div>\n\n  <div class="card">\n    <h2>Compose &middot; Weather</h2>\n    <div>\n      <label for="wSel">Weather bulletin</label>\n      <select id="wSel"><option value="">Loading&hellip;</option></select>\n    </div>\n    <p class="hint">Only <em>forecast</em> and <em>tc-bulletin</em> have a Facebook slot; other sources are Discord-only. Inactive bulletins are skipped by the sender.</p>\n    <div class="actions">\n      <button id="wPrevBtn">Preview</button>\n      <button id="wPostBtn" class="primary" data-skip="none">Post to Discord &amp; Facebook</button>\n      <button id="wPostDcBtn" class="discord" data-skip="facebook">Discord only</button>\n      <button id="wPostFbBtn" class="fb" data-skip="discord">Facebook only</button>\n    </div>\n    <p class="hint" id="wHint"></p>\n  </div>\n\n  <div class="card">\n    <h2>Response &middot; Weather</h2>\n    <pre id="wOut"></pre>\n  </div>\n  </div>\n</main>\n\n<script>\n(function () {\n  "use strict";\n  var KEY = new URLSearchParams(location.search).get("key") || "";\n  var $ = function (id) { return document.getElementById(id); };\n  var busy = false;\n\n  function outFor(panel) { return $(panel === "volcano" ? "vOut" : panel === "weather" ? "wOut" : "out"); }\n  function show(panel, v) {\n    var el = outFor(panel);\n    if (typeof v === "string") { el.textContent = v; return; }\n    el.textContent = JSON.stringify(v, null, 2);\n  }\n  function fail(panel, m) { show(panel, String(m)); }\n\n  function qs(extra) {\n    var p = new URLSearchParams(location.search);\n    p.set("key", KEY);\n    for (var k in extra) if (extra[k] !== "" && extra[k] != null) p.set(k, extra[k]);\n    return p.toString();\n  }\n\n  // GET helper for /admin JSON APIs.\n  async function api(extra) {\n    var r = await fetch("/admin?" + qs(extra), { headers: { Accept: "application/json" } });\n    var t = await r.text();\n    var j;\n    try { j = JSON.parse(t); } catch (e) { throw new Error("HTTP " + r.status + ": " + t.slice(0, 200)); }\n    if (!r.ok && j && !j.error && j.reason) throw new Error(j.reason);\n    if (!r.ok && j && j.error) throw new Error(j.error);\n    return j;\n  }\n\n  // POST helper for /repost-* endpoints (preview and real posts alike).\n  async function apiPost(path, extra) {\n    var r = await fetch(path + "?" + qs(extra), { method: "POST", headers: { Accept: "application/json" } });\n    var t = await r.text();\n    var j;\n    try { j = JSON.parse(t); } catch (e) { throw new Error("HTTP " + r.status + ": " + t.slice(0, 200)); }\n    if (!r.ok && j && j.error) throw new Error(j.error + (j && j.success === false ? "" : ""));\n    return j;\n  }\n\n  // ---- tabs ----------------------------------------------------------------\n  var TABS = [\n    ["tabTsunami", "panelTsunami"],\n    ["tabVolcano", "panelVolcano"],\n    ["tabWeather", "panelWeather"]\n  ];\n  function selectTab(id) {\n    TABS.forEach(function (pair) {\n      var active = pair[0] === id;\n      $(pair[0]).setAttribute("aria-selected", active ? "true" : "false");\n      if (active) $(pair[1]).removeAttribute("hidden");\n      else $(pair[1]).setAttribute("hidden", "");\n    });\n    try { location.hash = id === "tabVolcano" ? "volcano" : id === "tabWeather" ? "weather" : "tsunami"; } catch (e) {}\n  }\n  TABS.forEach(function (pair) {\n    $(pair[0]).addEventListener("click", function () { selectTab(pair[0]); });\n  });\n\n  // ---- shared button helpers -------------------------------------------------\n  // A post button declares which channel it suppresses via data-skip. Reading\n  // that attribute instead of hardcoding booleans per button is what stops\n  // "Discord only" and "Facebook only" being wired up backwards.\n  function channelPlan(btn, dcBox, fbBox) {\n    var skip = btn.getAttribute("data-skip") || "none";\n    var skipDiscord = skip === "discord";\n    var skipFacebook = skip === "facebook";\n    if (dcBox && $(dcBox).checked) skipDiscord = true;\n    if (fbBox && $(fbBox).checked) skipFacebook = true;\n    return { skipDiscord: skipDiscord, skipFacebook: skipFacebook };\n  }\n  function planToTarget(plan) {\n    if (plan.skipDiscord && plan.skipFacebook) return null;\n    if (plan.skipDiscord) return "facebook";\n    if (plan.skipFacebook) return "discord";\n    return "both";\n  }\n  function planWhere(plan) {\n    return plan.skipDiscord ? "Facebook only" : plan.skipFacebook ? "Discord only" : "Discord and Facebook";\n  }\n  function lock(ids, on) {\n    ids.forEach(function (id) { $(id).disabled = on; });\n  }\n\n  // ---- tsunami tab (unchanged behaviour) --------------------------------------\n  var data = { candidates: [] };\n\n  // Every value goes in through textContent, never innerHTML: advisory text\n  // comes from a third-party site and must never become markup.\n  function label(c) {\n    var bits = [];\n    bits.push(c.event || "(no event)");\n    if (c.headline && c.headline !== c.event) bits.push(c.headline);\n    if (c.magnitude) bits.push("M" + c.magnitude);\n    if (c.latLon) bits.push(c.latLon);\n    if (c.source === "fixture") bits.push("SYNTHETIC FIXTURE");\n    else if (c.seen) bits.push("already sent");\n    else bits.push("unseen");\n    if (c.sent) bits.push(new Date(c.sent).toISOString().replace("T", " ").slice(0, 16) + "Z");\n    return bits.join("  \\u00b7  ");\n  }\n\n  function fill() {\n    var sel = $("advSel");\n    var src = $("srcSel").value;\n    sel.textContent = "";\n    var rows = data.candidates.filter(function (c) {\n      if (src === "all") return true;\n      return c.source === src;\n    });\n    if (!rows.length) {\n      var o = document.createElement("option");\n      o.value = ""; o.textContent = "Nothing available for this source";\n      sel.appendChild(o);\n      return;\n    }\n    var groups = { phivolcs: null, us: null, fixture: null };\n    rows.forEach(function (c) {\n      var g = groups[c.source];\n      if (!g) {\n        g = document.createElement("optgroup");\n        g.label = c.source === "phivolcs" ? "PHIVOLCS" : c.source === "us" ? "tsunami.gov / NWS" : "NWS fixture (synthetic)";\n        sel.appendChild(g);\n        groups[c.source] = g;\n      }\n      var o = document.createElement("option");\n      o.value = c.id;\n      o.textContent = label(c);\n      g.appendChild(o);\n    });\n  }\n\n  function stat() {\n    $("sPh").textContent = data.counts ? data.counts.phivolcs : "\\u2014";\n    $("sUs").textContent = data.counts ? data.counts.us : "\\u2014";\n    $("sSeen").textContent = data.seenSetSize != null ? data.seenSetSize : "\\u2014";\n    var cd = data.cooldownSecondsRemaining || 0;\n    $("sCool").textContent = cd + "s";\n    $("sCool").style.color = cd > 0 ? "var(--warn)" : "";\n    var unseen = data.candidates.filter(function (c) { return c.source !== "fixture" && !c.seen; }).length;\n    $("sPend").textContent = unseen;\n    var p = $("livePill");\n    if (!KEY) { p.textContent = "no key"; p.className = "pill bad"; }\n    else if (data.error) { p.textContent = "error"; p.className = "pill bad"; }\n    else { p.textContent = "live"; p.className = "pill live"; }\n    $("authPill").textContent = KEY ? "key present" : "missing key";\n    $("authPill").className = "pill" + (KEY ? " live" : " bad");\n  }\n\n  async function loadTsunami() {\n    data = await api({ list: "1" });\n    stat();\n    fill();\n    var cd = data.cooldownSecondsRemaining || 0;\n    $("hint").innerHTML = cd > 0\n      ? "Cooldown active \\u2014 wait " + cd + "s before a real post. Preview still works."\n      : "Pick an advisory, then Preview first. Preview never posts and never writes to KV.";\n  }\n\n  function tParams(skipDc, skipFb) {\n    var p = {\n      post: $("limitSel").value,\n      confirm: "1",\n      skipDiscord: skipDc ? "1" : "",\n      skipFacebook: skipFb ? "1" : "",\n      fresh: $("useFresh").checked ? "1" : ""\n    };\n    var id = $("advSel").value;\n    if (id) p.target = id;\n    var src = $("srcSel").value;\n    if (!id && src !== "all") p.source = src;\n    return p;\n  }\n\n  var TBUTTONS = ["prevBtn", "postBtn", "postDcBtn", "postFbBtn", "refreshBtn"];\n  async function tPreview() {\n    if (busy) return;\n    busy = true; lock(TBUTTONS, true);\n    show("tsunami", "Working\\u2026");\n    try {\n      var p = tParams($("skipDc").checked, $("skipFb").checked);\n      p.dryrun = "1";\n      show("tsunami", await api(p));\n    } catch (e) { fail("tsunami", e.message); }\n    finally { busy = false; lock(TBUTTONS, false); loadTsunami(); }\n  }\n\n  async function tPost(btn) {\n    if (busy) return;\n    var plan = channelPlan(btn, "skipDc", "skipFb");\n    if (plan.skipDiscord && plan.skipFacebook) {\n      fail("tsunami", "Both channels are skipped \\u2014 nothing would be sent. untick a Skip box.");\n      return;\n    }\n    var id = $("advSel").value;\n    var where = planWhere(plan);\n    var what = id ? "the selected advisory" : ($("limitSel").value + " advisory(ies)");\n    if (!window.confirm("Post " + what + " to " + where + "?\\n\\nThis really sends. Continue?")) return;\n    busy = true; lock(TBUTTONS, true);\n    show("tsunami", "Posting to " + where + "\\u2026");\n    try {\n      var p = tParams(plan.skipDiscord, plan.skipFacebook);\n      show("tsunami", await api(p));\n    } catch (e) { fail("tsunami", e.message); }\n    finally { busy = false; lock(TBUTTONS, false); loadTsunami(); }\n  }\n\n  $("srcSel").addEventListener("change", fill);\n  $("prevBtn").addEventListener("click", tPreview);\n  $("postBtn").addEventListener("click", function () { tPost(this); });\n  $("postDcBtn").addEventListener("click", function () { tPost(this); });\n  $("postFbBtn").addEventListener("click", function () { tPost(this); });\n\n  // ---- volcano tab ------------------------------------------------------------\n  var vData = { candidates: [] };\n  function vLabel(c) {\n    var bits = [c.id];\n    if (c.headline) bits.push(c.headline);\n    if (c.alertLevel != null) bits.push("L" + c.alertLevel);\n    if (c.risk) bits.push(c.risk);\n    return bits.join("  \\u00b7  ");\n  }\n  function vFill() {\n    var sel = $("vSel");\n    sel.textContent = "";\n    if (!vData.candidates.length) {\n      var o = document.createElement("option");\n      o.value = ""; o.textContent = "No stored bulletins \\u2014 run /trigger-volcano first";\n      sel.appendChild(o);\n      return;\n    }\n    vData.candidates.forEach(function (c) {\n      var op = document.createElement("option");\n      op.value = c.id;\n      op.textContent = vLabel(c);\n      sel.appendChild(op);\n    });\n  }\n  var VBUTTONS = ["vPrevBtn", "vPostBtn", "vPostDcBtn", "vPostFbBtn", "refreshBtn"];\n  async function loadVolcano() {\n    vData = await api({ list: "1", monitor: "volcano" });\n    if (!Array.isArray(vData.candidates)) throw new Error("volcano list unavailable");\n    $("vCount").textContent = vData.counts ? vData.counts.volcanoes : "\\u2014";\n    var cd = vData.cooldownSecondsRemaining || 0;\n    $("vCool").textContent = cd + "s";\n    $("vCool").style.color = cd > 0 ? "var(--warn)" : "";\n    $("vHint").textContent = cd > 0\n      ? "Cooldown active \\u2014 wait " + cd + "s before a real post. Preview still works."\n      : "Pick a volcano, then Preview first. Preview never posts and never writes to KV.";\n    vFill();\n  }\n  async function vPreview() {\n    if (busy) return;\n    var id = $("vSel").value;\n    if (!id) { fail("volcano", "No volcano selected."); return; }\n    busy = true; lock(VBUTTONS, true);\n    show("volcano", "Working\\u2026");\n    try {\n      show("volcano", await apiPost("/repost-volcano", { volcano: id, target: "both", dryrun: "1" }));\n    } catch (e) { fail("volcano", e.message); }\n    finally { busy = false; lock(VBUTTONS, false); loadVolcano(); }\n  }\n  async function vPost(btn) {\n    if (busy) return;\n    var plan = channelPlan(btn, null, null);\n    var target = planToTarget(plan);\n    if (!target) { fail("volcano", "Both channels are skipped \\u2014 nothing would be sent."); return; }\n    var id = $("vSel").value;\n    if (!id) { fail("volcano", "No volcano selected."); return; }\n    if (!window.confirm("Post " + id + " to " + planWhere(plan) + "?\\n\\nThis really sends. Continue?")) return;\n    busy = true; lock(VBUTTONS, true);\n    show("volcano", "Posting to " + planWhere(plan) + "\\u2026");\n    try {\n      show("volcano", await apiPost("/repost-volcano", { volcano: id, target: target }));\n    } catch (e) { fail("volcano", e.message); }\n    finally { busy = false; lock(VBUTTONS, false); loadVolcano(); }\n  }\n  $("vPrevBtn").addEventListener("click", vPreview);\n  $("vPostBtn").addEventListener("click", function () { vPost(this); });\n  $("vPostDcBtn").addEventListener("click", function () { vPost(this); });\n  $("vPostFbBtn").addEventListener("click", function () { vPost(this); });\n\n  // ---- weather tab ------------------------------------------------------------\n  var wData = { candidates: [] };\n  function wLabel(c) {\n    var bits = [c.id];\n    if (c.headline && c.headline !== c.id) bits.push(c.headline);\n    if (c.risk) bits.push(c.risk);\n    bits.push(c.hasFbSlot ? "FB slot" : "Discord-only");\n    if (c.inactive) bits.push("inactive");\n    return bits.join("  \\u00b7  ");\n  }\n  function wFill() {\n    var sel = $("wSel");\n    sel.textContent = "";\n    if (!wData.candidates.length) {\n      var o = document.createElement("option");\n      o.value = ""; o.textContent = "No stored bulletins \\u2014 run /trigger-weather first";\n      sel.appendChild(o);\n      return;\n    }\n    wData.candidates.forEach(function (c) {\n      var op = document.createElement("option");\n      op.value = c.id;\n      op.textContent = wLabel(c);\n      sel.appendChild(op);\n    });\n  }\n  var WBUTTONS = ["wPrevBtn", "wPostBtn", "wPostDcBtn", "wPostFbBtn", "refreshBtn"];\n  async function loadWeather() {\n    wData = await api({ list: "1", monitor: "weather" });\n    if (!Array.isArray(wData.candidates)) throw new Error("weather list unavailable");\n    $("wCount").textContent = wData.counts ? wData.counts.sources : "\\u2014";\n    var cd = wData.cooldownSecondsRemaining || 0;\n    $("wCool").textContent = cd + "s";\n    $("wCool").style.color = cd > 0 ? "var(--warn)" : "";\n    $("wHint").textContent = cd > 0\n      ? "Cooldown active \\u2014 wait " + cd + "s before a real post. Preview still works."\n      : "Pick a bulletin, then Preview first. Preview never posts and never writes to KV.";\n    wFill();\n  }\n  async function wPreview() {\n    if (busy) return;\n    var id = $("wSel").value;\n    if (!id) { fail("weather", "No bulletin selected."); return; }\n    busy = true; lock(WBUTTONS, true);\n    show("weather", "Working\\u2026");\n    try {\n      show("weather", await apiPost("/repost-weather", { source: id, target: "both", dryrun: "1" }));\n    } catch (e) { fail("weather", e.message); }\n    finally { busy = false; lock(WBUTTONS, false); loadWeather(); }\n  }\n  async function wPost(btn) {\n    if (busy) return;\n    var plan = channelPlan(btn, null, null);\n    var target = planToTarget(plan);\n    if (!target) { fail("weather", "Both channels are skipped \\u2014 nothing would be sent."); return; }\n    var id = $("wSel").value;\n    if (!id) { fail("weather", "No bulletin selected."); return; }\n    if (!window.confirm("Post " + id + " to " + planWhere(plan) + "?\\n\\nThis really sends. Continue?")) return;\n    busy = true; lock(WBUTTONS, true);\n    show("weather", "Posting to " + planWhere(plan) + "\\u2026");\n    try {\n      show("weather", await apiPost("/repost-weather", { source: id, target: target }));\n    } catch (e) { fail("weather", e.message); }\n    finally { busy = false; lock(WBUTTONS, false); loadWeather(); }\n  }\n  $("wPrevBtn").addEventListener("click", wPreview);\n  $("wPostBtn").addEventListener("click", function () { wPost(this); });\n  $("wPostDcBtn").addEventListener("click", function () { wPost(this); });\n  $("wPostFbBtn").addEventListener("click", function () { wPost(this); });\n\n  // ---- boot -------------------------------------------------------------------\n  async function load() {\n    if (busy) return;\n    busy = true;\n    try {\n      await loadTsunami();\n      try { await loadVolcano(); }\n      catch (e) {\n        $("vCount").textContent = "\\u2014";\n        $("vCool").textContent = "\\u2014";\n        var o = $("vSel"); o.textContent = "";\n        var op = document.createElement("option");\n        op.value = ""; op.textContent = "Volcano list unavailable (" + e.message + ")";\n        o.appendChild(op);\n        $("vHint").textContent = "Could not load volcano candidates: " + e.message;\n      }\n      try { await loadWeather(); }\n      catch (e) {\n        $("wCount").textContent = "\\u2014";\n        $("wCool").textContent = "\\u2014";\n        var o2 = $("wSel"); o2.textContent = "";\n        var op2 = document.createElement("option");\n        op2.value = ""; op2.textContent = "Weather list unavailable (" + e.message + ")";\n        o2.appendChild(op2);\n        $("wHint").textContent = "Could not load weather candidates: " + e.message;\n      }\n    } catch (e) {\n      fail("tsunami", "Could not load candidates: " + e.message);\n      $("livePill").textContent = "error";\n      $("livePill").className = "pill bad";\n    } finally { busy = false; }\n  }\n\n  $("refreshBtn").addEventListener("click", load);\n\n  if (!KEY) { fail("tsunami", "No ?key= in the URL."); }\n  var h = "";\n  try { h = location.hash.replace("#", ""); } catch (e) {}\n  selectTab(h === "volcano" ? "tabVolcano" : h === "weather" ? "tabWeather" : "tabTsunami");\n  load();\n})();\n</script>\n</body>\n</html>\n';
}
// >>> END GENERATED admin page

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS")
            return new Response(null, { headers: CORS });
        const url = new URL(request.url);
        const path = url.pathname;
        const w = monitorEnv(env, "PAGASA_KV", "DISCORD_WEBHOOK_URL");
        const v = monitorEnv(env, "VOLCANO_KV", "VOLCANO_DISCORD_WEBHOOK_URL");
        const h = monitorEnv(env, "HAZE_KV", "HAZE_DISCORD_WEBHOOK_URL");
        const tRaw = monitorEnv(env, "TSUNAMI_KV", "TSUNAMI_WEBHOOK_URL");
        const t = (() => {
            let kv = tRaw.kv;
            let tEnv = tRaw.env;
            if (!kv && env.WEBHOOK_KV) { kv = env.WEBHOOK_KV; tEnv = { ...tEnv, WEBHOOK_KV: kv, TSUNAMI_KV: kv }; }
            else if (kv) { tEnv = { ...tEnv, WEBHOOK_KV: kv, TSUNAMI_KV: kv }; }
            return { kv, env: tEnv };
        })();

        // ---- manual triggers ----
        if (path === "/trigger") {
            if (!secretsOk(request, masterSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            const parts = [];
            parts.push("weather: " + await runGuarded("weather", w.kv, () => Weather.runMonitor(w.env, { manual: true })));
            parts.push("volcano: " + await runGuarded("volcano", v.kv, () => Volcano.runMonitor(v.env)));
            parts.push("haze: " + await runGuarded("haze", h.kv, () => Haze.runMonitor(h.env)));
            parts.push("tsunami: " + await runGuarded("tsunami", t.kv, () => Tsunami.runMonitor(t.env)));
            return json({ success: true, message: parts.join(" | ") });
        }
        if (path === "/trigger-weather") {
            if (!secretsOk(request, weatherSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            try {
                return json({ success: true, message: await runGuarded("weather", w.kv, () => Weather.runMonitor(w.env, { manual: true })) });
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
        if (path === "/trigger-tsunami") {
            if (!secretsOk(request, tsunamiSecrets(env)) && !secretsOk(request, masterSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            try {
                // ?dryrun=1 (or 2) previews without posting or touching KV.
                const qs = new URL(request.url).searchParams;
                if (qs.get("dryrun")) {
                    const limit = Math.max(1, Math.min(10, parseInt(qs.get("dryrun"), 10) || 3));
                    return json(await runGuarded("tsunami", t.kv, () => Tsunami.preview(t.env, limit)));
                }
                return json({ success: true, message: await runGuarded("tsunami", t.kv, () => Tsunami.runMonitor(t.env)) });
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }
        if (path === "/admin") {
            if (!secretsOk(request, adminSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            try {
                const qs = new URL(request.url).searchParams;
                const wantsHtml = /text\/html/i.test(request.headers.get("Accept") || "");
                // JSON candidate lists for the UI's dropdowns. ?list=1 alone
                // keeps returning the tsunami list for backward compatibility.
                if (qs.get("list") === "1") {
                    const monitor = (qs.get("monitor") ?? "tsunami").toLowerCase();
                    if (monitor === "volcano")
                        return json(await runGuarded("volcano", v.kv, () => listVolcanoCandidates(v)));
                    if (monitor === "weather")
                        return json(await runGuarded("weather", w.kv, () => listWeatherCandidates(w)));
                    return json(await runGuarded("tsunami", t.kv, () => Tsunami.listCandidates(t.env)));
                }
                // Plain GET in a browser opens the UI. curl and scripts (which do
                // not send Accept: text/html) keep getting the JSON status.
                if (wantsHtml && !qs.get("post") && qs.get("list") !== "1") {
                    return new Response(adminPageHtml(), {
                        headers: {
                            "Content-Type": "text/html; charset=UTF-8",
                            "Cache-Control": "no-store",
                            "X-Content-Type-Options": "nosniff",
                            "X-Frame-Options": "DENY",
                            "Referrer-Policy": "no-referrer",
                        },
                    });
                }
                if (!qs.get("post")) {
                    return json(await runGuarded("tsunami", t.kv, () => Tsunami.adminStatus(t.env)));
                }
                const limit = Math.max(1, Math.min(3, parseInt(qs.get("post"), 10) || 1));
                const opts = {
                    fresh: qs.get("fresh") === "1",
                    source: qs.get("source") || "both",
                    skipDiscord: qs.get("skipDiscord") === "1",
                    skipFacebook: qs.get("skipFacebook") === "1",
                    fixture: qs.get("fixture") || "",
                    level: qs.get("level") || "warning",
                    targetId: qs.get("target") || "",
                };
                // Two-step: without confirm=1 this only reports what it would do,
                // so a stray browser hit or prefetch cannot fire a real post.
                if (qs.get("confirm") !== "1") {
                    const st = await runGuarded("tsunami", t.kv, () => Tsunami.adminStatus(t.env));
                    return json({
                        ...st,
                        confirmRequired: true,
                        wouldPost: limit,
                        options: opts,
                        message: "Nothing was posted. Re-run with &confirm=1 to actually post.",
                    });
                }
                if (qs.get("dryrun") === "1") {
                    return json(await runGuarded("tsunami", t.kv, () => Tsunami.forcePost(t.env, limit, { ...opts, dryRunOnly: true })));
                }
                return json(await runGuarded("tsunami", t.kv, () => Tsunami.forcePost(t.env, limit, opts)));
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
        // ---- legacy manual page: folded into /admin (keeps old links working) ----
        if (path === "/manual") {
            if (!secretsOk(request, adminSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            const key = url.searchParams.get("key") ?? "";
            const dest = "/admin" + (key ? `?key=${encodeURIComponent(key)}` : "");
            return Response.redirect(new URL(dest, url).toString(), 302);
        }
        if (path === "/repost-weather") {
            if (!secretsOk(request, weatherSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            // Dry runs are read-only previews for the /admin UI: they never send
            // and never touch KV, so GET is allowed for them. Real posts stay
            // POST-only so a stray browser hit or prefetch cannot fire one.
            const dryRun = (url.searchParams.get("dryrun") ?? "") === "1";
            if (request.method !== "POST" && !dryRun)
                return json({ success: false, error: "Use POST" }, 405);
            if (!w.kv) return json({ success: false, error: "KV not bound" }, 500);
            const sourceKey = (url.searchParams.get("source") ?? "").trim();
            if (!sourceKey) return json({ success: false, error: "Missing ?source=forecast or ?source=tc-bulletin" }, 400);
            const snap = await Weather.getSnapshot(w.kv);
            const event = snap?.bySource?.[sourceKey];
            if (!event) return json({ success: false, error: `No stored event for source '${sourceKey}'` }, 404);
            const target = (url.searchParams.get("target") ?? "both").toLowerCase();
            const wantDiscord = target === "both" || target === "discord";
            const wantFb = target === "both" || target === "facebook" || target === "fb";
            if (!wantDiscord && !wantFb) return json({ success: false, error: "Invalid ?target= (use both, discord, or facebook)" }, 400);
            // Preview mirrors the real path's branches (mirror vs technical
            // report) using only pure message builders — no sends, no KV writes.
            // Keep the two in sync when the send path changes.
            if (dryRun) {
                const drySlot = Weather.weatherFbSlot(sourceKey);
                const drySource = { key: sourceKey, url: event.normalized?.sourceUrl ?? event.sourceUrl ?? "" };
                let discord = null;
                if (wantDiscord) {
                    if (drySlot) {
                        const fbMessage = drySlot.kind === "cyclone" ? Weather.buildCycloneFbMessage(event, drySource) : Weather.buildWeatherFbMessage(event, drySource);
                        discord = { kind: "mirror", title: drySlot.kind === "cyclone" ? "TerraGuard Cyclone Report" : "TerraGuard Weather Report", text: String(fbMessage ?? "").slice(0, 500), image: drySlot.image };
                    }
                    else {
                        discord = { kind: "technical", title: event.reportText ? `TerraGuard ${event.reportKind} — ${event.parsed?.title ?? sourceKey}` : `TerraGuard — ${sourceKey}`, text: String(event.reportText ?? "Manual repost").slice(0, 500), image: null };
                    }
                }
                const facebook = wantFb
                    ? (drySlot
                        ? { status: "would-post", slot: drySlot.kind }
                        : { status: "would-skip", reason: "no FB slot for this source (Discord-only)" })
                    : null;
                return json({ success: true, dryRun: true, source: sourceKey, target, discord, facebook });
            }
            if (w.kv) {
                const nowS = Math.floor(Date.now() / 1000);
                const last = parseInt((await w.kv.get(WEATHER_LASTPOST_KEY)) || "0", 10);
                const wait = manualCooldownWait(nowS, last, WEATHER_COOLDOWN_S);
                if (wait > 0) return json({ success: false, error: `cooldown — a manual weather post ran ${nowS - last}s ago; wait ${wait}s` }, 429);
            }
            const source = { key: sourceKey, url: event.normalized?.sourceUrl ?? event.sourceUrl ?? "" };
            const parts = [];
            if (wantDiscord) {
                try {
                    const slot = Weather.weatherFbSlot(sourceKey);
                    const fbMessage = slot ? (slot.kind === "cyclone" ? Weather.buildCycloneFbMessage(event, source) : Weather.buildWeatherFbMessage(event, source)) : null;
                    const fbTitle = slot ? (slot.kind === "cyclone" ? "TerraGuard Cyclone Report" : "TerraGuard Weather Report") : "";
                    const sat = slot ? slot.image : null;
                    if (fbMessage) {
                        await Weather.sendDiscordReport(w.env.DISCORD_WEBHOOK_URL, fbTitle, fbMessage, event.risk?.status ?? "LOW", source.url, sat, "TerraGuard • DOST-PAGASA (authoritative source)");
                        parts.push("discord mirror: posted");
                    } else {
                        await Weather.sendDiscordReport(w.env.DISCORD_WEBHOOK_URL, event.reportText ? `TerraGuard ${event.reportKind} — ${event.parsed?.title ?? sourceKey}` : `TerraGuard — ${sourceKey}`, event.reportText ?? fbMessage ?? "Manual repost", event.risk?.status ?? "LOW", source.url, w.env.PAGASA_SATELLITE === "0" ? null : undefined);
                        parts.push("discord: posted (technical report, no FB slot)");
                    }
                } catch (e) { parts.push(`discord error: ${e instanceof Error ? e.message.slice(0,200) : String(e).slice(0,200)}`); }
            } else { parts.push("discord: skipped"); }
            if (wantFb) {
                try {
                    const fbStatus = await Weather.postWeatherToFacebook(event, source, w.env);
                    parts.push(`fb: ${fbStatus}`);
                } catch (e) { parts.push(`fb error: ${e instanceof Error ? e.message.slice(0,200) : String(e).slice(0,200)}`); }
            } else { parts.push("fb: skipped"); }
            // A real post arms the cooldown even when a send errored, so a failing
            // channel cannot be hammered in a retry loop. Dry runs never reach here.
            if (w.kv) await w.kv.put(WEATHER_LASTPOST_KEY, String(Math.floor(Date.now() / 1000)));
            return json({ success: true, source: sourceKey, target, message: parts.join(" | ") });
        }
        if (path === "/repost-volcano") {
            if (!secretsOk(request, volcanoSecrets(env)) && !secretsOk(request, masterSecrets(env)))
                return new Response("Not Found", { status: 404, headers: CORS });
            // Dry runs are read-only previews for the /admin UI: they never send
            // and never touch KV, so GET is allowed for them. Real posts stay
            // POST-only so a stray browser hit or prefetch cannot fire one.
            const dryRun = (url.searchParams.get("dryrun") ?? "") === "1";
            if (request.method !== "POST" && !dryRun)
                return json({ success: false, error: "Use POST" }, 405);
            if (!v.kv) return json({ success: false, error: "KV not bound" }, 500);
            const volcano = (url.searchParams.get("volcano") ?? "").trim().toUpperCase();
            if (!volcano) return json({ success: false, error: "Missing ?volcano=MAYON|TAAL|KANLAON|BULUSAN|PINATUBO" }, 400);
            const vSnap = await Volcano.kvGet(v.kv, Volcano.SNAPSHOT_KEY);
            const event = vSnap?.byVolcano?.[volcano];
            if (!event) return json({ success: false, error: `No stored event for volcano '${volcano}'` }, 404);
            const target = (url.searchParams.get("target") ?? "both").toLowerCase();
            const wantDiscord = target === "both" || target === "discord";
            const wantFb = target === "both" || target === "facebook" || target === "fb";
            if (!wantDiscord && !wantFb) return json({ success: false, error: "Invalid ?target= (use both, discord, or facebook)" }, 400);
            // Preview uses only the pure report builders — no sends, no KV writes.
            // Keep in sync with the send path below.
            if (dryRun) {
                const reportKind = event.reportKind ?? (event.risk?.status === "HIGH" || event.risk?.status === "CRITICAL" ? "VOLCANO ALERT" : "VOLCANO NEWS");
                const reportText = reportKind === "VOLCANO ALERT" ? Volcano.buildAlert(event) : Volcano.buildNews(event);
                return json({
                    success: true, dryRun: true, volcano, target,
                    discord: wantDiscord ? { title: `${reportKind} — ${volcano} (Alert Level ${event.parsed.alertLevel ?? "?"})`, text: String(reportText ?? "").slice(0, 500), image: event.parsed.mapImg || null } : null,
                    facebook: wantFb ? { status: "would-post" } : null,
                });
            }
            if (v.kv) {
                const nowS = Math.floor(Date.now() / 1000);
                const last = parseInt((await v.kv.get(VOLCANO_LASTPOST_KEY)) || "0", 10);
                const wait = manualCooldownWait(nowS, last, VOLCANO_COOLDOWN_S);
                if (wait > 0) return json({ success: false, error: `cooldown — a manual volcano post ran ${nowS - last}s ago; wait ${wait}s` }, 429);
            }
            const parts = [];
            // Discord (and Facebook via postVolcanoToFacebook) share the same volcano event
            if (wantDiscord) {
                try {
                    // Re-use the same send path as the monitor: Discord first
                    const { parsed } = event;
                    const img = parsed.mapImg || null;
                    // Build the same report the monitor would have sent
                    const reportKind = event.reportKind ?? (event.risk?.status === "HIGH" || event.risk?.status === "CRITICAL" ? "VOLCANO ALERT" : "VOLCANO NEWS");
                    const reportText = reportKind === "VOLCANO ALERT" ? Volcano.buildAlert(event) : Volcano.buildNews(event);
                    // Volcano Discord uses its own webhook (VOLCANO_DISCORD_WEBHOOK_URL → fallback)
                    const hook = v.env.VOLCANO_DISCORD_WEBHOOK_URL || v.env.DISCORD_WEBHOOK_URL;
                    if (!hook) throw new Error("VOLCANO_DISCORD_WEBHOOK_URL not set");
                    // Minimal Discord send (reuse Volcano's sender if exposed, else generic)
                    // Fallback: use the stored reportText if sender not exported
                    const title = `${reportKind} — ${volcano} (Alert Level ${parsed.alertLevel ?? "?"})`;
                    // Prefer Volcano's Discord sender when available
                    if (typeof Volcano.sendDiscord === 'function') {
                        await Volcano.sendDiscord(hook, title, reportText, event.risk?.status ?? "LOW", event.sourceUrl || "", img);
                    } else {
                        // Generic fallback (same shape as weather)
                        const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: reportText, embeds: img ? [{ image: { url: img } }] : [] }) });
                        if (!res.ok) throw new Error(`Discord ${res.status}`);
                    }
                    parts.push("discord: posted");
                } catch (e) { parts.push(`discord error: ${e instanceof Error ? e.message.slice(0,200) : String(e).slice(0,200)}`); }
            } else { parts.push("discord: skipped"); }
            if (wantFb) {
                try {
                    const img = event.parsed?.mapImg ?? null;
                    const fbStatus = await Volcano.postToFacebook(event, img, v.env);
                    parts.push(`fb: ${fbStatus}`);
                } catch (e) { parts.push(`fb error: ${e instanceof Error ? e.message.slice(0,200) : String(e).slice(0,200)}`); }
            } else { parts.push("fb: skipped"); }
            // A real post arms the cooldown even when a send errored, so a failing
            // channel cannot be hammered in a retry loop. Dry runs never reach here.
            if (v.kv) await v.kv.put(VOLCANO_LASTPOST_KEY, String(Math.floor(Date.now() / 1000)));
            return json({ success: true, volcano, target, message: parts.join(" | ") });
        }

        // ---- AI news desk: freeform posts to Discord / Facebook ----
        if (path === "/post-news") {
            // No shared secrets in the browser: the page sends the user's
            // Supabase access token, verified here by signature, plus an email
            // allowlist. The frontend gate is UX only; this check is the lock.
            try {
                if (request.method !== "POST")
                    return json({ success: false, error: "Use POST" }, 405);
                const jwtSecret = (env.SUPABASE_JWT_SECRET ?? "").trim();
                if (!jwtSecret)
                    return json({ success: false, error: "news desk not configured (SUPABASE_JWT_SECRET)" }, 500);
                const auth = request.headers.get("Authorization") ?? "";
                const bearer = /^Bearer (.+)$/.exec(auth.trim());
                if (!bearer)
                    return json({ success: false, error: "missing Bearer token (sign in first)" }, 401);
                let claims;
                try {
                    claims = await verifySupabaseJwt(bearer[1], jwtSecret);
                }
                catch (e) {
                    return json({ success: false, error: `invalid token: ${e instanceof Error ? e.message : String(e)}` }, 401);
                }
                const email = String(claims.email ?? "").toLowerCase();
                if (!email || !parseNewsAdmins(env).includes(email))
                    return json({ success: false, error: "restricted: this page is private" }, 403);
                let body;
                try {
                    body = await request.json();
                }
                catch {
                    return json({ success: false, error: "invalid JSON body" }, 400);
                }
                const title = String(body.title ?? "").trim().slice(0, 200);
                const text = String(body.text ?? "").trim();
                if (!text && !title)
                    return json({ success: false, error: "Missing title or text" }, 400);
                if (text.length > 6000)
                    return json({ success: false, error: `text too long (${text.length}/6000)` }, 400);
                const target = String(body.target ?? "both").toLowerCase();
                const wantDiscord = target === "both" || target === "discord";
                const wantFb = target === "both" || target === "facebook" || target === "fb";
                if (!wantDiscord && !wantFb)
                    return json({ success: false, error: "Invalid target (use both, discord, or facebook)" }, 400);
                const imageUrls = normalizeNewsImages(body);
                if (Array.isArray(body?.imageUrls) && body.imageUrls.length > MAX_NEWS_IMAGES)
                    return json({ success: false, error: `too many images (max ${MAX_NEWS_IMAGES})` }, 400);
                if ((body?.imageUrl || (Array.isArray(body?.imageUrls) && body.imageUrls.length > 0)) && imageUrls.length === 0)
                    return json({ success: false, error: "image URLs must be https URLs" }, 400);
                const newsDry = (url.searchParams.get("dryrun") ?? "") === "1";
                if (newsDry) {
                    return json({
                        success: true, dryRun: true, title, target,
                        discord: wantDiscord ? { title, chars: text.length, images: imageUrls.length } : null,
                        facebook: wantFb ? { status: imageUrls.length > 1 ? "would-album" : imageUrls.length === 1 ? "would-photo" : "would-post", images: imageUrls.length } : null,
                    });
                }
                const nkv = t.kv || w.kv || v.kv || h.kv;
                if (nkv) {
                    const nowS = Math.floor(Date.now() / 1000);
                    const last = parseInt((await nkv.get(NEWS_LASTPOST_KEY)) || "0", 10);
                    const wait = manualCooldownWait(nowS, last, NEWS_COOLDOWN_S);
                    if (wait > 0)
                        return json({ success: false, error: `cooldown — a news post ran ${nowS - last}s ago; wait ${wait}s` }, 429);
                }
                const parts = [];
                if (wantDiscord) {
                    try {
                        const hook = t.env.DISCORD_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL;
                        if (!hook) throw new Error("DISCORD_WEBHOOK_URL not set");
                        parts.push(await postNewsToDiscord(title, text, imageUrls, hook));
                    }
                    catch (e) {
                        parts.push(`discord error: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`);
                    }
                }
                else {
                    parts.push("discord: skipped");
                }
                if (wantFb) {
                    try {
                        parts.push(await postNewsToFacebook(title, text, imageUrls, env));
                    }
                    catch (e) {
                        parts.push(`fb error: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`);
                    }
                }
                else {
                    parts.push("fb: skipped");
                }
                // Arm the cooldown even when a send errored. Dry runs return above.
                if (nkv) await nkv.put(NEWS_LASTPOST_KEY, String(Math.floor(Date.now() / 1000)));
                return json({ success: true, title, target, message: parts.join(" | ") });
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
        const tRaw = monitorEnv(env, "TSUNAMI_KV", "TSUNAMI_WEBHOOK_URL");
        const t = (() => {
            let kv = tRaw.kv;
            let tEnv = tRaw.env;
            if (!kv && env.WEBHOOK_KV) { kv = env.WEBHOOK_KV; tEnv = { ...tEnv, WEBHOOK_KV: kv, TSUNAMI_KV: kv }; }
            else if (kv) { tEnv = { ...tEnv, WEBHOOK_KV: kv, TSUNAMI_KV: kv }; }
            return { kv, env: tEnv };
        })();
        ctx.waitUntil((async () => {
            try {
                if (DAILY_CRONS.has(event.cron)) {
                    console.log(`[cron][weather][daily] ${await runGuarded("daily", w.kv, () => Weather.runDaily(w.env))}`);
                    return;
                }
                console.log(`[cron][weather] ${await runGuarded("weather", w.kv, () => Weather.runMonitor(w.env))}`);
                console.log(`[cron][volcano] ${await runGuarded("volcano", v.kv, () => Volcano.runMonitor(v.env))}`);
                console.log(`[cron][haze] ${await runGuarded("haze", h.kv, () => Haze.runMonitor(h.env))}`);
                console.log(`[cron][tsunami] ${await runGuarded("tsunami", t.kv, () => Tsunami.runMonitor(t.env))}`);
            }
            catch (e) {
                console.error("[cron][terraguard] failed", e);
            }
        })());
    },
};
