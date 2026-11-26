// Push monitor — FCM push notifications driven by the app's selected feed.
//
// Per worker tick (the 1-minute cron, or /trigger-push):
//   scrape PHIVOLCS + USGS + EMSC → normalize rows exactly like the app →
//   for each event: dedup by source+time+coords, decide new/updated, then send
//   only to devices whose prefs.source matches the event's source.
//
// Reliability rule: dedup rows are written AFTER delivery. A failed feed read,
// a failed token read, or a failed FCM token exchange leaves the event
// unmarked so the next tick retries it instead of silently swallowing it.
//
// Prefs live on the fcm_tokens row (prefs jsonb). `source` is kept in sync with
// the app's API selector; devices without it default to phivolcs.

import { createSign } from "node:crypto";
import { fetchPhivolcsIndex, extractPhivolcsRows } from "./phivolcs.js";
import { fetchUsgsRows, fetchEmscRows } from "./quake-feeds.js";

const MAX_DEVICES_PER_EVENT = 50;
const OAUTH_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

// ------------------------------------------------------------------ helpers

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// Quiet hours, same wrap-aware semantics as src/lib/alertSystem.ts
// (isQuietHours): [start, end) wraps around midnight when start > end.
function isQuietHours(hours, now = new Date()) {
    const start = hours && typeof hours.start === "number" ? hours.start : null;
    const end = hours && typeof hours.end === "number" ? hours.end : null;
    // -1/-1 is the explicit "Never" option from the app.
    if (start === null || end === null || start < 0 || end < 0) return false;
    // The app stores the user's local hour (Philippines, UTC+8), but Workers'
    // Date runs in UTC. Convert before comparing, otherwise quiet hours are
    // off by 8 hours.
    const h = new Date(now.getTime() + 8 * 3600000).getUTCHours();
    return start <= end ? h >= start && h < end : h >= start || h < end;
}

