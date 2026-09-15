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

// Warm a designed card URL before handing it to Facebook (cold WASM +
// tiles/fonts make FB's scraper time out). Returns true when renderable.
async function warmCardUrl(url, tag, timeoutMs = 6000) {
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), timeoutMs);
            const r = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { "User-Agent": "TerraGuard-FB-Warmup/1.0" } });
            clearTimeout(t);
            if (r.ok)
                return true;
            console.error(`[fb][${tag}] card warmup ${r.status} (attempt ${attempt}): ${url.slice(0, 120)}`);
        }
        catch (e) {
            console.error(`[fb][${tag}] card warmup failed (attempt ${attempt}): ${e instanceof Error ? e.message : String(e)}`);
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
}

// ===== USGS =====
function usgsTsunamiLabel(tsunami) {
    if (tsunami === 1)
        return "TSUNAMI ADVISORY";
    return "NONE";
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
    const match = findCrossMatch(await getSentIndex(kv), "usgs", latest.timeMs, lat, lng, mag);
    if (match) {
        await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, crossOf: `${match.source}:${match.id}`, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
        return `cross-duplicate ${dedupKey} (already announced by ${match.source})`;
    }
    await sendUsgsWebhook(latest, env);
    await kv.put("last_eq_id", dedupKey);
    await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
    await kv.put(`sent:${earthquakeToEqId(latest)}`, dedupKey, { expirationTtl: 60 * 60 * 24 * 30 });
    await recordSent(kv, { source: "usgs", id: latest.usgsId, timeMs: latest.timeMs, lat, lng, mag });
    return `sent ${dedupKey} M${latest.magnitude} ${latest.location}`;
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
    const match = findCrossMatch(await getSentIndex(kv), "emsc", latest.timeMs, lat, lng, mag);
    if (match) {
        await kv.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, crossOf: `${match.source}:${match.id}`, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
        return `cross-duplicate ${dedupKey} (already announced by ${match.source})`;
    }
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

// ===== Facebook auto-post (EMSC + PHIVOLCS — USGS never calls this) =====
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
    const { date, time } = formatUstFromMs(eq.timeMs);
    const terraLink = `https://terraguard-ph.pages.dev/details/${emscEqId(eq.datetime, eq.latitude, eq.longitude)}`;
    const place = String(eq.location ?? "").trim() || `${eq.latitude}, ${eq.longitude}`;
    const timeShort = String(time).replace(/\s*UST\s*$/i, "").trim();
    const mag = parseFloat(eq.magnitude);
    const magPrefix = isNaN(mag) ? "" : mag >= 7 ? "‼️MAJOR‼️ " : mag >= 6 ? "🟥 " : mag >= 5 ? "🟧 " : mag >= 4 ? "🟨 " : mag >= 3 ? "🟦 " : "🟩 ";
    return [
        `${magPrefix}JUST IN: ${date} - ${timeShort} | Magnitude: ${eq.magnitude} - ${place} | Earthquake Visual Report`,
        ``,
        `Magnitude: ${eq.magnitude}`,
        `Location: ${place}`,
        `Date & Time: ${date} - ${timeShort}`,
        `Depth: ${eq.depth} km`,
        `Coordinates: ${eq.latitude}°N, ${eq.longitude}°E`,
        ``,
        `Earthquake Info: ${terraLink}`,
        `Please take note that this is not the final report. pleminary information`,
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
    const { date: fbDate, time: fbTime } = formatUstFromMs(eq.timeMs);
    const cardParams = hasCoords
        ? new URLSearchParams({
            lat: eq.latitude, lng: eq.longitude, mag: eq.magnitude,
            place: String(eq.location ?? "").slice(0, 90),
            date: fbDate, time: String(fbTime).replace(/\s*UST\s*$/i, ""),
            depth: eq.depth, source: "EMSC",
        }).toString()
        : "";
    const cardUrl = hasCoords && cardParams
        ? `https://trikefare.x10.mx/terraguard/api/quake-card.php?${cardParams}`
        : null;
    const satZoom = isNaN(magNum) ? 7 : magNum >= 7 ? 6 : magNum >= 6 ? 7 : 8;
    const yandexUrl = hasCoords
        ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=${satZoom}&size=600,400&l=sat,skl&pt=${lng},${lat},pm2rdm`
        : null;
    const photoUrls = [cardUrl, yandexUrl].filter(Boolean);
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
        if (isCard(photoUrl) && !(await warmCardUrl(photoUrl, "emsc"))) {
            console.error("[fb][emsc] card not renderable, using Yandex backup");
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

async function fetchLatestPhivolcs(env) {
    const apiUrl = (env.PHIVOLCS_API_URL ?? "https://trikefare.x10.mx/terraguard/phivolcs.php").trim();
    const minMag = parseFloat(env.PHIVOLCS_MIN_MAG ?? "3.0");
    const res = await fetch(apiUrl, { headers: { "User-Agent": "TerraGuard-Cron-PHIVOLCS/1.0" } });
    if (!res.ok)
        throw new Error(`PHIVOLCS ${res.status}`);
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
        timeMs,
    };
}

function buildPhivolcsFbMessage(eq) {
    const { date, time } = formatUstFromMs(eq.timeMs);
    const terraLink = `https://terraguard-ph.pages.dev/details/${phivolcsEqId(eq.datetime, eq.latitude, eq.longitude)}`;
    const place = String(eq.location ?? "").trim() || `${eq.latitude}, ${eq.longitude}`;
    const timeShort = String(time).replace(/\s*UST\s*$/i, "").trim();
    const mag = parseFloat(eq.magnitude);
    const magPrefix = isNaN(mag) ? "" : mag >= 7 ? "‼️MAJOR‼️ " : mag >= 6 ? "🟥 " : mag >= 5 ? "🟧 " : mag >= 4 ? "🟨 " : "🟩 ";
    return [
        `${magPrefix}JUST IN: ${date} - ${timeShort} | Magnitude: ${eq.magnitude} - ${place} | Earthquake Visual Report`,
        ``,
        `Magnitude: ${eq.magnitude}`,
        `Location: ${place}`,
        `Date & Time: ${date} - ${timeShort}`,
        `Depth: ${eq.depth} km`,
        `Coordinates: ${eq.latitude}°N, ${eq.longitude}°E`,
        ``,
        `Earthquake Info: ${terraLink}`,
        `A visual representation of the seismic event based on available earthquake data.`,
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
    let pageToken = await getFacebookPageToken(env);
    if (!pageToken)
        pageToken = userToken; // stored token may already be a Page token
    const proof = await fbAppSecretProof(pageToken, appSecret);
    const message = buildPhivolcsFbMessage(eq);
    const lat = parseFloat(eq.latitude), lng = parseFloat(eq.longitude);
    const hasCoords = !isNaN(lat) && !isNaN(lng);
    // Designed card (same x10 renderer) first, raw Yandex satellite backup.
    const { date: fbDate, time: fbTime } = formatUstFromMs(eq.timeMs);
    const cardParams = hasCoords
        ? new URLSearchParams({
            lat: eq.latitude, lng: eq.longitude, mag: eq.magnitude,
            place: String(eq.location ?? "").slice(0, 90),
            date: fbDate, time: String(fbTime).replace(/\s*UST\s*$/i, ""),
            depth: eq.depth, source: "PHIVOLCS",
        }).toString()
        : "";
    const cardUrl = hasCoords && cardParams
        ? `https://trikefare.x10.mx/terraguard/api/quake-card.php?${cardParams}`
        : null;
    const magNum = parseFloat(eq.magnitude);
    const satZoom = isNaN(magNum) ? 7 : magNum >= 7 ? 6 : magNum >= 6 ? 7 : 8;
    const yandexUrl = hasCoords
        ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=${satZoom}&size=600,400&l=sat,skl&pt=${lng},${lat},pm2rdm`
        : null;
    const photoUrls = [cardUrl, yandexUrl].filter(Boolean);
    const withProof = (params) => {
        if (proof)
            params.appsecret_proof = proof;
        return params;
    };
    for (const photoUrl of photoUrls) {
        if (String(photoUrl).includes("/api/quake-card") && !(await warmCardUrl(photoUrl, "phivolcs"))) {
            console.error("[fb][phivolcs] card not renderable, using Yandex backup");
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
    // Skip anything already FB-posted (EMSC cross-posts AND PHIVOLCS revisions).
    const fbMatch = findFbPostMatch(await getFbPostedIndex(kv), latest.timeMs, lat, lng, mag);
    if (fbMatch) {
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
    if (fbStatus.startsWith("posted"))
        await recordFbPosted(kv, { source: "phivolcs", id: dedupKey, timeMs: latest.timeMs, lat, lng, mag });
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

// Named exports for unit testing (harmless in the worker runtime).
export { parsePhivolcsTimeMs, buildPhivolcsFbMessage, fetchLatestPhivolcs, fbPassesFilters, postEmscToFacebook, postPhivolcsToFacebook };

export default {
    async fetch(request, env) {
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
        return new Response("Not Found", { status: 404, headers: CORS });
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil((async () => {
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
