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

export default {
    async fetch(request, env) {
        if (request.method === "OPTIONS")
            return new Response(null, { headers: CORS });
        if (!authorized(request, env))
            return new Response("Not Found", { status: 404, headers: CORS });
        const url = new URL(request.url);
        try {
            if (url.pathname === "/trigger" || url.pathname === "/cron-webhook")
                return json({ success: true, message: await runMonitor(env) });
            if (url.pathname === "/api/haze/latest") {
                const snap = await kvGetJson(env.HAZE_KV, SNAPSHOT_KEY);
                return json({ success: true, data: snap });
            }
            if (url.pathname === "/api/haze/events") {
                const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
                const index = (await kvGetJson(env.HAZE_KV, INDEX_KEY)) ?? [];
                return json({ success: true, count: Math.min(limit, index.length), data: index.slice(0, limit) });
            }
            if (url.pathname === "/api/haze/event") {
                const id = url.searchParams.get("id") ?? "";
                if (!id)
                    return json({ success: false, error: "Missing ?id=" }, 400);
                const ev = await kvGetJson(env.HAZE_KV, `haze:event:${id}`);
                if (!ev)
                    return json({ success: false, error: "Not found" }, 404);
                return json({ success: true, data: ev });
            }
        }
        catch (e) {
            return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
        }
        return new Response("Not Found", { status: 404, headers: CORS });
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
            try {
                console.log(`[cron][haze][${event.cron}] ${await runMonitor(env)}`);
            }
            catch (e) {
                console.error("[cron][haze] failed", e);
            }
        })());
    },
};