// Same slug the web app uses for the /details/:id route
// (src/lib/supabase.ts earthquakeToEqId): base64url of `${datetime}-${lat}-${lng}`.
function earthquakeToEqId(eq) {
    const raw = eq.raw ?? {};
    const dt = raw.datetime ?? eq.datetime;
    const lat = raw.latitude ?? eq.latitude;
    const lng = raw.longitude ?? eq.longitude;
    return btoa(`${dt}-${lat}-${lng}`)
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function fnv1a(str) {
    let h = 0xcbf29ce484222325n;
    for (let i = 0; i < str.length; i++) {
        h ^= BigInt(str.charCodeAt(i));
        h = (h * 0x100000001b3n) % 0xfffffffffffffffbn;
    }
    return h.toString(16);
}

function nidFor(event) {
    return "q" + fnv1a(event.event_key).slice(-12);
}

function fmtMag(m) {
    const s = Number(m).toFixed(1);
    return s === "0.0" ? "0" : s;
}

function buildNotificationText(category, event, distanceKm, oldMagnitude) {
    const mag = fmtMag(event.magnitude);
    const loc = event.location || "your location";
    // Always state the data source; notifications report published quakes,
    // never a prediction or an official early-warning alert.
    const sourceLabel = String(event.source ?? "phivolcs").toUpperCase();
    const src = ` · Source: ${sourceLabel}`;
    const detectedBody = `A magnitude ${mag} detected near ${loc} with depth of ${event.depth ?? 0} km at ${event.datetime} according to ${sourceLabel}`;
    switch (category) {
        case "significant":
            return {
                title: `M${mag} Earthquake Detected`,
                body: detectedBody,
            };
        case "nearby": {
            const d = typeof distanceKm === "number" ? Math.round(distanceKm) : 0;
            return {
                title: `M${mag} quake within ${d} km of ${loc}`,
                body: `Depth ${event.depth ?? 0} km · ${event.datetime}${d > 0 ? ` · ~${d} km away` : ""}${src}`,
            };
        }
        case "update": {
            const old = typeof oldMagnitude === "number" ? ` from M${fmtMag(oldMagnitude)}` : "";
            return {
                title: `M${mag} – Update: ${loc}`,
                body: `Magnitude revised${old}${event.depth ? `, depth ${event.depth} km` : ""} · ${event.datetime}${src}`,
            };
        }
        case "new":
        default:
            return {
                title: `M${mag} Earthquake Detected`,
                body: detectedBody,
            };
    }
}

// Extra safety alert for a strong quake close to one of the user's places.
function buildConcernText(event, distanceKm) {
    const mag = fmtMag(event.magnitude);
    const sourceLabel = String(event.source ?? "phivolcs").toUpperCase();
    return {
        title: "Are you okay? Strong quake nearby",
        body: `A M${mag} quake happened near your saved place (about ${Math.round(distanceKm)} km away) at ${event.datetime}, according to ${sourceLabel}. Stay safe and check local updates. This is not an early warning.`,
    };
}

// ------------------------------------------------------- PostgREST helpers

function authHeaders(env) {
    return {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    };
}

async function pgGet(env, table, query, { limit = 50 } = {}) {
    // `null` means "the read failed" and must stay distinguishable from `[]`
    // ("the table is empty"). The monitor relies on that difference so a
    // transient PostgREST error never looks like "nobody is registered".
    const qs = query ? `${query}&` : "";
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?select=*&${qs}limit=${limit}`, {
        headers: authHeaders(env),
    });
    if (!res.ok) return null;
    try {
        return await res.json();
    } catch {
        return null; // malformed body
    }
}

async function pgInsert(env, table, row) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...authHeaders(env), "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify(row),
    });
    return res.ok;
}

async function pgInsertMany(env, table, rows) {
    if (!rows.length) return true;
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
        method: "POST",
        headers: { ...authHeaders(env), "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify(rows),
    });
    return res.ok;
}

async function pgPatch(env, table, id, row) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(String(id))}`, {
        method: "PATCH",
        headers: { ...authHeaders(env), "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify(row),
    });
    return res.ok;
}

async function pgDeleteToken(env, id) {
    await fetch(`${env.SUPABASE_URL}/rest/v1/fcm_tokens?id=eq.${encodeURIComponent(String(id))}`, {
        method: "DELETE",
        headers: authHeaders(env),
    }).catch(() => {});
}

// Bulk delete (dead FCM tokens) — one request for the whole batch.
async function pgDeleteTokens(env, ids) {
    if (!ids.length) return;
    const list = ids.map((id) => `"${String(id).replace(/"/g, "")}"`).join(",");
    await fetch(`${env.SUPABASE_URL}/rest/v1/fcm_tokens?id=in.(${encodeURIComponent(list)})`, {
        method: "DELETE",
        headers: authHeaders(env),
    }).catch(() => {});
}

// Retention: drop dedup rows nobody will look at again.
async function pgDeleteOldQuakes(env, days) {
    const cut = new Date(Date.now() - days * 86400000).toISOString();
    await fetch(`${env.SUPABASE_URL}/rest/v1/processed_quakes?seen_at=lt.${encodeURIComponent(cut)}`, {
        method: "DELETE",
        headers: authHeaders(env),
    });
}

// ------------------------------------------------------- FCM delivery

function fcmProjectId(env) {
    try {
        return JSON.parse(env.FCM_SERVICE_ACCOUNT).project_id;
    } catch {
        return env.FCM_PROJECT_ID;
    }
}

function base64urlEncode(input) {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signJwt(sa) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64urlEncode(
        JSON.stringify({
            iss: sa.client_email,
            scope: OAUTH_SCOPE,
            aud: "https://oauth2.googleapis.com/token",
            iat: now,
            exp: now + 3600,
        }),
    );
    const signingInput = `${header}.${payload}`;
    const signature = createSign("RSA-SHA256").update(signingInput).sign(sa.private_key);
    return `${signingInput}.${base64urlEncode(signature)}`;
}

async function getFcmAccessToken(env, { forceRefresh = false } = {}) {
    // OAuth tokens last ~1 hour. Signing the JWT (RSA) is the most CPU-heavy
    // step in a tick, so cache the access token in KV and reuse it. This keeps
    // most 1-minute ticks cheap enough for the Workers free CPU budget.
    const kv = env.HAZE_KV || env.PAGASA_KV || env.VOLCANO_KV || env.TSUNAMI_KV;
    if (!forceRefresh && kv) {
        try {
            const cached = await kv.get("fcm:oauth:access_token");
            if (cached) return cached;
        } catch { /* cache miss is fine */ }
    }

    const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT || "null");
    if (!sa || !sa.client_email || !sa.private_key) {
        throw new Error("FCM_SERVICE_ACCOUNT not configured");
    }
    const jwt = signJwt(sa);
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.access_token) {
        throw new Error(
            `FCM token exchange failed (${res.status}): ${data.error_description || data.error || "unknown"}`,
        );
    }
    if (kv) {
        try {
            // Refresh well before the 1-hour expiry.
            await kv.put("fcm:oauth:access_token", data.access_token, { expirationTtl: 3000 });
        } catch { /* best effort */ }
    }
    return data.access_token;
}

