/**
 * Terra Guard PH — Unified Earthquake Monitor: USGS + EMSC (PRIVATE).
 *
 * Single-file Cloudflare Worker merging the former index.ts (USGS) and
 * emsc.ts workers. One worker, one cron set. Message templates, KV keys,
 * and env vars are unchanged, so history carries over with zero data loss.
 *
 * New: CROSS-SOURCE DEDUP. A big quake appears in both feeds with different
 * IDs — whichever source posts first wins; the other's arrival within the
 * match window (±180s, 150km, ΔM≤0.7) is recorded silently instead of
 * double-posting to Discord.
 *
 * Public GET/POST returns 404 except /health. Manual trigger needs
 * Authorization: Bearer <CRON_SECRET> or ?key=<CRON_SECRET>.
 * Sources: USGS FDSN + EMSC SeismicPortal FDSNWS (official feeds).
 */

// ===== shared =====
const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const UTC_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SENT_INDEX_KEY = "quake:sent-index";
const CROSS_WINDOW_MS = 180 * 1000;
const CROSS_MAX_KM = 150;
const CROSS_MAX_MAG_DIFF = 0.7;

function formatUtc(date) {
    const day = date.getUTCDate();
    const month = UTC_MONTHS[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    const h = String(date.getUTCHours()).padStart(2, "0");
    const m = String(date.getUTCMinutes()).padStart(2, "0");
    const s = String(date.getUTCSeconds()).padStart(2, "0");
    return `${day} ${month} ${year} - ${h}:${m}:${s} UTC`;
}

function formatUstFromMs(timeMs) {
    const d = new Date(timeMs);
    const dateStr = `${String(d.getUTCDate()).padStart(2, "0")} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    let h = d.getUTCHours();
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const timeStr = `${String(h).padStart(2, "0")}:${m} ${ampm} UST`;
    return { date: dateStr, time: timeStr };
}

// UTC instant -> display parts with an explicit UTC label. Used by the
// EMSC Facebook path (EMSC times ARE UTC) — never for PHIVOLCS wall times.
function formatUtcDisplayMs(timeMs) {
    const d = new Date(timeMs);
    const date = `${String(d.getUTCDate()).padStart(2, "0")} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    let h = d.getUTCHours();
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return { date, time: `${String(h).padStart(2, "0")}:${m} ${ampm} UTC` };
}

// Country name (as it appears in ?place= tails) -> ISO3. Mirrors the
// quake-card.php table so posts and cards resolve the same country.
const COUNTRY_ISO3 = {
    "PHILIPPINES": "PHL", "INDONESIA": "IDN", "MALAYSIA": "MYS", "JAPAN": "JPN",
    "TAIWAN": "TWN", "CHINA": "CHN", "HONG KONG": "HKG", "MONGOLIA": "MNG",
    "SOUTH KOREA": "KOR", "KOREA": "KOR", "NORTH KOREA": "PRK", "THAILAND": "THA",
    "VIETNAM": "VNM", "CAMBODIA": "KHM", "LAOS": "LAO", "MYANMAR": "MMR",
    "BANGLADESH": "BGD", "BHUTAN": "BTN", "NEPAL": "NPL", "INDIA": "IND",
    "PAKISTAN": "PAK", "AFGHANISTAN": "AFG", "SRI LANKA": "LKA", "MALDIVES": "MDV",
    "PAPUA NEW GUINEA": "PNG", "FIJI": "FJI", "VANUATU": "VUT", "SOLOMON ISLANDS": "SLB",
    "NEW CALEDONIA": "NCL", "TONGA": "TON", "SAMOA": "WSM", "NEW ZEALAND": "NZL",
    "AUSTRALIA": "AUS", "PALAU": "PLW", "MICRONESIA": "FSM", "MARSHALL ISLANDS": "MHL",
    "KIRIBATI": "KIR", "TUVALU": "TUV", "NAURU": "NRU", "GUAM": "GUM",
    "HAWAII": "USA", "ALASKA": "USA", "CALIFORNIA": "USA", "UNITED STATES": "USA",
    "USA": "USA", "CANADA": "CAN", "MEXICO": "MEX", "GUATEMALA": "GTM",
    "EL SALVADOR": "SLV", "HONDURAS": "HND", "NICARAGUA": "NIC", "COSTA RICA": "CRI",
    "PANAMA": "PAN", "CUBA": "CUB", "JAMAICA": "JAM", "HAITI": "HTI",
    "DOMINICAN REPUBLIC": "DOM", "PUERTO RICO": "PRI", "COLOMBIA": "COL",
    "VENEZUELA": "VEN", "ECUADOR": "ECU", "PERU": "PER", "BOLIVIA": "BOL",
    "CHILE": "CHL", "ARGENTINA": "ARG", "BRAZIL": "BRA", "URUGUAY": "URY",
    "PARAGUAY": "PRY", "TURKEY": "TUR", "TURKIYE": "TUR", "GREECE": "GRC",
    "ITALY": "ITA", "SPAIN": "ESP", "PORTUGAL": "PRT", "ICELAND": "ISL",
    "UNITED KINGDOM": "GBR", "UK": "GBR", "ENGLAND": "GBR", "IRELAND": "IRL",
    "FRANCE": "FRA", "GERMANY": "DEU", "NETHERLANDS": "NLD", "BELGIUM": "BEL",
    "SWITZERLAND": "CHE", "AUSTRIA": "AUT", "POLAND": "POL", "CZECHIA": "CZE",
    "SLOVAKIA": "SVK", "HUNGARY": "HUN", "ROMANIA": "ROU", "BULGARIA": "BGR",
    "SERBIA": "SRB", "CROATIA": "HRV", "SLOVENIA": "SVN", "BOSNIA": "BIH",
    "ALBANIA": "ALB", "NORTH MACEDONIA": "MKD", "UKRAINE": "UKR", "RUSSIA": "RUS",
    "KAZAKHSTAN": "KAZ", "UZBEKISTAN": "UZB", "TAJIKISTAN": "TJK", "KYRGYZSTAN": "KGZ",
    "TURKMENISTAN": "TKM", "AZERBAIJAN": "AZE", "GEORGIA": "GEO", "ARMENIA": "ARM",
    "IRAN": "IRN", "IRAQ": "IRQ", "SAUDI ARABIA": "SAU", "YEMEN": "YEM",
    "OMAN": "OMN", "UAE": "ARE", "QATAR": "QAT", "KUWAIT": "KWT",
    "ISRAEL": "ISR", "JORDAN": "JOR", "LEBANON": "LBN", "SYRIA": "SYR",
    "EGYPT": "EGY", "MOROCCO": "MAR", "ALGERIA": "DZA", "TUNISIA": "TUN",
    "ETHIOPIA": "ETH", "KENYA": "KEN", "TANZANIA": "TZA", "MOZAMBIQUE": "MOZ",
    "MADAGASCAR": "MDG", "SOUTH AFRICA": "ZAF", "GHANA": "GHA", "NIGERIA": "NGA",
    "SOMALIA": "SOM", "SUDAN": "SDN",
};

// Representative IANA zone per ISO3 (single zone per country; big multi-zone
// countries use their population center — documented approximation).
const COUNTRY_TZ = {
    "PHL": "Asia/Manila", "IDN": "Asia/Jakarta", "MYS": "Asia/Kuala_Lumpur", "JPN": "Asia/Tokyo",
    "TWN": "Asia/Taipei", "CHN": "Asia/Shanghai", "HKG": "Asia/Hong_Kong", "MNG": "Asia/Ulaanbaatar",
    "KOR": "Asia/Seoul", "PRK": "Asia/Pyongyang", "THA": "Asia/Bangkok", "VNM": "Asia/Ho_Chi_Minh",
    "KHM": "Asia/Phnom_Penh", "LAO": "Asia/Vientiane", "MMR": "Asia/Yangon", "BGD": "Asia/Dhaka",
    "BTN": "Asia/Thimphu", "NPL": "Asia/Kathmandu", "IND": "Asia/Kolkata", "PAK": "Asia/Karachi",
    "AFG": "Asia/Kabul", "LKA": "Asia/Colombo", "MDV": "Indian/Maldives", "PNG": "Pacific/Port_Moresby",
    "FJI": "Pacific/Fiji", "VUT": "Pacific/Efate", "SLB": "Pacific/Guadalcanal", "NCL": "Pacific/Noumea",
    "TON": "Pacific/Tongatapu", "WSM": "Pacific/Apia", "NZL": "Pacific/Auckland", "AUS": "Australia/Sydney",
    "PLW": "Pacific/Palau", "FSM": "Pacific/Chuuk", "MHL": "Pacific/Majuro", "KIR": "Pacific/Tarawa",
    "TUV": "Pacific/Funafuti", "NRU": "Pacific/Nauru", "GUM": "Pacific/Guam", "USA": "America/New_York",
    "CAN": "America/Toronto", "MEX": "America/Mexico_City", "GTM": "America/Guatemala", "SLV": "America/El_Salvador",
    "HND": "America/Tegucigalpa", "NIC": "America/Managua", "CRI": "America/Costa_Rica", "PAN": "America/Panama",
    "CUB": "America/Havana", "JAM": "America/Jamaica", "HTI": "America/Port-au-Prince", "DOM": "America/Santo_Domingo",
    "PRI": "America/Puerto_Rico", "COL": "America/Bogota", "VEN": "America/Caracas", "ECU": "America/Guayaquil",
    "PER": "America/Lima", "BOL": "America/La_Paz", "CHL": "America/Santiago", "ARG": "America/Argentina/Buenos_Aires",
    "BRA": "America/Sao_Paulo", "URY": "America/Montevideo", "PRY": "America/Asuncion", "TUR": "Europe/Istanbul",
    "GRC": "Europe/Athens", "ITA": "Europe/Rome", "ESP": "Europe/Madrid", "PRT": "Europe/Lisbon",
    "ISL": "Atlantic/Reykjavik", "GBR": "Europe/London", "IRL": "Europe/Dublin", "FRA": "Europe/Paris",
    "DEU": "Europe/Berlin", "NLD": "Europe/Amsterdam", "BEL": "Europe/Brussels", "CHE": "Europe/Zurich",
    "AUT": "Europe/Vienna", "POL": "Europe/Warsaw", "CZE": "Europe/Prague", "SVK": "Europe/Bratislava",
    "HUN": "Europe/Budapest", "ROU": "Europe/Bucharest", "BGR": "Europe/Sofia", "SRB": "Europe/Belgrade",
    "HRV": "Europe/Zagreb", "SVN": "Europe/Ljubljana", "BIH": "Europe/Sarajevo", "ALB": "Europe/Tirane",
    "MKD": "Europe/Skopje", "UKR": "Europe/Kyiv", "RUS": "Europe/Moscow", "KAZ": "Asia/Almaty",
    "UZB": "Asia/Samarkand", "TJK": "Asia/Dushanbe", "KGZ": "Asia/Bishkek", "TKM": "Asia/Ashgabat",
    "AZE": "Asia/Baku", "GEO": "Asia/Tbilisi", "ARM": "Asia/Yerevan", "IRN": "Asia/Tehran",
    "IRQ": "Asia/Baghdad", "SAU": "Asia/Riyadh", "YEM": "Asia/Aden", "OMN": "Asia/Muscat",
    "ARE": "Asia/Dubai", "QAT": "Asia/Qatar", "KWT": "Asia/Kuwait", "ISR": "Asia/Jerusalem",
    "JOR": "Asia/Amman", "LBN": "Asia/Beirut", "SYR": "Asia/Damascus", "EGY": "Africa/Cairo",
    "MAR": "Africa/Casablanca", "DZA": "Africa/Algiers", "TUN": "Africa/Tunis", "ETH": "Africa/Addis_Ababa",
    "KEN": "Africa/Nairobi", "TZA": "Africa/Dar_es_Salaam", "MOZ": "Africa/Maputo", "MDG": "Indian/Antananarivo",
    "ZAF": "Africa/Johannesburg", "GHA": "Africa/Accra", "NGA": "Africa/Lagos", "SOM": "Africa/Mogadishu",
    "SDN": "Africa/Khartoum",
};

function locationToIso3(location) {
    const loc = String(location ?? "");
    let tail = loc;
    const p = loc.lastIndexOf(",");
    if (p !== -1) tail = loc.slice(p + 1).trim();
    const up = tail.toUpperCase();
    if (up && COUNTRY_ISO3[up]) return COUNTRY_ISO3[up];
    const full = loc.toUpperCase();
    for (const name of Object.keys(COUNTRY_ISO3)) {
        if (up && (up.includes(name) || name.includes(up))) return COUNTRY_ISO3[name];
    }
    for (const name of Object.keys(COUNTRY_ISO3)) {
        if (full.includes(name)) return COUNTRY_ISO3[name];
    }
    return null;
}

// UTC instant -> display parts in the quake country's local zone when known
// (labelled, e.g. "03:40 PM CST"), otherwise plain UTC parts as before.
function formatLocalDisplayMs(timeMs, location) {
    const iso = locationToIso3(location);
    const tz = iso ? COUNTRY_TZ[iso] : null;
    if (!tz) return formatUtcDisplayMs(timeMs);
    try {
        const d = new Date(timeMs);
        const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "2-digit", month: "long", year: "numeric" }).format(d);
        const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(d);
        return { date, time };
    } catch {
        return formatUtcDisplayMs(timeMs);
    }
}

