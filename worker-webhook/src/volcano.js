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
    const credit = !image ? "TerraGuard Volcano Watch • DOST-PHIVOLCS (authoritative source)"
        : /phivolcs/i.test(image) ? "TerraGuard Volcano Watch • DOST-PHIVOLCS (source) • 🗺️ PHIVOLCS bulletin map"
            : "TerraGuard Volcano Watch • DOST-PHIVOLCS (source) • 🛰️ JMA Himawari imagery";
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
            if (url.pathname === "/api/volcano/latest") {
                const snap = await kvGetJson(env.VOLCANO_KV, SNAPSHOT_KEY);
                return json({ success: true, data: snap });
            }
            if (url.pathname === "/api/volcano/events") {
                const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20));
                const index = (await kvGetJson(env.VOLCANO_KV, INDEX_KEY)) ?? [];
                return json({ success: true, count: Math.min(limit, index.length), data: index.slice(0, limit) });
            }
            if (url.pathname === "/api/volcano/event") {
                const id = url.searchParams.get("id") ?? "";
                if (!id)
                    return json({ success: false, error: "Missing ?id=" }, 400);
                const ev = await kvGetJson(env.VOLCANO_KV, `volcano:event:${id}`);
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
                console.log(`[cron][volcano][${event.cron}] ${await runMonitor(env)}`);
            }
            catch (e) {
                console.error("[cron][volcano] failed", e);
            }
        })());
    },
};