// ------------------------------------------------------------- dedup/decision
//
// Everything below runs ONCE per invocation over in-memory data. Cloudflare's
// free plan allows 50 subrequests per invocation, and the previous shape spent
// 2–4 requests per quake (50+ quakes on the index page) — the monitor died with
// "Too many subrequests". The batched shape costs, in steady state:
//   1 (index) + 1 (dedup set) + 1 (devices) = 3
// and, on a tick with new events, a single bulk insert plus ≤ MAX_SENDS_PER_RUN
// FCM sends.

const LOOKBACK_DAYS = 14;      // dedup window loaded each tick
const RETENTION_DAYS = 30;     // dedup rows older than this are deleted
const MAX_ROWS_PER_RUN = 40;   // rows taken from the PHIVOLCS index page
const MAX_SENDS_PER_RUN = 20;  // hard ceiling on FCM sends per invocation

function buildEvent(source, row) {
    const event = {
        source,
        event_key: `${source}:${[row.datetime, row.latitude, row.longitude].join("|")}`,
        datetime: row.datetime,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        depth: Number(row.depth ?? 0),
        magnitude: Number(row.magnitude ?? 0),
        location: row.location ?? "",
        // Keep the source's original strings for the deep-link slug: USGS/EMSC
        // coordinates are "14.60" and Number() would turn them into "14.6".
        raw: {
            datetime: row.datetime,
            latitude: row.latitude,
            longitude: row.longitude,
        },
    };
    if (
        !Number.isFinite(event.latitude) ||
        !Number.isFinite(event.longitude) ||
        !Number.isFinite(event.magnitude)
    ) {
        return null;
    }
    return event;
}

// Update thresholds: |Δmag| ≥ 0.3, |Δdepth| ≥ 3 km, or a location change.
function eventChanged(prev, event) {
    return (
        Math.abs(Number(prev.magnitude) - event.magnitude) >= 0.3 ||
        Math.abs(Number(prev.depth) - event.depth) >= 3 ||
        String(prev.location ?? "").toLowerCase() !== String(event.location ?? "").toLowerCase()
    );
}

// Cross-source correlation (±30 min, ±0.6°, |Δmag| ≤ 0.5) — same rule as before,
// now evaluated in memory against the loaded dedup set plus this run's inserts.
function findCorrelatedInMemory(pool, event) {
    const now = Date.now();
    for (const c of pool) {
        if (c.event_key === event.event_key) continue;
        // Hazard dedup rows share this table but are not quakes — never let a
        // sentinel volcano/tsunami row correlate with a real earthquake.
        if (/^(volcano|tsunami):/.test(String(c.event_key ?? ""))) continue;
        // Correlation is bookkeeping for the *same physical quake reported by
        // a different feed*. Two separate quakes from the same feed (e.g. two
        // M3 quakes 20 minutes apart in the same province) are genuinely
        // distinct events and must never suppress each other.
        if (c.source === event.source) continue;
        if (Math.abs(Number(c.magnitude) - event.magnitude) > 0.5) continue;
        if (Math.abs(Number(c.latitude) - event.latitude) > 0.6) continue;
        if (Math.abs(Number(c.longitude) - event.longitude) > 0.6) continue;
        const seen = new Date(c.seen_at ?? c.first_seen ?? 0).getTime();
        if (!Number.isFinite(seen) || Math.abs(now - seen) > 30 * 60 * 1000) continue;
        return c;
    }
    return null;
}