// PHIVOLCS bulletin wall time (PHT) split for display — the real published
// time, no conversion. "14 September 2026 - 05:22 PM" ->
// { date: "14 September 2026", time: "05:22 PM PHT" }.
function phivolcsDisplayParts(datetimeStr) {
    const m = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*-\s*(\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(String(datetimeStr ?? "").trim());
    if (!m)
        return { date: String(datetimeStr ?? "").trim(), time: "" };
    const ap = (m[3] || "").toUpperCase();
    return { date: m[1].trim(), time: `${m[2]}${ap ? ` ${ap}` : ""} PHT`.trim() };
}

function severityColor(mag) {
    if (mag < 3)
        return "#10b981";
    if (mag < 4)
        return "#3b82f6";
    if (mag < 5)
        return "#f59e0b";
    if (mag < 6)
        return "#ef4444";
    return "#7f1d1d";
}

function earthquakeToEqId(eq) {
    return btoa(`${eq.datetime}-${eq.latitude}-${eq.longitude}`).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

async function getSentIndex(kv) {
    try {
        const raw = await kv.get(SENT_INDEX_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}

/** Same physical quake already announced by the other feed? */
function findCrossMatch(index, source, timeMs, lat, lng, mag) {
    for (const e of index) {
        if (e.source === source)
            continue;
        if (Math.abs(e.timeMs - timeMs) > CROSS_WINDOW_MS)
            continue;
        if (Math.abs(e.mag - mag) > CROSS_MAX_MAG_DIFF)
            continue;
        if (haversineKm(e.lat, e.lng, lat, lng) > CROSS_MAX_KM)
            continue;
        return e;
    }
    return null;
}

async function recordSent(kv, entry) {
    const index = await getSentIndex(kv);
    index.unshift({ ...entry, sentAt: new Date().toISOString() });
    await kv.put(SENT_INDEX_KEY, JSON.stringify(index.slice(0, 50)), { expirationTtl: 60 * 60 * 24 * 30 });
}

// PUT a ✅/❎ reaction, logging Discord's real error instead of swallowing
// it (a silent .catch hid 403-permission / 401-token failures).
async function putReaction(url, headers, tag) {
    try {
        const r = await fetch(url, { method: "PUT", headers });
        if (!r.ok) {
            const t = await r.text().catch(() => "");
            console.error(`[reactions][${tag}] ${r.status}: ${t.slice(0, 200)}`);
        }
    }
    catch (e) {
        console.error(`[reactions][${tag}] exception`, e instanceof Error ? e.message : String(e));
    }
    await new Promise((r) => setTimeout(r, 300));
}

// ===== Facebook cross-post dedup (EMSC + PHIVOLCS both post to FB) =====
// Records every successful FB post so the other source never double-posts
// the same physical quake. Separate from SENT_INDEX (which also tracks
// USGS/Discord-only announcements that must NOT suppress FB posts).
const FB_POSTED_KEY = "fb:posted-index";

async function getFbPostedIndex(kv) {
    try {
        const raw = await kv.get(FB_POSTED_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}

async function recordFbPosted(kv, entry) {
    const index = await getFbPostedIndex(kv);
    index.unshift({ ...entry, postedAt: new Date().toISOString() });
    await kv.put(FB_POSTED_KEY, JSON.stringify(index.slice(0, 50)), { expirationTtl: 60 * 60 * 24 * 30 });
}

// Fire-and-forget trigger for the free headless video renderer (GitHub
// Actions + node-canvas + FFmpeg, scripts/video-entry.ts). Auto video data
// is USGS-only: called on USGS final-report successes at/above
// RENDER_MIN_MAG — never for EMSC/PHIVOLCS. All failures stay in the logs.
async function dispatchVideoRender(env, payload) {
    const token = (env.GH_DISPATCH_TOKEN ?? "").trim();
    const repo = (env.GH_REPO ?? "nelljay-git/terraguard").trim();
    if (!token || !repo.includes("/"))
        return;
    const minMag = parseFloat(env.RENDER_MIN_MAG ?? "5.0");
    const mag = parseFloat(payload.magnitude);
    if (!isNaN(minMag) && (isNaN(mag) || mag < minMag))
        return;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
            method: "POST",
            signal: ctrl.signal,
            headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "TerraGuard-Worker/1.0",
            },
            body: JSON.stringify({ event_type: "quake-video", client_payload: payload }),
        });
        clearTimeout(t);
        if (r.status === 204)
            console.log(`[video] dispatch sent for ${payload.source} M${payload.magnitude}`);
        else
            console.error(`[video] dispatch HTTP ${r.status}`);
    }
    catch (e) {
        console.error("[video] dispatch failed", e instanceof Error ? e.message : String(e));
    }
}

// Same physical quake already posted to Facebook (any FB source)?
function findFbPostMatch(index, timeMs, lat, lng, mag) {
    for (const e of index) {
        if (Math.abs(e.timeMs - timeMs) > CROSS_WINDOW_MS)
            continue;
        if (Math.abs(e.mag - mag) > CROSS_MAX_MAG_DIFF)
            continue;
        if (haversineKm(e.lat, e.lng, lat, lng) > CROSS_MAX_KM)
            continue;
        return e;
    }
    return null;
}

// Shared FB gates (FB_MAG_MIN + FB_COUNTRY_FOCUS). Returns a skip-reason
// string or null when the quake passes. Used by EMSC + PHIVOLCS paths.
function fbPassesFilters(eq, env) {
    const magMin = parseFloat(env.FB_MAG_MIN ?? "");
    const mag = parseFloat(eq.magnitude);
    if (!isNaN(magMin) && !isNaN(mag) && mag < magMin)
        return `skipped (M${eq.magnitude} < FB_MAG_MIN ${magMin})`;
    const focusRaw = (env.FB_COUNTRY_FOCUS ?? "").trim();
    const focusUpper = focusRaw.toUpperCase();
    if (focusRaw && focusUpper !== "ALL" && focusUpper !== "*") {
        const locUpper = String(eq.location ?? "").toUpperCase();
        const focuses = focusRaw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
        if (!focuses.includes("ALL") && !focuses.includes("*") && !focuses.some((f) => locUpper.includes(f)))
            return `skipped (outside FB_COUNTRY_FOCUS ${focusRaw})`;
    }
    return null;
}

// PHP hosts: primary (trikefare) with automatic fallback to the backup host
// (backup) when the primary 503s or is unreachable.
const PHP_PRIMARY_ORIGIN = "https://trikefare.x10.mx/terraguard";
const PHP_BACKUP_ORIGIN = "https://terraguard-auto.page.gd/terraguard";

function quakeCardCandidates(cardParams) {
    if (!cardParams) return [];
    return [
        `${PHP_PRIMARY_ORIGIN}/api/quake-card.php?${cardParams}`,
        `${PHP_BACKUP_ORIGIN}/api/quake-card.php?${cardParams}`,
    ];
}

function phivolcsApiCandidates(env) {
    const primary = ((env.PHIVOLCS_API_URL ?? `${PHP_PRIMARY_ORIGIN}/phivolcs.php`) + "").trim();
    const backup = ((env.PHIVOLCS_API_URL_BACKUP ?? `${PHP_BACKUP_ORIGIN}/phivolcs.php`) + "").trim();
    return primary === backup ? [primary] : [primary, backup];
}

// Warm a designed card URL before handing it to Facebook (cold PHP-GD +
// Yandex tiles make FB's scraper time out on first hit). Returns true when renderable.
async function warmCardUrl(url, tag, timeoutMs = 18000) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), timeoutMs);
            const r = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { "User-Agent": "TerraGuard-FB-Warmup/1.0" } });
            clearTimeout(t);
            if (r.ok) {
                // Also ensure it's actually an image, not a 500 text error
                const ct = r.headers.get("content-type") || "";
                if (ct.includes("image/")) return true;
                console.error(`[fb][${tag}] card warmup bad content-type ${ct} (attempt ${attempt})`);
            } else {
                console.error(`[fb][${tag}] card warmup ${r.status} (attempt ${attempt}): ${url.slice(0, 120)}`);
            }
        }
        catch (e) {
            console.error(`[fb][${tag}] card warmup failed (attempt ${attempt}): ${e instanceof Error ? e.message : String(e)}`);
        }
        await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
}

// ===== USGS video intensity retry (auto-post only) =====
// Retry anchor is the first check when products were not ready.
// Delays are 1m, 2m, 5m, 10m from that anchor. Cron is 1m.
const VIDEO_RETRY_DELAYS = [60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
const PENDING_VIDEO_PREFIX = "video:pending:usgs:";

async function fetchUsgsProductJson(url, timeoutMs = 8000) {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "TerraGuard-USGS-Intensity/1.0" } });
        clearTimeout(t);
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; }
}

function cleanUsgsIntensityName(raw) {
    if (!raw) return "";
    return raw.replace(/UTM:\([^)]*\)/g, "").replace(/<br\s*\/?>/gi, ", ").replace(/^[,\s;]+|[,\s;]+$/g, "").trim();
}