// Pure: decides which devices get this event, and in which category.
// One notification max per device per event: significant → nearby → new.
function targetsForEvent(devices, kind, event, prevMagnitude) {
    const now = new Date();
    const mag = Number(event.magnitude);
    const jobs = [];

    for (const t of devices) {
        const p = t.prefs;
        if (!p || p.enabled !== true) continue;
        // Only notify devices whose selected feed matches this event. Legacy
        // rows without a source pref keep the old PHIVOLCS behaviour.
        const src = p.source ?? p.preferred_api ?? "phivolcs";
        if (src !== event.source) continue;
        if (isQuietHours(p.quiet_hours, now)) continue;

        const cats = p.categories || {};
        const minMag = typeof p.min_magnitude === "number" ? p.min_magnitude : 4.5;
        const sigThr = typeof p.significant_threshold === "number" ? p.significant_threshold : 6;
        const radius = typeof p.nearby_radius_km === "number" ? p.nearby_radius_km : 50;

        let category = null;
        let distanceKm = null;

        if (kind === "update") {
            if (cats.updates === true) category = "update";
        } else {
            if (cats.significant === true && mag >= sigThr) {
                category = "significant";
            } else if (
                cats.nearby === true &&
                Array.isArray(p.locations) &&
                p.locations.length > 0 &&
                mag >= minMag
            ) {
                let best = null;
                for (const loc of p.locations) {
                    if (typeof loc.lat !== "number" || typeof loc.lng !== "number") continue;
                    const d = haversineKm(loc.lat, loc.lng, event.latitude, event.longitude);
                    if (best === null || d < best) best = d;
                }
                if (best !== null && best <= radius) {
                    category = "nearby";
                    distanceKm = best;
                }
            }
            if (category === null && cats.new === true && mag >= minMag) category = "new";
        }
        if (!category) continue;

        const text = buildNotificationText(category, event, distanceKm, prevMagnitude);
        jobs.push({
            event,
            target: {
                id: t.id,
                token: t.token,
                source: event.source,
                category,
                nid: nidFor(event),
                event_key: event.event_key,
                magnitude: mag,
                depth: Number(event.depth ?? 0),
                location: event.location,
                datetime: event.datetime,
                ...text,
                ...(distanceKm != null ? { distance_km: distanceKm } : {}),
            },
        });

        // Extra "possibly affected" alert: only for M6.0+ close to a saved
        // place, and only if the user still wants strong/nearby alerts.
        if (
            kind !== "update" &&
            mag >= 6 &&
            (cats.significant === true || cats.nearby === true) &&
            Array.isArray(p.locations) &&
            p.locations.length > 0
        ) {
            let nearest = null;
            for (const loc of p.locations) {
                if (typeof loc.lat !== "number" || typeof loc.lng !== "number") continue;
                const d = haversineKm(loc.lat, loc.lng, event.latitude, event.longitude);
                if (nearest === null || d < nearest) nearest = d;
            }
            if (nearest !== null && nearest <= radius) {
                const concern = buildConcernText(event, nearest);
                jobs.push({
                    event,
                    target: {
                        id: t.id,
                        token: t.token,
                        source: event.source,
                        category: "concern",
                        nid: `${nidFor(event)}-c`,
                        event_key: event.event_key,
                        magnitude: mag,
                        depth: Number(event.depth ?? 0),
                        location: event.location,
                        datetime: event.datetime,
                        distance_km: nearest,
                        ...concern,
                    },
                });
            }
        }
    }
    return jobs.slice(0, MAX_DEVICES_PER_EVENT);
}

function logRow(t, message, status, error) {
    return {
        token_id: t.id,
        event_key: t.event_key,
        category: t.category,
        payload: message.data,
        fcm_status: status,
        error: error ?? null,
    };
}