// Returns { hasInstrumental, hasReported, intensity } where intensity is the
// preferred value (instrumental first, then reported). Empty string means not ready.
async function fetchUsgsIntensityStatus(usgsId, timeoutMs = 8000) {
    try {
        const detail = await fetchUsgsProductJson(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${encodeURIComponent(usgsId)}`, timeoutMs);
        if (!detail) return { hasInstrumental: false, hasReported: false, intensity: "" };
        const props = detail.properties || {};
        const products = props.products || {};
        // Instrumental: shakemap stationlist / losspager cities / mmi
        let instrumentalIntensity = "";
        let hasInstrumentalData = false;
        const shakemap = products.shakemap?.[0];
        if (shakemap) {
            const stationJson = await fetchUsgsProductJson(shakemap.contents?.["download/stationlist.json"]?.url, timeoutMs);
            if (stationJson?.features?.length) {
                let maxInt = -Infinity;
                for (const f of stationJson.features) {
                    const v = f?.properties?.intensity;
                    const n = Number(v);
                    if (v != null && v !== "null" && !isNaN(n) && n > maxInt) maxInt = n;
                }
                if (maxInt !== -Infinity) {
                    instrumentalIntensity = mmiToRoman(maxInt);
                    hasInstrumentalData = true;
                } else {
                    hasInstrumentalData = true;
                }
            }
            if (!instrumentalIntensity && !hasInstrumentalData) {
                const cities = await fetchUsgsProductJson(products.losspager?.[0]?.contents?.["cities.json"]?.url, timeoutMs);
                if (Array.isArray(cities?.all_cities) && cities.all_cities.length > 0) {
                    let maxMmi = -Infinity;
                    for (const c of cities.all_cities) {
                        const n = Number(c.mmi);
                        if (!isNaN(n) && n > maxMmi) maxMmi = n;
                    }
                    if (maxMmi !== -Infinity) {
                        instrumentalIntensity = mmiToRoman(maxMmi);
                        hasInstrumentalData = true;
                    } else {
                        hasInstrumentalData = true;
                    }
                }
            }
            if (!instrumentalIntensity && !hasInstrumentalData && props.mmi != null) {
                instrumentalIntensity = mmiToRoman(props.mmi);
                hasInstrumentalData = true;
            }
        }
        // Reported is intentionally NOT used for video (user wants instrumental only).
        // We still fetch it for logging but do not treat it as ready for FINAL FLASH.
        let reportedIntensity = "";
        let hasReportedData = false;
        // Keep hasReportedData false so that isReady = hasInstrumentalData only
        // Instrumental ONLY per user request (no fallback to reported/cdi)
        let intensity = "";
        if (hasInstrumentalData && instrumentalIntensity) {
            intensity = instrumentalIntensity;
        } else if (hasInstrumentalData && props.mmi != null) {
            intensity = mmiToRoman(props.mmi);
        } else if (hasInstrumentalData) {
            intensity = "";
        }
        return { hasInstrumental: hasInstrumentalData, hasReported: false, intensity };
    } catch {
        return { hasInstrumental: false, hasReported: false, intensity: "" };
    }
}

function pendingVideoKey(usgsId) { return `${PENDING_VIDEO_PREFIX}${usgsId}`; }

async function getPendingVideo(kv, usgsId) {
    try {
        const raw = await kv.get(pendingVideoKey(usgsId));
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

async function setPendingVideo(kv, usgsId, data) {
    await kv.put(pendingVideoKey(usgsId), JSON.stringify(data), { expirationTtl: 60 * 60 * 24 });
}

async function clearPendingVideo(kv, usgsId) {
    try { await kv.delete(pendingVideoKey(usgsId)); } catch { /* ignore */ }
}

// Called on every cron to advance retries. Dispatches FINAL FLASH when ready,
// or fallback (magnitude-only) after 10m. Never throws.
async function processPendingVideos(env) {
    const kv = env.WEBHOOK_KV;
    // List pending keys via scan of known prefix - KV has no list, so we store an index
    const indexRaw = await kv.get("video:pending:index");
    let index = [];
    try { index = indexRaw ? JSON.parse(indexRaw) : []; } catch { index = []; }
    if (!Array.isArray(index) || index.length === 0) return "no pending videos";
    const now = Date.now();
    let dispatched = 0;
    let stillPending = [];
    for (const usgsId of index) {
        const pending = await getPendingVideo(kv, usgsId);
        if (!pending) continue;
        const elapsed = now - pending.firstCheck;
        const nextDelay = VIDEO_RETRY_DELAYS[pending.nextIndex] ?? Infinity;
        // Not yet time for next retry - keep pending
        if (elapsed < nextDelay && pending.nextIndex < VIDEO_RETRY_DELAYS.length) {
            stillPending.push(usgsId);
            continue;
        }
        // Time to check or final fallback
        const status = await fetchUsgsIntensityStatus(usgsId);
        const isReady = status.hasInstrumental;
        const intensityForVideo = status.intensity || "";
        const isFinalAttempt = pending.nextIndex >= VIDEO_RETRY_DELAYS.length - 1;
        if (isReady || isFinalAttempt) {
            // Dispatch with intensity if ready, else fallback (empty intensity -> magnitude-only template)
            const payloadIntensity = isReady ? intensityForVideo : "";
            await dispatchVideoRender(env, {
                source: "usgs",
                latitude: pending.payload.latitude,
                longitude: pending.payload.longitude,
                magnitude: pending.payload.magnitude,
                depth: pending.payload.depth,
                place: pending.payload.place,
                datetime: pending.payload.datetime,
                fbPostId: "",
                extra: {
                    usgsEventId: usgsId,
                    threat: pending.payload.threat,
                    tsunamiThreat: pending.payload.threat,
                    intensity: payloadIntensity,
                    finalReport: true,
                },
            });
            await clearPendingVideo(kv, usgsId);
            dispatched++;
            // Do not re-add to stillPending
        } else {
            // Not ready, schedule next retry
            pending.nextIndex += 1;
            pending.lastCheck = now;
            await setPendingVideo(kv, usgsId, pending);
            stillPending.push(usgsId);
        }
    }
    await kv.put("video:pending:index", JSON.stringify(stillPending), { expirationTtl: 60 * 60 * 24 });
    if (dispatched === 0 && stillPending.length > 0) return `pending videos: ${stillPending.length} waiting`;
    if (dispatched > 0) return `pending videos: dispatched ${dispatched}, ${stillPending.length} still pending`;
    return "no pending videos";
}

// ===== USGS =====
function usgsTsunamiLabel(tsunami) {
    if (tsunami === 1)
        return "TSUNAMI ADVISORY";
    return "NONE";
}
// Feed MMI (when assigned) -> roman numerals for the video renderer.
function mmiToRoman(mmi) {
    const n = Math.round(Number(mmi));
    const romans = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
    return n >= 1 && n <= 10 ? romans[n] : "";
}

async function fetchLatestUsgsEarthquake(env) {
    const feed = (env.USGS_FEED ?? "all_day.geojson").replace(/^\//, "");
    const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}`;
    const res = await fetch(url, { headers: { "User-Agent": "TerraGuard-Cron-USGS/1.0" } });
    if (!res.ok)
        throw new Error(`USGS ${res.status}`);
    const data = await res.json();
    const feats = data.features ?? [];
    if (feats.length === 0)
        return null;
    feats.sort((a, b) => (b.properties.time ?? 0) - (a.properties.time ?? 0));
    const minMag = parseFloat(env.MIN_MAGNITUDE ?? "4.5");
    const minLat = parseFloat(env.USGS_MIN_LAT ?? "-90");
    const maxLat = parseFloat(env.USGS_MAX_LAT ?? "90");
    const minLng = parseFloat(env.USGS_MIN_LNG ?? "-180");
    const maxLng = parseFloat(env.USGS_MAX_LNG ?? "180");
    const filterByPH = !isNaN(minLat) && !isNaN(maxLat) && !isNaN(minLng) && !isNaN(maxLng) && !(minLat === -90 && maxLat === 90 && minLng === -180 && maxLng === 180);
    for (const f of feats) {
        const mag = f.properties.mag ?? 0;
        if (!isNaN(minMag) && mag < minMag)
            continue;
        const lng = f.geometry.coordinates[0];
        const lat = f.geometry.coordinates[1];
        const depth = f.geometry.coordinates[2];
        if (filterByPH) {
            if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng)
                continue;
        }
        const timeMs = f.properties.time;
        const datetime = formatUtc(new Date(timeMs));
        const latStr = (Math.round(lat * 100) / 100).toFixed(2);
        const lngStr = (Math.round(lng * 100) / 100).toFixed(2);
        return {
            datetime,
            latitude: latStr,
            longitude: lngStr,
            depth: String(Math.round(depth)),
            magnitude: (Math.round(mag * 10) / 10).toFixed(1),
            location: f.properties.place ?? `${latStr}, ${lngStr}`,
            link: f.properties.url,
            usgsId: f.id,
            timeMs,
            tsunami: f.properties.tsunami ?? 0,
            mmi: f.properties.mmi ?? null,
        };
    }
    return null;
}

async function sendUsgsWebhook(eq, env) {
    const webhook = env.DISCORD_WEBHOOK_URL;
    if (!webhook)
        throw new Error("DISCORD_WEBHOOK_URL not set");
    const lat = parseFloat(eq.latitude);
    const lng = parseFloat(eq.longitude);
    const hasCoords = !isNaN(lat) && !isNaN(lng);
    const { date, time } = formatUstFromMs(eq.timeMs);
    const tsunamiLabel = usgsTsunamiLabel(eq.tsunami);
    const epicenterImage = hasCoords
        ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=7&size=600,400&l=map&pt=${lng},${lat},pm2rdm`
        : `https://terraguard-ph.pages.dev/pwa-512x512.png`;
    const mag = parseFloat(eq.magnitude);
    const mention = mag >= 7 ? "@everyone " : "";
    const colorHex = severityColor(isNaN(mag) ? 5 : mag).replace("#", "");
    const embedColor = parseInt(colorHex.length === 3 ? colorHex.split("").map((c) => c + c).join("") : colorHex, 16) || 0x3b82f6;
    const content = `${mention}🚨 **EARTHQUAKE ALERT** 🚨

💥 **M${eq.magnitude}** earthquake detected near **${eq.location}**.

📅 **Date:** ${date}
⏰ **Time:** ${time}
📏 **Depth:** ${eq.depth} km
📍 **Epicenter:** ${eq.location}
🌐 **Coordinates:** ${eq.latitude}°N, ${eq.longitude}°E

🌊 **Tsunami Threat:** ${tsunamiLabel}

📡 **Source:** USGS

❓ **Did you feel it?** React ✅ for Yes, ❎ for No`;
    const payload = {
        content,
        allowed_mentions: { parse: ["everyone"] },
        embeds: [
            {
                title: `🌍 M${eq.magnitude} — ${eq.location}`,
                description: `[View on TerraGuard](https://terraguard-ph.pages.dev/details/${earthquakeToEqId(eq)}) • [Open USGS](${eq.link})`,
                color: embedColor,
                image: { url: epicenterImage },
                footer: { text: `TerraGuard • ${date} ${time} • USGS` },
                timestamp: new Date(eq.timeMs).toISOString(),
            },
        ],
    };
    const waitUrl = webhook.includes("?") ? `${webhook}&wait=true` : `${webhook}?wait=true`;
    const res = await fetch(waitUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Discord webhook ${res.status}: ${t.slice(0, 500)}`);
    }
    try {
        const msg = await res.json();
        if (msg?.id) {
            const emojis = ["%E2%9C%85", "%E2%9D%8E"];
            if (env.BOT_TOKEN && msg.channel_id) {
                for (const emoji of emojis) {
                    await putReaction(`https://discord.com/api/v10/channels/${msg.channel_id}/messages/${msg.id}/reactions/${emoji}/@me`, { Authorization: `Bot ${env.BOT_TOKEN}` }, "usgs");
                }
            }
            else {
                console.error("[reactions][usgs] no BOT_TOKEN, trying webhook-token fallback (usually rejected by Discord)");
                const m = /\/webhooks\/(\d+)\/([^/?]+)/.exec(webhook);
                if (m) {
                    const whId = m[1], whToken = m[2];
                    for (const emoji of emojis) {
                        await putReaction(`https://discord.com/api/webhooks/${whId}/${whToken}/messages/${msg.id}/reactions/${emoji}/@me`, {}, "usgs-fallback");
                    }
                }
            }
        }
    }
    catch (_) { /* reactions best-effort */ }
}

async function handleUsgs(env) {
    const kv = env.WEBHOOK_KV;
    const latest = await fetchLatestUsgsEarthquake(env);
    if (!latest)
        return "no USGS data (no quake >= threshold)";
    const dedupKey = `usgs:${latest.usgsId}`;
    const lastId = await kv.get("last_eq_id");
    const already = await kv.get(`sent:${dedupKey}`);
    if (already || lastId === dedupKey || lastId === earthquakeToEqId(latest))
        return `duplicate ${dedupKey}`;
    const lat = parseFloat(latest.latitude), lng = parseFloat(latest.longitude), mag = parseFloat(latest.magnitude);
    const renderMinMag = parseFloat(env.RENDER_MIN_MAG ?? "5.0");
    const wantsVideo = !isNaN(mag) && mag >= renderMinMag;
    const usgsFbOff = ["false", "0", "no", "off", "disabled"].includes(String(env.USGS_POST_FB ?? "true").trim().toLowerCase());
    // Helper: schedule video with intensity retry (auto-post only).
    // Checks instrumental first, then reported. If not ready, creates pending with 1/2/5/10m retries.
    const scheduleVideoWithRetry = async (isAuto) => {
        if (!wantsVideo || usgsFbOff || fbPassesFilters(latest, env)) return null;
        // For auto-post, wait for intensity. For manual (trigger), dispatch immediately with whatever is available.
        if (!isAuto) {
            await dispatchVideoRender(env, {
                source: "usgs", latitude: latest.latitude, longitude: latest.longitude,
                magnitude: latest.magnitude, depth: latest.depth, place: latest.location,
                datetime: latest.datetime, fbPostId: "",
                extra: { usgsEventId: latest.usgsId, threat: usgsTsunamiLabel(latest.tsunami), tsunamiThreat: usgsTsunamiLabel(latest.tsunami), intensity: mmiToRoman(latest.mmi), finalReport: true },
            });
            return "video dispatched (manual, immediate)";
        }
        const status = await fetchUsgsIntensityStatus(latest.usgsId);
        const hasIntensity = status.hasInstrumental;
        const intensityVal = status.intensity || "";
        if (hasIntensity) {
            await dispatchVideoRender(env, {
                source: "usgs", latitude: latest.latitude, longitude: latest.longitude,
                magnitude: latest.magnitude, depth: latest.depth, place: latest.location,
                datetime: latest.datetime, fbPostId: "",
                extra: { usgsEventId: latest.usgsId, threat: usgsTsunamiLabel(latest.tsunami), tsunamiThreat: usgsTsunamiLabel(latest.tsunami), intensity: intensityVal || mmiToRoman(latest.mmi), finalReport: true },
            });
            return `video dispatched (FINAL FLASH REPORT, instrumental)`;
        }
        // Not ready - schedule retries from first check
        const pending = {
            payload: { source: "usgs", latitude: latest.latitude, longitude: latest.longitude, magnitude: latest.magnitude, depth: latest.depth, place: latest.location, datetime: latest.datetime, threat: usgsTsunamiLabel(latest.tsunami) },
            usgsId: latest.usgsId,
            firstCheck: Date.now(),
            nextIndex: 0,
            lastCheck: Date.now(),
        };
        await setPendingVideo(kv, latest.usgsId, pending);
        const idxRaw = await kv.get("video:pending:index");
        let idx = [];
        try { idx = idxRaw ? JSON.parse(idxRaw) : []; } catch { idx = []; }
        if (!idx.includes(latest.usgsId)) { idx.push(latest.usgsId); await kv.put("video:pending:index", JSON.stringify(idx), { expirationTtl: 60 * 60 * 24 }); }
        return "video pending (intensity not ready, next retry in 1m)";
    };
    // FB final report helper (never throws by itself; caller wraps anyway).
    const tryFbFinal = async () => {
        try {
            return await postUsgsToFacebook(latest, env);
        }
        catch (e) {
            return `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
        }
    };
    const recordFb = async (fbStatus) => {
        console.log(`[fb][usgs] ${dedupKey}: ${fbStatus}`);
        if (!fbStatus.startsWith("posted"))
            return;
        await recordFbPosted(kv, { source: "usgs", id: latest.usgsId, timeMs: latest.timeMs, lat, lng, mag });
        // For FB final, video is also dispatched but via the same retry gate above.
        // Here we only record FB; video is handled separately via scheduleVideoWithRetry.
    };
    const match = findCrossMatch(await getSentIndex(kv), "usgs", latest.timeMs, lat, lng, mag);
    if (match) {
        await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, crossOf: `${match.source}:${match.id}`, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
        if (wantsVideo && !usgsFbOff && !fbPassesFilters(latest, env)) {
            const isAuto = env._isAuto === true;
            const videoMsg = await scheduleVideoWithRetry(isAuto);
            return `cross-duplicate ${dedupKey} (already announced by ${match.source}) | ${videoMsg ?? "video dispatched (USGS final closes on render)"}`;
        }
        if (!wantsVideo) {
            return `cross-duplicate ${dedupKey} (already announced by ${match.source}) | below render threshold (silent)`;
        }
        const fbStatus = await tryFbFinal();
        await recordFb(fbStatus);
        return `cross-duplicate ${dedupKey} (already announced by ${match.source}) | fb: ${fbStatus}`;
    }
    await sendUsgsWebhook(latest, env);
    if (wantsVideo && !usgsFbOff && !fbPassesFilters(latest, env)) {
        const isAuto = env._isAuto === true;
        const videoMsg = await scheduleVideoWithRetry(isAuto);
        // Image now + video when ready: the designed card posts immediately,
        // the rendered video closes the report later.
        const fbStatus = await tryFbFinal();
        await recordFb(fbStatus);
        await kv.put("last_eq_id", dedupKey);
        await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, videoFinal: true, fbStatus, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
        await kv.put(`sent:${earthquakeToEqId(latest)}`, dedupKey, { expirationTtl: 60 * 60 * 24 * 30 });
        await recordSent(kv, { source: "usgs", id: latest.usgsId, timeMs: latest.timeMs, lat, lng, mag });
        return `sent ${dedupKey} M${latest.magnitude} ${latest.location} | fb: ${fbStatus} | ${videoMsg ?? "video dispatched (USGS final closes on render)"}`;
    }
    if (!wantsVideo) {
        await kv.put("last_eq_id", dedupKey);
        await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, silent: true, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
        await kv.put(`sent:${earthquakeToEqId(latest)}`, dedupKey, { expirationTtl: 60 * 60 * 24 * 30 });
        await recordSent(kv, { source: "usgs", id: latest.usgsId, timeMs: latest.timeMs, lat, lng, mag });
        return `sent ${dedupKey} M${latest.magnitude} ${latest.location} | below render threshold (silent)`;
    }
    const fbStatus = await tryFbFinal();
    await recordFb(fbStatus);
    await kv.put("last_eq_id", dedupKey);
    await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, fbStatus, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
    await kv.put(`sent:${earthquakeToEqId(latest)}`, dedupKey, { expirationTtl: 60 * 60 * 24 * 30 });
    await recordSent(kv, { source: "usgs", id: latest.usgsId, timeMs: latest.timeMs, lat, lng, mag });
    return `sent ${dedupKey} M${latest.magnitude} ${latest.location} | fb: ${fbStatus}`;
}

// ===== USGS → Facebook: image now + video close =====
// At/above RENDER_MIN_MAG the designed card posts immediately and the
// rendered video closes the report later (dispatched here, posted by
// Actions). Below threshold USGS stays off Facebook entirely — Discord
// still fires. Same FB_MAG_MIN /
// FB_COUNTRY_FOCUS gates, no PH exception. postUsgsToFacebook /
// buildUsgsFbMessage remain as fallback + caption reference.

function buildUsgsFbMessage(eq) {
    const place = String(eq.location ?? "").trim() || `${eq.latitude}, ${eq.longitude}`;
    // Local country time when resolvable (labelled, e.g. "03:40 PM CST"),
    // otherwise UTC — never bare.
    const { date, time } = formatLocalDisplayMs(eq.timeMs, place);
    const terraLink = `https://terraguard-ph.pages.dev/details/${earthquakeToEqId(eq)}`;
    const mag = parseFloat(eq.magnitude);
    const prefix = isNaN(mag) ? "🌍 " : mag >= 7 ? "🟥 " : mag >= 6 ? "🟥 " : mag >= 5 ? "🟧 " : mag >= 4 ? "🟨 " : mag >= 3 ? "🟦 " : "🟩 ";
    return [
        `${prefix}USGS FINAL REPORT`,
        ``,
        `A magnitude ${eq.magnitude} earthquake was recorded near ${place} on ${date} at ${time}.`,
        ``,
        `EARTHQUAKE INFORMATION`,
        ``,
        `Magnitude: ${eq.magnitude}`,
        `Location: ${place}`,
        `Date & Time: ${date} - ${time}`,
        ...(eq.aftershock
            ? [`🔁 Aftershock of the M${eq.aftershock.mainMag} ${eq.aftershock.mainPlace} quake (#${eq.aftershock.seqNo} in sequence)`]
            : []),
        `Depth: ${eq.depth} km`,
        `Coordinates: ${eq.latitude}°N, ${eq.longitude}°E`,
        ``,
        `Earthquake Details:`,
        `${terraLink}`,
        ``,
        `This is the final report issued by the United States Geological Survey (USGS).`,
        ``,
        `Source: USGS`,
        ``,
        `Join the Terra Guard Discord community for earthquake discussions:`,
        `https://discord.gg/tdGrvnvehP`,
        ``,
        `#Earthquake #USGS #TerraGuard #EarthquakeReport #SeismicActivity #Philippines #EarthquakePH #Lindol #TerraGuardPH`,
    ].join("\n");
}

/**
 * Post a USGS final report to the Facebook Page. Returns a short status
 * string. NEVER throws. Called ONLY from handleUsgs().
 */
async function postUsgsToFacebook(eq, env) {
    const pageId = (env.FB_PAGE_ID ?? "").trim();
    const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
    const appSecret = (env.FB_APP_SECRET ?? "").trim();
    if (!pageId || !userToken)
        return "skipped (FB_PAGE_ID / FB_USER_ACCESS_TOKEN not set)";
    // Kill-switch: USGS_POST_FB=false (also 0/no/off) disables USGS FB
    // posts. Defaults to posting when unset or any other value.
    const postFlag = String(env.USGS_POST_FB ?? "true").trim().toLowerCase();
    if (["false", "0", "no", "off", "disabled"].includes(postFlag))
        return "skipped (USGS_POST_FB disabled)";
    // USGS-only magnitude gate: when USGS_MIN_MAG is set, post only quakes
    // at/above it (e.g. USGS_MIN_MAG="6.0"). Unset = no extra gate.
    const usgsMinMag = parseFloat(env.USGS_MIN_MAG ?? "");
    if (!isNaN(usgsMinMag) && parseFloat(eq.magnitude) < usgsMinMag)
        return `skipped (M${eq.magnitude} < USGS_MIN_MAG ${usgsMinMag})`;
    // Same FB gates as the other sources (no PH exception for finals).
    const filterSkip = fbPassesFilters(eq, env);
    if (filterSkip)
        return filterSkip;
    // Aftershock sequence (shared cross-source tracker -> card banner too).
    await trackAftershock(env.WEBHOOK_KV, env, eq, eq.usgsId ?? "usgs");
    let pageToken = await getFacebookPageToken(env);
    if (!pageToken)
        pageToken = userToken; // stored token may already be a Page token
    const proof = await fbAppSecretProof(pageToken, appSecret);
    const message = buildUsgsFbMessage(eq);
    const lat = parseFloat(eq.latitude), lng = parseFloat(eq.longitude);
    const hasCoords = !isNaN(lat) && !isNaN(lng);
    // Designed card (same x10 renderer) first, raw Yandex satellite backup.
    // Card shows the same local country time as the post.
    const { date: fbDate, time: fbTime } = formatLocalDisplayMs(eq.timeMs, eq.location);
    const cardParams = hasCoords
        ? new URLSearchParams({
            lat: eq.latitude, lng: eq.longitude, mag: eq.magnitude,
            place: String(eq.location ?? "").slice(0, 90),
            date: fbDate, time: fbTime,
            depth: eq.depth, source: "USGS",
            ...(eq.aftershock ? { aftershock: String(eq.aftershock.seqNo) } : {}),
        }).toString()
        : "";
    const cardUrls = quakeCardCandidates(hasCoords ? cardParams : "");
    const magNum = parseFloat(eq.magnitude);
    const satZoom = isNaN(magNum) ? 7 : magNum >= 7 ? 6 : magNum >= 6 ? 7 : 8;
    const yandexUrl = hasCoords
        ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=${satZoom}&size=600,400&l=sat,skl&pt=${lng},${lat},pm2rdm`
        : null;
    const photoUrls = [...cardUrls, yandexUrl].filter(Boolean);
    const withProof = (params) => {
        if (proof)
            params.appsecret_proof = proof;
        return params;
    };
    for (const photoUrl of photoUrls) {
        if (String(photoUrl).includes("/api/quake-card")) {
            const ok = await warmCardUrl(photoUrl, "usgs");
            if (!ok) console.error("[fb][usgs] card warmup failed, still trying photo post");
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
            const fbErr = data?.error?.message ?? `HTTP ${res.status}`;
            console.error(`[fb][usgs] photo post failed (${String(photoUrl).slice(0, 80)}): ${String(fbErr).slice(0, 300)}`);
        }
        catch (e) {
            console.error("[fb][usgs] photo post exception", e instanceof Error ? e.message : String(e));
        }
    }
    // Fallback: plain feed post with link.
    try {
        const terraLink = `https://terraguard-ph.pages.dev/details/${earthquakeToEqId(eq)}`;
        const body = withProof({ access_token: pageToken, message, link: terraLink });
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

// ===== EMSC =====
function emscEqId(datetime, lat, lng) {
    return btoa(`${datetime}-${lat}-${lng}`).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function fetchLatestEmsc(env) {
    const minMag = parseFloat(env.EMSC_MIN_MAG || "1.0");
    const minLat = parseFloat(env.EMSC_MIN_LAT || "-90");
    const maxLat = parseFloat(env.EMSC_MAX_LAT || "90");
    const minLng = parseFloat(env.EMSC_MIN_LNG || "-180");
    const maxLng = parseFloat(env.EMSC_MAX_LNG || "180");
    const params = new URLSearchParams({ format: "json", limit: "20", orderby: "time" });
    if (!isNaN(minMag))
        params.set("minmag", String(minMag));
    const isGlobal = minLat === -90 && maxLat === 90 && minLng === -180 && maxLng === 180;
    if (!isGlobal) {
        if (!isNaN(minLat))
            params.set("minlatitude", String(minLat));
        if (!isNaN(maxLat))
            params.set("maxlatitude", String(maxLat));
        if (!isNaN(minLng))
            params.set("minlongitude", String(minLng));
        if (!isNaN(maxLng))
            params.set("maxlongitude", String(maxLng));
    }
    const url = `https://www.seismicportal.eu/fdsnws/event/1/query?${params}`;
    const r = await fetch(url, { headers: { "User-Agent": "TerraGuard-EMSC/1.0" } });
    if (r.status === 204)
        return null;
    if (!r.ok)
        throw new Error(`EMSC ${r.status}`);
    const j = await r.json();
    const feats = j.features || [];
    if (feats.length === 0)
        return null;
    feats.sort((a, b) => new Date(b.properties.time).getTime() - new Date(a.properties.time).getTime());
    const f = feats[0];
    const p = f.properties;
    const lat = p.lat, lon = p.lon, depth = p.depth, mag = p.mag;
    const datetime = formatUtc(new Date(p.time));
    const latStr = (Math.round(lat * 100) / 100).toFixed(2);
    const lonStr = (Math.round(lon * 100) / 100).toFixed(2);
    return {
        datetime, latitude: latStr, longitude: lonStr, depth: String(Math.round(depth)),
        magnitude: (Math.round(mag * 10) / 10).toFixed(1),
        location: p.flynn_region, link: `https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${p.source_id}`,
        unid: f.id, source_id: p.source_id, auth: p.auth, magtype: p.magtype, timeMs: new Date(p.time).getTime(),
    };
}

async function sendEmscWebhook(eq, env) {
    const wh = env.EMSC_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL;
    if (!wh)
        throw new Error("EMSC_WEBHOOK_URL not set");
    const lat = parseFloat(eq.latitude), lng = parseFloat(eq.longitude);
    const hasCoords = !isNaN(lat) && !isNaN(lng);
    const { date, time } = formatUstFromMs(eq.timeMs);
    const epicenterImage = hasCoords ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=7&size=600,400&l=map&pt=${lng},${lat},pm2rdm` : `https://terraguard-ph.pages.dev/pwa-512x512.png`;
    const mag = parseFloat(eq.magnitude);
    const hex = severityColor(isNaN(mag) ? 5 : mag).replace("#", "");
    const embedColor = parseInt(hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex, 16) || 0x3b82f6;
    const mention = parseFloat(eq.magnitude) >= 7 ? "@everyone " : "";
    const content = `${mention}🌐 **EMSC EARTHQUAKE ALERT** 🌐

💥 **M${eq.magnitude} (${eq.magtype})** earthquake near **${eq.location}**.

📅 **Date:** ${date}
⏰ **Time:** ${time}
📏 **Depth:** ${eq.depth} km
📍 **Epicenter:** ${eq.location}
🌐 **Coordinates:** ${eq.latitude}°N, ${eq.longitude}°E
🏛️ **Authority:** ${eq.auth}

📡 **Source:** EMSC-CSEM (${eq.unid})
${eq.aftershock ? `\n🔁 **Aftershock** of M${eq.aftershock.mainMag} ${eq.aftershock.mainPlace} (#${eq.aftershock.seqNo} in sequence)\n` : ``}
❓ **Did you feel it?** React ✅ for Yes, ❎ for No`;
    const payload = {
        content,
        allowed_mentions: { parse: ["everyone"] },
        embeds: [{
                title: `🌐 M${eq.magnitude} — ${eq.location}`,
                description: `[View on EMSC](https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${eq.source_id}) • [View on TerraGuard](https://terraguard-ph.pages.dev/details/${emscEqId(eq.datetime, eq.latitude, eq.longitude)})`,
                color: embedColor,
                image: { url: epicenterImage },
                footer: { text: `TerraGuard • EMSC-CSEM • ${date} ${time}` },
                timestamp: new Date(eq.timeMs).toISOString(),
            }],
    };
    const waitUrl = wh.includes("?") ? `${wh}&wait=true` : `${wh}?wait=true`;
    const res = await fetch(waitUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`EMSC webhook ${res.status}: ${t.slice(0, 500)}`);
    }
    try {
        const msg = await res.json();
        if (msg?.id) {
            const emojis = ["%E2%9C%85", "%E2%9D%8E"];
            if (env.BOT_TOKEN && msg.channel_id) {
                for (const e of emojis) {
                    await putReaction(`https://discord.com/api/v10/channels/${msg.channel_id}/messages/${msg.id}/reactions/${e}/@me`, { Authorization: `Bot ${env.BOT_TOKEN}` }, "emsc");
                }
            }
            else {
                console.error("[reactions][emsc] no BOT_TOKEN, trying webhook-token fallback (usually rejected by Discord)");
                const m = /\/webhooks\/(\d+)\/([^/?]+)/.exec(wh);
                if (m) {
                    const whId = m[1], whToken = m[2];
                    for (const e of emojis) {
                        await putReaction(`https://discord.com/api/webhooks/${whId}/${whToken}/messages/${msg.id}/reactions/${e}/@me`, {}, "emsc-fallback");
                    }
                }
            }
        }
        if (env.FELT_REPORTS_WEBHOOK_URL) {
            const poll = {
                question: { text: `Did you feel M${eq.magnitude} near ${eq.location.slice(0, 80)}?` },
                answers: [{ poll_media: { text: "Yes ✅" } }, { poll_media: { text: "No ❎" } }],
                duration: 24, allow_multiselect: false, layout_type: 1,
            };
            const pollWait = env.FELT_REPORTS_WEBHOOK_URL.includes("?") ? `${env.FELT_REPORTS_WEBHOOK_URL}&wait=true` : `${env.FELT_REPORTS_WEBHOOK_URL}?wait=true`;
            const pollRes = await fetch(pollWait, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `📝 **Felt Report Poll** for M${eq.magnitude} — ${eq.location}`, poll }) }).catch(() => null);
            try {
                if (pollRes && pollRes.ok) {
                    const pollMsg = await pollRes.json();
                    if (pollMsg?.id && pollMsg?.channel_id && env.BOT_TOKEN) {
                        const threadName = `💬 Experiences — M${eq.magnitude} ${eq.location.slice(0, 60)}`;
                        const threadRes = await fetch(`https://discord.com/api/v10/channels/${pollMsg.channel_id}/messages/${pollMsg.id}/threads`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json", Authorization: `Bot ${env.BOT_TOKEN}` },
                            body: JSON.stringify({ name: threadName, auto_archive_duration: 1440 }),
                        });
                        if (threadRes.ok) {
                            const thread = await threadRes.json();
                            if (thread?.id) {
                                await fetch(`https://discord.com/api/v10/channels/${thread.id}/messages`, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json", Authorization: `Bot ${env.BOT_TOKEN}` },
                                    body: JSON.stringify({ content: `Share your experience for **M${eq.magnitude} near ${eq.location}** — where were you, what did you feel? (photos/videos welcome)` }),
                                }).catch(() => { });
                            }
                        }
                    }
                }
            }
            catch { /* thread best-effort */ }
        }
    }
    catch { /* reactions/polls best-effort */ }
}