// Sends a batch of jobs with ONE OAuth token exchange, collecting log rows and
// dead tokens so the caller can persist them in two requests.
async function deliver(env, jobs) {
    const result = { sent: 0, log: [], dead: [], bySource: {}, authError: null };
    if (!jobs.length) return result;

    let accessToken;
    try {
        accessToken = await getFcmAccessToken(env);
    } catch (e) {
        // Surface this instead of returning a silent zero. The caller keeps
        // the events unmarked so the next tick retries them.
        result.authError = e instanceof Error ? e.message : String(e);
        console.error("[push] FCM access token failed", e);
        return result;
    }

    const url = `https://fcm.googleapis.com/v1/projects/${fcmProjectId(env)}/messages:send`;

    for (const { event, target: t } of jobs) {
        // Quake jobs carry a normalized event for the deep-link slug; hazard
        // jobs (volcano/tsunami) carry a `link` instead and have no quake slug.
        const data = event
            ? {
                eq_id: earthquakeToEqId(event),
                magnitude: String(t.magnitude),
                depth: String(t.depth),
                location: t.location,
                datetime: t.datetime,
                ...(t.distance_km != null ? { distance_km: String(Math.round(t.distance_km)) } : {}),
            }
            : { ...(t.link ? { link: t.link } : {}) };
        const message = {
            token: t.token,
            data: {
                nid: t.nid,
                event_key: t.event_key,
                category: t.category,
                title: t.title,
                body: t.body,
                ...data,
            },
            android: { ttl: "900s", priority: "HIGH" },
        };

        try {
            let res = await fetch(url, {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ message }),
            });
            if (res.status === 401) {
                // Cached token was revoked or expired early: refresh once.
                accessToken = await getFcmAccessToken(env, { forceRefresh: true });
                res = await fetch(url, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ message }),
                });
            }
            if (res.status === 200) {
                result.sent++;
                result.bySource[t.source] = (result.bySource[t.source] || 0) + 1;
                result.log.push(logRow(t, message, "sent", null));
            } else {
                // Capture FCM's real error message. A 404 is not always an
                // unregistered token (wrong endpoint/project also give 404) —
                // only prune on an explicit registration-token error.
                let errBody = "";
                try {
                    const j = await res.json();
                    errBody = j?.error?.message ?? "";
                } catch { /* keep generic */ }
                if (res.status === 404 && /unregistered|notregistered|not registered|not a valid|invalid.*(registration|token)|not found/i.test(errBody)) {
                    result.dead.push(t.id);
                    result.log.push(logRow(t, message, "error", `FCM_UNREGISTERED: ${errBody}`));
                } else {
                    result.log.push(logRow(t, message, "error", `HTTP ${res.status}${errBody ? `: ${errBody}` : ""}`));
                }
            }
        } catch (e) {
            result.log.push(logRow(t, message, "error", String(e)));
        }
    }
    return result;
}

// ------------------------------------------------------------- public API