// Same-source EMSC revision window (tighter than cross-source so real
// aftershock sequences still post): ±120s, 50km, ΔM≤0.4.
const EMSC_REV_WINDOW_MS = 120 * 1000;
const EMSC_REV_MAX_KM = 50;
const EMSC_REV_MAX_MAG_DIFF = 0.4;

function findEmscRevision(index, timeMs, lat, lng, mag) {
    for (const e of index) {
        if (e.source !== "emsc")
            continue;
        if (Math.abs(e.timeMs - timeMs) > EMSC_REV_WINDOW_MS)
            continue;
        if (Math.abs(e.mag - mag) > EMSC_REV_MAX_MAG_DIFF)
            continue;
        if (haversineKm(e.lat, e.lng, lat, lng) > EMSC_REV_MAX_KM)
            continue;
        return e;
    }
    return null;
}

// ===== EMSC aftershock sequences (per-country KV window) =====
// Every posted EMSC quake is logged under seq:{ISO3} (7d TTL, cap 20). A new
// event is an aftershock when the same country already has >=
// AFTERSHOCK_MIN_COUNT (default 3) prior events inside AFTERSHOCK_WINDOW_H
// (default 168h), it is smaller than the window's largest (the mainshock),
// and it falls within a mainshock-scaled radius (or AFTERSHOCK_RADIUS_KM).
const SEQ_TTL_SECONDS = 7 * 24 * 3600;

async function getCountrySeq(kv, iso) {
    try {
        const raw = await kv.get(`seq:${iso}`);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((e) => e && typeof e.timeMs === "number") : [];
    } catch {
        return [];
    }
}

async function pushCountrySeq(kv, iso, entry) {
    const seq = await getCountrySeq(kv, iso);
    // Same physical quake announced by another source: don't double-count.
    for (const e of seq) {
        if (Math.abs((e.timeMs ?? 0) - entry.timeMs) <= 120 * 1000 &&
            haversineKm(e.lat, e.lng, entry.lat, entry.lng) <= 50) {
            return seq;
        }
    }
    seq.unshift(entry);
    await kv.put(`seq:${iso}`, JSON.stringify(seq.slice(0, 20)), { expirationTtl: SEQ_TTL_SECONDS });
    return seq;
}

// Shared tracker for all sources: detect an aftershock against the country's
// sequence, log this event, and attach eq.aftershock when flagged.
// Returns the shock (or null). Never throws.
async function trackAftershock(kv, env, eq, id) {
    try {
        if (!kv) return null;
        const lat = parseFloat(eq.latitude), lng = parseFloat(eq.longitude), mag = parseFloat(eq.magnitude);
        const timeMs = typeof eq.timeMs === "number" ? eq.timeMs : NaN;
        if (isNaN(lat) || isNaN(lng) || isNaN(mag) || isNaN(timeMs)) return null;
        const iso = locationToIso3(eq.location);
        if (!iso) return null;
        const seq = await getCountrySeq(kv, iso);
        const shock = detectAftershock(seq, timeMs, lat, lng, mag, env);
        await pushCountrySeq(kv, iso, { timeMs, lat, lng, mag, id, place: eq.location });
        if (shock) {
            eq.aftershock = shock;
            console.log(`[aftershock][${iso}] #${shock.seqNo} of M${shock.mainMag} ${shock.mainPlace} (${shock.distKm}km)`);
        }
        return shock;
    } catch (e) {
        console.error("[aftershock] tracker failed", e instanceof Error ? e.message : String(e));
        return null;
    }
}

function detectAftershock(seq, timeMs, lat, lng, mag, env) {
    const windowH = parseFloat(env.AFTERSHOCK_WINDOW_H ?? "168");
    const minCount = parseInt(env.AFTERSHOCK_MIN_COUNT ?? "3", 10);
    const windowMs = (isNaN(windowH) ? 168 : windowH) * 3600 * 1000;
    const need = isNaN(minCount) ? 3 : minCount;
    const recent = seq.filter((e) => e.timeMs >= timeMs - windowMs && e.timeMs < timeMs);
    if (recent.length < need) return null;
    let main = null;
    for (const e of recent) {
        if (!main || e.mag > main.mag) main = e;
    }
    if (!main || !(mag < main.mag)) return null;
    const fixedRadius = parseFloat(env.AFTERSHOCK_RADIUS_KM ?? "");
    const radius = !isNaN(fixedRadius) ? fixedRadius : (main.mag >= 7 ? 200 : main.mag >= 6 ? 120 : 75);
    const dist = haversineKm(lat, lng, main.lat, main.lng);
    if (dist > radius) return null;
    return { mainMag: main.mag, mainPlace: main.place, mainId: main.id, seqNo: recent.length + 1, distKm: Math.round(dist) };
}

async function handleEmsc(env) {
    const kv = env.WEBHOOK_KV;
    const latest = await fetchLatestEmsc(env);
    if (!latest)
        return "no EMSC data (no quake >= threshold)";
    const dedupKey = `emsc:${latest.unid}`;
    const last = await kv.get("last_emsc_id");
    const already = await kv.get(`sent:${dedupKey}`);
    if (already || last === dedupKey)
        return `duplicate ${dedupKey}`;
    const lat = parseFloat(latest.latitude), lng = parseFloat(latest.longitude), mag = parseFloat(latest.magnitude);
    const sentIndex = await getSentIndex(kv);
    const match = findCrossMatch(sentIndex, "emsc", latest.timeMs, lat, lng, mag);
    if (match) {
        await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, crossOf: `${match.source}:${match.id}`, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
        return `cross-duplicate ${dedupKey} (already announced by ${match.source})`;
    }
    // Same-source revision guard: EMSC re-detections arrive under a NEW unid
    // for the same physical quake. Tighter than cross-source matching so
    // real aftershock sequences still post.
    const rev = findEmscRevision(sentIndex, latest.timeMs, lat, lng, mag);
    if (rev) {
        await kv.put("last_emsc_id", dedupKey);
        await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, revisionOf: `emsc:${rev.id}`, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
        return `emsc-revision ${dedupKey} (already sent as emsc:${rev.id})`;
    }
    // Aftershock check: log this event into its country's sequence, and flag
    // it when it trails a larger mainshock in the same window.
    await trackAftershock(kv, env, latest, latest.unid);
    await sendEmscWebhook(latest, env);
    // Facebook auto-post — EMSC ONLY. Best-effort: never blocks or throws.
    let fbStatus = "skipped";
    try {
        fbStatus = await postEmscToFacebook(latest, env);
    }
    catch (e) {
        fbStatus = `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
    console.log(`[fb][emsc] ${dedupKey}: ${fbStatus}`);
    await kv.put("last_emsc_id", dedupKey);
    await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, fbStatus, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
    if (fbStatus.startsWith("posted"))
        await recordFbPosted(kv, { source: "emsc", id: latest.unid, timeMs: latest.timeMs, lat, lng, mag });
    await recordSent(kv, { source: "emsc", id: latest.unid, timeMs: latest.timeMs, lat, lng, mag });
    return `sent ${dedupKey} M${latest.magnitude} ${latest.location} | fb: ${fbStatus}`;
}

// ===== Facebook auto-post (EMSC + PHIVOLCS + USGS — see per-source rules) =====
// Env (Cloudflare secrets, already set):
//   FB_APP_ID, FB_APP_SECRET, FB_PAGE_ID, FB_USER_ACCESS_TOKEN
//   FB_MAG_MIN (e.g. "1.0"), FB_COUNTRY_FOCUS (e.g. "PHILIPPINES")
// Flow: filter by FB_MAG_MIN + FB_COUNTRY_FOCUS -> skip PH events
// (PHIVOLCS owns them) -> FB_USER_ACCESS_TOKEN (long-lived user token)
// -> me/accounts -> page access_token for FB_PAGE_ID
// -> POST /{page-id}/photos (fallback /feed).
// All failures are swallowed by the caller so Discord is never blocked.

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

async function getFacebookPageToken(env) {
    const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
    const pageId = (env.FB_PAGE_ID ?? "").trim();
    if (!userToken || !pageId)
        return null;
    // If the stored token is already a Page token, me/accounts will fail —
    // caller falls back to using the stored token directly.
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
        const pages = data?.data ?? [];
        const match = pages.find((p) => String(p.id) === String(pageId));
        if (match?.access_token)
            return String(match.access_token);
        return null;
    }
    catch {
        return null;
    }
}

function fbTagWord(s) {
    const words = String(s ?? "").replace(/\(.*?\)/g, " ").replace(/[^A-Za-z ]/g, " ").split(" ").map((w) => w.trim()).filter(Boolean).slice(0, 3);
    if (words.length === 0)
        return "";
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
}

function fbHashtags(location, source = "EMSC") {
    const base = ["#Earthquake", `#${source}`, "#TerraGuard", "#EarthquakeReport", "#SeismicActivity", "#StaySafe"];
    const loc = String(location ?? "");
    const parts = loc.split(",");
    let countryRaw;
    if (parts.length > 1) {
        countryRaw = parts[parts.length - 1].replace(/\(.*?\)/g, " ").trim();
    }
    else {
        // No comma: only trust short names like "TAIWAN" as country,
        // not full addresses like "Balut Island (Municipality Of ...)".
        const short = loc.replace(/\(.*?\)/g, " ").trim();
        if (short.length > 30 || short.split(/\s+/).filter(Boolean).length > 3)
            return [...base, "#BreakingNews", "#NaturalDisaster", "#DisasterPreparedness", "#BeSafe"].join(" ");
        countryRaw = short;
    }
    const countryTag = fbTagWord(countryRaw);
    if (!countryTag)
        return [...base, "#BreakingNews", "#NaturalDisaster", "#DisasterPreparedness", "#BeSafe"].join(" ");
    if (countryTag.toUpperCase() === "PHILIPPINES")
        return [...base, "#Philippines", "#EarthquakePH", "#Lindol", "#TerraGuardPH"].join(" ");
    return [...base, `#${countryTag}`, `#Earthquake${countryTag}`, "#BreakingNews", "#NaturalDisaster"].join(" ");
}

function buildFacebookMessage(eq) {
    const place = String(eq.location ?? "").trim() || `${eq.latitude}, ${eq.longitude}`;
    // Local country time when resolvable (labelled), otherwise UTC — never bare.
    const { date, time } = formatLocalDisplayMs(eq.timeMs, place);
    const terraLink = `https://terraguard-ph.pages.dev/details/${emscEqId(eq.datetime, eq.latitude, eq.longitude)}`;
    const mag = parseFloat(eq.magnitude);
    const magPrefix = isNaN(mag) ? "" : mag >= 7 ? "‼️MAJOR‼️ " : mag >= 6 ? "🟥 " : mag >= 5 ? "🟧 " : mag >= 4 ? "🟨 " : mag >= 3 ? "🟦 " : "🟩 ";
    return [
        `${magPrefix}JUST IN: A Magnitude: ${eq.magnitude} struck near ${place} on ${date} - ${time}`,
        ``,
        `Magnitude: ${eq.magnitude}`,
        `Location: ${place}`,
        `Date & Time: ${date} - ${time}`,
        `Depth: ${eq.depth} km`,
        `Coordinates: ${eq.latitude}°N, ${eq.longitude}°E`,
        ``,
        `Earthquake Info: ${terraLink}`,
        ...(eq.aftershock
            ? [`🔁 Aftershock of the M${eq.aftershock.mainMag} ${eq.aftershock.mainPlace} quake (#${eq.aftershock.seqNo} in sequence)`]
            : [`Please take note that this is not the final report. pleminary information`]),
        ``,
        `Source: EMSC-CSEM (${eq.unid})`,
        ``,
        `Join our discord for discussions: https://discord.gg/tdGrvnvehP`,
        ``,
        fbHashtags(eq.location),
    ].join("\n");
}

/**
 * Post an EMSC quake to the Facebook Page. Returns a short status string.
 * NEVER throws — returns "skipped ..." or "error ..." instead.
 * Called ONLY from handleEmsc().
 */
async function postEmscToFacebook(eq, env) {
    const pageId = (env.FB_PAGE_ID ?? "").trim();
    const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
    const appSecret = (env.FB_APP_SECRET ?? "").trim();
    if (!pageId || !userToken)
        return "skipped (FB_PAGE_ID / FB_USER_ACCESS_TOKEN not set)";
    // FB filters (env): FB_MAG_MIN + FB_COUNTRY_FOCUS. Discord is unaffected.
    const filterSkip = fbPassesFilters(eq, env);
    if (filterSkip)
        return filterSkip;
    // PH exception: PHIVOLCS owns Philippines FB posts now — EMSC stays
    // silent on FB for PH events (Discord posting is unaffected).
    if (String(eq.location ?? "").toUpperCase().includes("PHILIPP"))
        return "skipped (PH event: PHIVOLCS posts it)";
    let pageToken = await getFacebookPageToken(env);
    if (!pageToken)
        pageToken = userToken; // stored token may already be a Page token
    const proof = await fbAppSecretProof(pageToken, appSecret);
    const message = buildFacebookMessage(eq);
    const lat = parseFloat(eq.latitude), lng = parseFloat(eq.longitude);
    const magNum = parseFloat(eq.magnitude);
    const hasCoords = !isNaN(lat) && !isNaN(lng);
    // 3:4 designed card (self-hosted PNG) first, raw Yandex satellite as
    // backup. FB tries each in order; /feed text post is the last resort.
    // Card shows the same local country time as the post.
    const { date: fbDate, time: fbTime } = formatLocalDisplayMs(eq.timeMs, eq.location);
    const cardParams = hasCoords
        ? new URLSearchParams({
            lat: eq.latitude, lng: eq.longitude, mag: eq.magnitude,
            place: String(eq.location ?? "").slice(0, 90),
            date: fbDate, time: fbTime,
            depth: eq.depth, source: "EMSC",
            ...(eq.aftershock ? { aftershock: String(eq.aftershock.seqNo) } : {}),
        }).toString()
        : "";
    const cardUrls = quakeCardCandidates(hasCoords ? cardParams : "");
    const satZoom = isNaN(magNum) ? 7 : magNum >= 7 ? 6 : magNum >= 6 ? 7 : 8;
    const yandexUrl = hasCoords
        ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=${satZoom}&size=600,400&l=sat,skl&pt=${lng},${lat},pm2rdm`
        : null;
    const photoUrls = [...cardUrls, yandexUrl].filter(Boolean);
    const withProof = (params) => {
        if (proof)
            params.appsecret_proof = proof;
        return params;
    };
    // Warm the designed card before handing its URL to Facebook: the first
    // hit compiles WASM + fetches tiles/fonts (slow cold start), and FB's
    // image scraper times out on slow responses — which used to silently
    // downgrade posts to the raw Yandex backup. Warming also primes the
    // CDN cache so FB's fetch is fast. Skip the card if it won't render.
    const isCard = (u) => String(u).includes("/api/quake-card");
    // 1) Preferred: photo post so the designed card shows inline.
    for (const photoUrl of photoUrls) {
        if (isCard(photoUrl)) {
            const ok = await warmCardUrl(photoUrl, "emsc");
            if (!ok) console.error("[fb][emsc] card warmup failed, still trying photo post");
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
            const fbErr = data?.error?.message ?? `HTTP ${res.status}`;
            console.error(`[fb][emsc] photo post failed (${String(photoUrl).slice(0, 80)}): ${String(fbErr).slice(0, 300)}`);
            // try next image, then fall through to /feed fallback
        }
        catch (e) {
            console.error("[fb][emsc] photo post exception", e instanceof Error ? e.message : String(e));
        }
    }
    // 2) Fallback: plain feed post with link.
    try {
        const terraLink = `https://terraguard-ph.pages.dev/details/${emscEqId(eq.datetime, eq.latitude, eq.longitude)}`;
        const body = withProof({ access_token: pageToken, message, link: terraLink });
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

// ===== PHIVOLCS → Facebook ONLY (never Discord) =====
// Source: the existing PHP API (same feed the app uses). PHIVOLCS wall
// times are PHT (UTC+8); converted to UTC ms for matching/display.
// FB dedup is separate from Discord dedup: a quake USGS announced to
// Discord (never FB-posted) still gets its FB post here, while anything
// EMSC already FB-posted is skipped via the shared fb:posted-index
// (which also swallows PHIVOLCS revisions of posted events).

const PHIVOLCS_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// "14 September 2026 - 05:22 PM" (PHT, seconds optional) -> UTC ms.
function parsePhivolcsTimeMs(s) {
    const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*-\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(String(s ?? "").trim());
    if (!m)
        return NaN;
    const monthIdx = PHIVOLCS_MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (monthIdx === -1)
        return NaN;
    let hour = parseInt(m[4], 10);
    const ap = (m[7] || "").toUpperCase();
    if (ap === "PM" && hour < 12)
        hour += 12;
    if (ap === "AM" && hour === 12)
        hour = 0;
    const asUtc = Date.UTC(parseInt(m[3], 10), monthIdx, parseInt(m[1], 10), hour, parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0);
    return asUtc - 8 * 3600 * 1000; // PHT -> UTC
}

function phivolcsEqId(datetime, lat, lng) {
    return btoa(`${datetime}-${lat}-${lng}`).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
// PHIVOLCS bulletin number from the bulletin filename:
// ".../2026_0701_0004_B1.html" -> "1", "..._B2F.html" -> "2" (Final).
// "" when the link carries no bulletin marker.
function phivolcsInfoNo(link) {
    const m = /B(\d+)F?\.html?(?:[?#]|$)/i.exec(String(link ?? ""));
    return m ? String(parseInt(m[1], 10)) : "";
}

async function fetchLatestPhivolcs(env) {
    const urls = phivolcsApiCandidates(env);
    const minMag = parseFloat(env.PHIVOLCS_MIN_MAG ?? "3.0");
    let lastError = null;
    for (const apiUrl of urls) {
        try {
            const res = await fetch(apiUrl, { headers: { "User-Agent": "TerraGuard-Cron-PHIVOLCS/1.0" } });
            if (!res.ok) {
                lastError = new Error(`PHIVOLCS ${res.status} from ${apiUrl}`);
                console.error(`[phivolcs] ${res.status} from ${apiUrl}, trying backup…`);
                continue;
            }
            const j = await res.json();
            const rows = j.data ?? [];
            if (!Array.isArray(rows) || rows.length === 0)
                return null;
            let best = null;
            for (const r of rows) {
                const mag = parseFloat(r.magnitude);
                if (!isNaN(minMag) && (isNaN(mag) || mag < minMag))
                    continue;
                const timeMs = parsePhivolcsTimeMs(r.datetime);
                if (isNaN(timeMs))
                    continue;
                if (!best || timeMs > best.timeMs)
                    best = { row: r, mag, timeMs };
            }
            if (!best)
                return null;
            const { row: r, timeMs } = best;
            const lat = parseFloat(r.latitude), lng = parseFloat(r.longitude);
            const latStr = isNaN(lat) ? String(r.latitude ?? "") : (Math.round(lat * 100) / 100).toFixed(2);
            const lngStr = isNaN(lng) ? String(r.longitude ?? "") : (Math.round(lng * 100) / 100).toFixed(2);
            return {
                datetime: String(r.datetime).trim(),
                latitude: latStr,
                longitude: lngStr,
                depth: String(Math.round(parseFloat(r.depth) || 0)),
                magnitude: (Math.round(best.mag * 10) / 10).toFixed(1),
                location: String(r.location ?? `${latStr}, ${lngStr}`),
                link: r.link,
                infoNo: phivolcsInfoNo(r.link),
                timeMs,
            };
        } catch (e) {
            lastError = e;
            console.error(`[phivolcs] fetch failed for ${apiUrl}, trying backup…`, e instanceof Error ? e.message : String(e));
            continue;
        }
    }
    throw lastError ?? new Error("PHIVOLCS all hosts unreachable");
}

function buildPhivolcsFbMessage(eq) {
    const { date, time } = phivolcsDisplayParts(eq.datetime);
    const terraLink = `https://terraguard-ph.pages.dev/details/${phivolcsEqId(eq.datetime, eq.latitude, eq.longitude)}`;
    const place = String(eq.location ?? "").trim() || `${eq.latitude}, ${eq.longitude}`;
    const timeShort = String(time).trim();
    const mag = parseFloat(eq.magnitude);
    const magPrefix = isNaN(mag) ? "" : mag >= 7 ? "‼️MAJOR‼️ " : mag >= 6 ? "🟥 " : mag >= 5 ? "🟧 " : mag >= 4 ? "🟨 " : mag >= 3 ? "🟦 " : "🟩 ";
    return [
        `${magPrefix}JUST IN: ${date} - ${timeShort} | Magnitude: ${eq.magnitude} - ${place} | Earthquake Visual Report`,
        ``,
        ...(eq.infoNo ? [`Information No.: ${eq.infoNo}`] : []),
        `Magnitude: ${eq.magnitude}`,
        `Location: ${place}`,
        `Date & Time: ${date} - ${timeShort}`,
        `Depth: ${eq.depth} km`,
        `Coordinates: ${eq.latitude}°N, ${eq.longitude}°E`,
        ``,
        `Earthquake Info: ${terraLink}`,
        `A visual representation of the seismic event based on available earthquake data.`,
        ...(eq.aftershock
            ? [`🔁 Aftershock of the M${eq.aftershock.mainMag} ${eq.aftershock.mainPlace} quake (#${eq.aftershock.seqNo} in sequence)`]
            : []),
        `Please take note that this is not the final report. pleminary information`,
        ``,
        `Source: PHIVOLCS`,
        ...(eq.link ? [`Bulletin: ${eq.link}`] : []),
        ``,
        `Join our discord for discussions: https://discord.gg/tdGrvnvehP`,
        ``,
        fbHashtags(eq.location, "PHIVOLCS"),
    ].join("\n");
}

/**
 * Post a PHIVOLCS quake to the Facebook Page. Returns a short status string.
 * NEVER throws. Called ONLY from handlePhivolcsFb().
 */
async function postPhivolcsToFacebook(eq, env) {
    const pageId = (env.FB_PAGE_ID ?? "").trim();
    const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
    const appSecret = (env.FB_APP_SECRET ?? "").trim();
    if (!pageId || !userToken)
        return "skipped (FB_PAGE_ID / FB_USER_ACCESS_TOKEN not set)";
    // Same FB gates as EMSC.
    const filterSkip = fbPassesFilters(eq, env);
    if (filterSkip)
        return filterSkip;
    // Aftershock sequence (shared cross-source tracker -> card banner too).
    await trackAftershock(env.WEBHOOK_KV, env, eq, eq.link ?? eq.datetime ?? "phivolcs");
    let pageToken = await getFacebookPageToken(env);
    if (!pageToken)
        pageToken = userToken; // stored token may already be a Page token
    const proof = await fbAppSecretProof(pageToken, appSecret);
    const message = buildPhivolcsFbMessage(eq);
    const lat = parseFloat(eq.latitude), lng = parseFloat(eq.longitude);
    const hasCoords = !isNaN(lat) && !isNaN(lng);
    // Designed card (same x10 renderer) first, raw Yandex satellite backup.
    const { date: fbDate, time: fbTime } = phivolcsDisplayParts(eq.datetime);
    const cardParams = hasCoords
        ? new URLSearchParams({
            lat: eq.latitude, lng: eq.longitude, mag: eq.magnitude,
            place: String(eq.location ?? "").slice(0, 90),
            date: fbDate, time: fbTime,
            depth: eq.depth, source: "PHIVOLCS",
            ...(eq.infoNo ? { info: eq.infoNo } : {}),
            ...(eq.aftershock ? { aftershock: String(eq.aftershock.seqNo) } : {}),
        }).toString()
        : "";
    const cardUrls = quakeCardCandidates(hasCoords ? cardParams : "");
    const magNum = parseFloat(eq.magnitude);
    const satZoom = isNaN(magNum) ? 7 : magNum >= 7 ? 6 : magNum >= 6 ? 7 : 8;
    const yandexUrl = hasCoords
        ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=${satZoom}&size=600,400&l=sat,skl&pt=${lng},${lat},pm2rdm`
        : null;
    const photoUrls = [...cardUrls, yandexUrl].filter(Boolean);
    const withProof = (params) => {
        if (proof)
            params.appsecret_proof = proof;
        return params;
    };
    for (const photoUrl of photoUrls) {
        if (String(photoUrl).includes("/api/quake-card")) {
            const ok = await warmCardUrl(photoUrl, "phivolcs");
            if (!ok) console.error("[fb][phivolcs] card warmup failed, still trying photo post");
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
            const fbErr = data?.error?.message ?? `HTTP ${res.status}`;
            console.error(`[fb][phivolcs] photo post failed (${String(photoUrl).slice(0, 80)}): ${String(fbErr).slice(0, 300)}`);
        }
        catch (e) {
            console.error("[fb][phivolcs] photo post exception", e instanceof Error ? e.message : String(e));
        }
    }
    // Fallback: plain feed post with link.
    try {
        const terraLink = `https://terraguard-ph.pages.dev/details/${phivolcsEqId(eq.datetime, eq.latitude, eq.longitude)}`;
        const body = withProof({ access_token: pageToken, message, link: terraLink });
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

async function handlePhivolcsFb(env) {
    const kv = env.WEBHOOK_KV;
    const latest = await fetchLatestPhivolcs(env);
    if (!latest)
        return "no PHIVOLCS data (no quake >= threshold)";
    const dedupKey = `phivolcs:${phivolcsEqId(latest.datetime, latest.latitude, latest.longitude)}`;
    const last = await kv.get("last_phivolcs_id");
    const already = await kv.get(`sent:${dedupKey}`);
    if (already || last === dedupKey)
        return `duplicate ${dedupKey}`;
    const lat = parseFloat(latest.latitude), lng = parseFloat(latest.longitude), mag = parseFloat(latest.magnitude);
    // Skip anything already FB-posted by EMSC/PHIVOLCS (revisions included).
    // USGS finals are ignored here on purpose: the final report confirms,
    // it does not replace the visual report.
    const fbMatch = findFbPostMatch(await getFbPostedIndex(kv), latest.timeMs, lat, lng, mag);
    if (fbMatch && fbMatch.source !== "usgs") {
        await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, fbOf: `${fbMatch.source}:${fbMatch.id}`, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
        return `fb-duplicate ${dedupKey} (already posted by ${fbMatch.source})`;
    }
    let fbStatus = "skipped";
    try {
        fbStatus = await postPhivolcsToFacebook(latest, env);
    }
    catch (e) {
        fbStatus = `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
    console.log(`[fb][phivolcs] ${dedupKey}: ${fbStatus}`);
    await kv.put("last_phivolcs_id", dedupKey);
    await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, fbStatus, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
    if (fbStatus.startsWith("posted")) {
        await recordFbPosted(kv, { source: "phivolcs", id: dedupKey, timeMs: latest.timeMs, lat, lng, mag });
    }
    return `fb ${dedupKey} M${latest.magnitude} ${latest.location} | ${fbStatus}`;
}

// ===== unified entry: ONE worker, ONE cron set (*/2 * * * * — see wrangler) =====

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

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...CORS },
    });
}

// ===== Admin panel: KV inspection + manual posts (CRON_SECRET authed) =====
function htmlEsc(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function adminData(kv) {
    const out = { last: {}, seqs: [], sent: 0, fbPosted: 0 };
    try {
        for (const k of ["last_eq_id", "last_emsc_id", "last_phivolcs_id"]) {
            out.last[k] = (await kv.get(k)) || "—";
        }
        const sentIdx = await getSentIndex(kv);
        out.sent = Array.isArray(sentIdx) ? sentIdx.length : 0;
        const fbIdx = await getFbPostedIndex(kv);
        out.fbPosted = Array.isArray(fbIdx) ? fbIdx.length : 0;
        const listed = await kv.list({ prefix: "seq:" });
        const names = (listed?.keys ?? []).map((k) => k.name).slice(0, 30);
        for (const name of names) {
            const seq = await getCountrySeq(kv, name.slice(4));
            if (seq.length === 0) continue;
            const max = seq.reduce((a, b) => (b.mag > a.mag ? b : a), seq[0]);
            out.seqs.push({ iso: name.slice(4), count: seq.length, maxMag: max.mag, latest: new Date(seq[0].timeMs).toISOString() });
        }
        out.seqs.sort((a, b) => b.count - a.count);
    } catch (e) {
        out.error = e instanceof Error ? e.message : String(e);
    }
    return out;
}

function adminHtml(d, keyParam) {
    const rows = d.seqs.map((s) =>
        `<tr><td>${htmlEsc(s.iso)}</td><td>${s.count}</td><td>M${htmlEsc(String(s.maxMag))}</td><td>${htmlEsc(s.latest)}</td></tr>`
    ).join("") || `<tr><td colspan="4">no sequences yet</td></tr>`;
    const trig = (p, label) => `<a href="${p}?key=${htmlEsc(keyParam)}"><button>${label}</button></a>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TerraGuard Earthquake Admin</title><style>
body{font:14px/1.5 system-ui,sans-serif;background:#0b1220;color:#e6edf7;margin:0;padding:20px}
h1{font-size:18px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.8px;color:#93a4bf}
.card{background:#131c2e;border:1px solid #24314a;border-radius:10px;padding:14px;margin-bottom:14px}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #24314a;padding:6px 9px;text-align:left}
button{background:#1d4ed8;color:#fff;border:0;border-radius:7px;padding:8px 14px;margin:3px;cursor:pointer}
input,select{background:#0f1726;color:#e6edf7;border:1px solid #24314a;border-radius:7px;padding:7px 9px;margin:3px}
a{color:#93c5fd}</style></head><body>
<h1>🌍 TerraGuard Earthquake Admin</h1>
<div class="card"><h2>Status</h2>
<div>last_eq_id: ${htmlEsc(d.last.last_eq_id)}<br/>last_emsc_id: ${htmlEsc(d.last.last_emsc_id)}<br/>last_phivolcs_id: ${htmlEsc(d.last.last_phivolcs_id)}</div>
<div>sent index: ${d.sent} · fb posted: ${d.fbPosted}</div>${d.error ? `<div>KV error: ${htmlEsc(d.error)}</div>` : ``}</div>
<div class="card"><h2>Aftershock sequences (seq:*)</h2>
<table><tr><th>ISO</th><th>events</th><th>max</th><th>latest</th></tr>${rows}</table></div>
<div class="card"><h2>Triggers</h2>
${trig("/trigger-usgs", "USGS")} ${trig("/trigger-emsc", "EMSC")} ${trig("/trigger-phivolcs", "PHIVOLCS")} ${trig("/trigger", "All")}</div>
<div class="card"><h2>Manual Facebook post</h2>
<form method="POST" action="/admin/post?key=${htmlEsc(keyParam)}">
<select name="source"><option value="emsc">EMSC</option><option value="usgs">USGS</option><option value="phivolcs">PHIVOLCS</option></select><br/>
<input name="lat" placeholder="latitude" required/> <input name="lng" placeholder="longitude" required/><br/>
<input name="mag" placeholder="magnitude" required/> <input name="depth" placeholder="depth km" value="10"/><br/>
<input name="place" placeholder="place, COUNTRY" size="40" required/><br/>
<input name="datetime" placeholder="15 October 2026 - 03:40 PM (PHIVOLCS wall) or UTC instant" size="40"/><br/>
<button type="submit">Post to Facebook</button></form>
<p>Runs the same tracker + card pipeline as auto-posts (aftershock banner included). Marks the event sent so auto-posts won't duplicate it.</p></div>
</body></html>`;
}

// Build a synthetic event from admin form fields and run it through the
// normal poster (tracking + card + FB), then mark it sent/fb-posted so the
// automatic handlers treat it as already announced.
async function adminManualPost(env, params) {
    const kv = env.WEBHOOK_KV;
    const source = String(params.source ?? "emsc").trim().toLowerCase();
    const lat = parseFloat(params.lat), lng = parseFloat(params.lng), mag = parseFloat(params.mag);
    if (isNaN(lat) || isNaN(lng) || isNaN(mag)) return "error: lat/lng/mag required";
    const place = String(params.place ?? `${lat}, ${lng}`).trim().slice(0, 90);
    const depth = String(params.depth ?? "10").trim() || "10";
    const now = Date.now();
    if (source === "usgs") {
        const eq = { latitude: String(lat), longitude: String(lng), magnitude: String(mag), location: place, depth, timeMs: now, datetime: new Date(now).toISOString(), usgsId: `manual-${now}`, tsunami: 0, mmi: null };
        const st = await postUsgsToFacebook(eq, env);
        if (st.startsWith("posted")) {
            await recordFbPosted(kv, { source: "usgs", id: eq.usgsId, timeMs: now, lat, lng, mag });
            await recordSent(kv, { source: "usgs", id: eq.usgsId, timeMs: now, lat, lng, mag });
        }
        return `usgs manual: ${st}`;
    }
    if (source === "phivolcs") {
        const dt = String(params.datetime ?? "").trim() || phivolcsNowString();
        const eq = { datetime: dt, latitude: String(lat), longitude: String(lng), magnitude: String(mag), location: place, depth, link: "", infoNo: "" };
        eq.timeMs = parsePhivolcsTimeMs(dt);
        const st = await postPhivolcsToFacebook(eq, env);
        if (st.startsWith("posted")) {
            await recordFbPosted(kv, { source: "phivolcs", id: `manual-${now}`, timeMs: isNaN(eq.timeMs) ? now : eq.timeMs, lat, lng, mag });
        }
        return `phivolcs manual: ${st}`;
    }
    const eq = { latitude: String(lat), longitude: String(lng), magnitude: String(mag), location: place, depth, timeMs: now, datetime: new Date(now).toISOString(), unid: `manual-${now}`, magtype: "m", auth: "MANUAL", source_id: "" };
    await trackAftershock(kv, env, eq, eq.unid);
    const st = await postEmscToFacebook(eq, env);
    if (st.startsWith("posted")) {
        await recordFbPosted(kv, { source: "emsc", id: eq.unid, timeMs: now, lat, lng, mag });
        await recordSent(kv, { source: "emsc", id: eq.unid, timeMs: now, lat, lng, mag });
    }
    return `emsc manual: ${st}`;
}

// Current Manila wall time formatted like a PHIVOLCS bulletin datetime.
function phivolcsNowString() {
    try {
        const now = new Date();
        const md = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", day: "numeric", month: "long", year: "numeric" }).format(now);
        let t = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: true }).format(now);
        return `${md} - ${t}`;
    } catch {
        return "";
    }
}
    export { parsePhivolcsTimeMs, buildPhivolcsFbMessage, fetchLatestPhivolcs, fbPassesFilters, postEmscToFacebook, postPhivolcsToFacebook, buildFacebookMessage, formatUtcDisplayMs, formatLocalDisplayMs, locationToIso3, detectAftershock, getCountrySeq, pushCountrySeq, trackAftershock, phivolcsDisplayParts, phivolcsInfoNo, findEmscRevision, buildUsgsFbMessage, postUsgsToFacebook };

export default {
    async fetch(request, env) {
        env._isAuto = false;
        if (request.method === "OPTIONS")
            return new Response(null, { headers: CORS });
        const url = new URL(request.url);
        if (url.pathname === "/health")
            return new Response("ok USGS+EMSC+PHIVOLCSfb", { headers: CORS });
        const secrets = [env.CRON_SECRET];
        const authed = secretsOk(request, secrets);
        const runBoth = async () => {
            const out = [];
            try {
                out.push("usgs: " + await handleUsgs(env));
            }
            catch (e) {
                out.push("usgs: error " + (e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)));
            }
            try {
                out.push("emsc: " + await handleEmsc(env));
            }
            catch (e) {
                out.push("emsc: error " + (e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)));
            }
            try {
                out.push("phivolcs: " + await handlePhivolcsFb(env));
            }
            catch (e) {
                out.push("phivolcs: error " + (e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)));
            }
            return out.join(" | ");
        };
        if (authed && (url.pathname === "/trigger" || url.pathname === "/cron-webhook"))
            return json({ success: true, message: await runBoth() });
        if (authed && (url.pathname === "/trigger-usgs" || url.pathname === "/cron-usgs")) {
            try {
                return json({ success: true, source: "USGS", message: await handleUsgs(env) });
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }
        if (authed && (url.pathname === "/trigger-emsc" || url.pathname === "/cron-emsc")) {
            try {
                return json({ success: true, source: "EMSC", message: await handleEmsc(env) });
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }
        if (authed && (url.pathname === "/trigger-phivolcs" || url.pathname === "/cron-phivolcs")) {
            try {
                return json({ success: true, source: "PHIVOLCS", message: await handlePhivolcsFb(env) });
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }
        if (authed && url.pathname === "/admin" && request.method === "GET") {
            const d = await adminData(env.WEBHOOK_KV);
            const keyParam = url.searchParams.get("key") ?? "";
            return new Response(adminHtml(d, keyParam), { headers: { "Content-Type": "text/html", ...CORS } });
        }
        if (authed && url.pathname === "/admin/post" && request.method === "POST") {
            try {
                let params = {};
                const ct = request.headers.get("content-type") || "";
                if (ct.includes("application/json")) {
                    params = await request.json();
                } else {
                    const form = await request.formData();
                    for (const [k, v] of form.entries()) params[k] = String(v);
                }
                return json({ success: true, message: await adminManualPost(env, params) });
            }
            catch (e) {
                return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
            }
        }
        return new Response("Not Found", { status: 404, headers: CORS });
    },

    async scheduled(event, env, ctx) {
        // Mark as auto for video retry gate (manual trigger should dispatch immediately)
        env._isAuto = true;
        ctx.waitUntil((async () => {
            // Daily Earth Report — precise Cloudflare cron (00:05 UTC sharp, GitHub schedule can slip 30-90m)
            try {
                const now = new Date();
                if (now.getUTCHours() === 0 && now.getUTCMinutes() === 5) {
                    const repo = (env.GH_REPO ?? "nelljay-git/terraguard").trim();
                    const token = (env.GH_DISPATCH_TOKEN ?? "").trim();
                    if (token && repo.includes("/")) {
                        const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/daily-earth-report.yml/dispatches`, {
                            method: "POST",
                            headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "TerraGuard-Worker/1.0" },
                            body: JSON.stringify({ ref: "main" }),
                        });
                        if (r.status === 204) console.log("[cron][daily-report] dispatched 00:05 UTC");
                        else console.error(`[cron][daily-report] HTTP ${r.status}`);
                    }
                }
            } catch (e) { console.error("[cron][daily-report] failed", e instanceof Error ? e.message : String(e)); }
            try {
                console.log(`[cron][video-pending] ${await processPendingVideos(env)}`);
            } catch (e) {
                console.error("[cron][video-pending] failed", e);
            }
            try {
                console.log(`[cron][usgs] ${await handleUsgs(env)}`);
            }
            catch (e) {
                console.error("[cron][usgs] failed", e);
            }
            try {
                console.log(`[cron][emsc] ${await handleEmsc(env)}`);
            }
            catch (e) {
                console.error("[cron][emsc] failed", e);
            }
            try {
                console.log(`[cron][phivolcs] ${await handlePhivolcsFb(env)}`);
            }
            catch (e) {
                console.error("[cron][phivolcs] failed", e);
            }
        })());
    },
};