export async function runPushMonitor(env) {
    const stats = {
        sources: [],
        sent: 0,
        created: 0,
        updated: 0,
        seeded: false,
        error: null,
        devices: 0,
        jobs: 0,
        detected: 0,
        retryPending: 0,
        deliveryError: null,
    };

    try {
        if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
            stats.error = "SUPABASE_URL/SUPABASE_ANON_KEY not configured";
            return stats;
        }

        // 1 — the event feeds. Each feed is isolated: one source failing must
        // not block notifications from the others.
        const feeds = [
            {
                source: "phivolcs",
                load: async () => extractPhivolcsRows(await fetchPhivolcsIndex()),
            },
            { source: "usgs", load: fetchUsgsRows },
            { source: "emsc", load: fetchEmscRows },
        ];
        const rowsBySource = [];
        for (const f of feeds) {
            try {
                const rows = await f.load();
                rowsBySource.push({
                    source: f.source,
                    rows: rows.slice(0, MAX_ROWS_PER_RUN),
                    error: null,
                });
            } catch (e) {
                rowsBySource.push({
                    source: f.source,
                    rows: [],
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        // 2 — the dedup set (one request). A null result means the table is
        // missing or unreadable — say so instead of treating everything as new.
        const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
        const knownRes = await pgGet(env, "processed_quakes", `seen_at=gt.${encodeURIComponent(since)}`, {
            limit: 2000,
        });
        if (knownRes === null) {
            stats.error = "processed_quakes unreadable — run supabase/push_notifications.sql";
            return stats;
        }
        const known = knownRes;
        const byKey = new Map(known.map((r) => [r.event_key, r]));
        const sourcesWithHistory = new Set(known.map((r) => r.source));

        // 3 — the devices (one request). A failed read is NOT the same as "no
        // devices": abort the run so events stay unmarked and retry next tick.
        const deviceRows = await pgGet(env, "fcm_tokens", "", { limit: 500 });
        if (deviceRows === null) {
            stats.error = "fcm_tokens unreadable — will retry next tick";
            return stats;
        }
        const devices = deviceRows;
        if (!devices.length) stats.error = "no registered devices (nothing to notify)";

        // First run for a newly-enabled source: record its events, notify
        // nobody, so switching to USGS/EMSC never dumps the whole feed at once.
        const quietSeed = String(env.SEED_QUIETLY ?? "1") !== "0";
        const quietFor = (source) => quietSeed && !sourcesWithHistory.has(source);

        const fresh = [];
        const changed = [];
        for (const { source, rows } of rowsBySource) {
            for (const row of rows) {
                const event = buildEvent(source, row);
                if (!event) continue;
                const prev = byKey.get(event.event_key);
                if (!prev) fresh.push(event);
                else if (eventChanged(prev, event)) changed.push({ event, prev });
            }
        }

        const nowIso = new Date().toISOString();
        const jobs = [];
        const newRows = [];
        const patches = [];
        const jobsByEvent = new Set();

        const pool = known.slice();
        for (const event of fresh) {
            const corr = findCorrelatedInMemory(pool, event);
            const row = {
                event_key: event.event_key,
                source: event.source,
                datetime: event.datetime,
                latitude: event.latitude,
                longitude: event.longitude,
                depth: event.depth,
                magnitude: event.magnitude,
                location: event.location,
                correlation_key: corr ? corr.correlation_key : event.event_key,
                update_count: 0,
                first_seen: nowIso,
                seen_at: nowIso,
            };
            newRows.push(row);
            pool.push(row);
            // Every fresh event from the user's selected feed is deliverable.
            // Cross-source correlation only tags duplicates for bookkeeping.
            if (!quietFor(event.source)) {
                const eventJobs = targetsForEvent(devices, "new", event);
                if (eventJobs.length) jobsByEvent.add(event.event_key);
                jobs.push(...eventJobs);
            }
        }

        for (const { event, prev } of changed) {
            patches.push({
                id: prev.id,
                event_key: event.event_key,
                row: {
                    magnitude: event.magnitude,
                    depth: event.depth,
                    location: event.location,
                    update_count: (Number(prev.update_count) || 0) + 1,
                    seen_at: nowIso,
                },
            });
            if (prev.correlation_key === prev.event_key && !quietFor(event.source)) {
                const eventJobs = targetsForEvent(devices, "update", event, Number(prev.magnitude));
                if (eventJobs.length) jobsByEvent.add(event.event_key);
                jobs.push(...eventJobs);
            }
        }

        // 4 — deliver BEFORE writing dedup state. If FCM auth fails, nothing is
        // marked as processed, so the same quake is retried on the next tick.
        const capped = jobs.slice(0, MAX_SENDS_PER_RUN);
        const delivery = await deliver(env, capped);
        const attempted = new Set(capped.map((j) => j.target.event_key));

        // 5 — persist dedup state only for events we actually handled or
        // intentionally skipped (no matching device). Events dropped by the
        // per-run cap, or blocked by an FCM auth failure, retry next tick.
        const rowsToInsert = newRows.filter((row) => {
            if (quietFor(row.source)) return true;
            if (!jobsByEvent.has(row.event_key)) return true;
            if (delivery.authError) return false;
            return attempted.has(row.event_key);
        });
        if (rowsToInsert.length) {
            const inserted = await pgInsertMany(env, "processed_quakes", rowsToInsert);
            if (!inserted) stats.error = "processed_quakes insert failed (check schema/RLS)";
        }
        for (const p of patches) {
            if (delivery.authError && jobsByEvent.has(p.event_key)) continue;
            await pgPatch(env, "processed_quakes", p.id, p.row);
        }

        // 6 — persist the audit trail and drop dead tokens (two requests).
        if (delivery.log.length) await pgInsertMany(env, "notification_log", delivery.log);
        if (delivery.dead.length) await pgDeleteTokens(env, delivery.dead);

        // 7 — housekeeping (one request, best effort).
        await pgDeleteOldQuakes(env, RETENTION_DAYS).catch(() => {});

        stats.detected = newRows.length;
        stats.created = rowsToInsert.length;
        stats.updated = changed.length;
        stats.sent = delivery.sent;
        stats.devices = devices.length;
        stats.jobs = jobs.length;
        stats.retryPending = newRows.length - rowsToInsert.length;
        stats.deliveryError = delivery.authError;
        stats.seeded = rowsBySource.some((f) => quietFor(f.source));
        const droppedFor = (source) =>
            jobs.filter((j) => j.target.source === source).length -
            capped.filter((j) => j.target.source === source).length;
        for (const f of rowsBySource) {
            stats.sources.push({
                source: f.source,
                new: fresh.filter((e) => e.source === f.source).length,
                updated: changed.filter((e) => e.event.source === f.source).length,
                sent: delivery.bySource[f.source] || 0,
                rows: f.rows.length,
                seeded: quietFor(f.source),
                error: f.error,
                dropped: Math.max(0, droppedFor(f.source)),
            });
        }
    } catch (e) {
        stats.error = e instanceof Error ? e.message : String(e);
    }
    return stats;
}

// Sends a system message from an authenticated admin to opted-in devices.
// Capped per invocation to stay under the Workers 50-subrequest limit.
const MAX_ADMIN_SENDS = 40;

export async function sendAdminNotification(env, { title, body, source, link, scope }) {
    const result = { total: 0, sent: 0, failed: 0, dead: [], capped: false, error: null };
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        result.error = "Supabase not configured";
        return result;
    }
    try {
        const devices = (await pgGet(env, "fcm_tokens", "", { limit: 500 })) || [];
        const targets = devices.filter((t) => {
            const p = t.prefs;
            // Forum/admin announcements can reach every registered device;
            // manual pushes default to users who opted into earthquake alerts.
            if (scope !== "all" && (!p || p.enabled !== true)) return false;
            const src = p.source ?? p.preferred_api ?? "phivolcs";
            return !source || src === source;
        });
        result.total = targets.length;
        const chosen = targets.slice(0, MAX_ADMIN_SENDS);
        result.capped = targets.length > chosen.length;
        if (!chosen.length) return result;

        const accessToken = await getFcmAccessToken(env);
        const url = `https://fcm.googleapis.com/v1/projects/${fcmProjectId(env)}/messages:send`;
        const nid = `admin-${Date.now()}`;
        const log = [];

        for (const t of chosen) {
            const message = {
                token: t.token,
                data: {
                    nid,
                    category: "admin",
                    title,
                    body,
                    source: "system",
                    ...(link ? { link } : {}),
                },
                android: { ttl: "900s", priority: "HIGH" },
            };
            try {
                const res = await fetch(url, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ message }),
                });
                if (res.status === 200) {
                    result.sent++;
                } else {
                    result.failed++;
                    let errBody = "";
                    try {
                        const j = await res.json();
                        errBody = j?.error?.message ?? "";
                    } catch { /* keep generic */ }
                    if (res.status === 404 && /unregistered|notregistered|not registered|not a valid|invalid.*(registration|token)|not found/i.test(errBody)) {
                        result.dead.push(t.id);
                    }
                }
                log.push({
                    token_id: t.id,
                    event_key: `admin:${nid}`,
                    category: "admin",
                    payload: message.data,
                    fcm_status: res.status === 200 ? "sent" : "error",
                    error: res.status === 200 ? null : `FCM HTTP ${res.status}`,
                });
            } catch (e) {
                result.failed++;
                log.push({
                    token_id: t.id,
                    event_key: `admin:${nid}`,
                    category: "admin",
                    payload: message.data,
                    fcm_status: "error",
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }
        if (log.length) await pgInsertMany(env, "notification_log", log);
        if (result.dead.length) await pgDeleteTokens(env, result.dead);
    } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
    }
    return result;
}

export {
    pgGet,
    pgInsertMany,
    pgDeleteTokens,
    getFcmAccessToken,
    fcmProjectId,
    isQuietHours,
    fnv1a,
    deliver,
};
