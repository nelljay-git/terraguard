// PHIVOLCS-only push notifications for volcano bulletins and tsunami advisories.
//
// These are NOT earthquake alerts: they use their own categories/channels and a
// separate `volcano:` / `tsunami:` dedup namespace in processed_quakes. Delivery
// is restricted to devices whose selected feed is PHIVOLCS, using the exact same
// source check as the earthquake monitor. Dedup rows are written AFTER delivery
// so an FCM auth failure leaves the bulletin to retry on the next tick.

import {
    pgGet,
    pgInsertMany,
    pgDeleteTokens,
    isQuietHours,
    fnv1a,
    deliver,
} from "./push-monitor.js";

const PHP_HOSTS = [
    "https://trikefare.x10.mx/terraguard",
    "https://terraguard-auto.page.gd/terraguard",
];
const LOOKBACK_DAYS = 14;
const MAX_ROWS_PER_FEED = 12;
const MAX_HAZARD_SENDS = 8;

const VOLCANO_URLS = PHP_HOSTS.map((h) => `${h}/api/volcano.php?page=hub`);
const TSUNAMI_URLS = PHP_HOSTS.map((h) => `${h}/api/tsunami.php?page=events`);

async function fetchJsonWithFailover(urls) {
    let lastError = null;
    for (const url of urls) {
        try {
            const res = await fetch(url, { headers: { "User-Agent": "TerraGuard/1.0" } });
            if (!res.ok) {
                lastError = new Error(`HTTP ${res.status} from ${url}`);
                continue;
            }
            const json = await res.json();
            if (json && json.success !== false && Array.isArray(json.data)) return json;
            lastError = new Error(`Unexpected payload from ${url}`);
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError ?? new Error("All PHIVOLCS hazard hosts failed");
}

function dedupRow(key, datetime, location, nowIso) {
    // processed_quakes has NOT NULL numeric columns. Hazards have no magnitude,
    // depth or coordinates, so use sentinel zeros. findCorrelatedInMemory()
    // explicitly skips volcano:/tsunami: keys, so these can never be mistaken
    // for earthquakes.
    return {
        event_key: key,
        source: "phivolcs",
        datetime: datetime || "bulletin",
        latitude: 0,
        longitude: 0,
        depth: 0,
        magnitude: 0,
        location: location || "Philippines",
        correlation_key: key,
        update_count: 0,
        first_seen: nowIso,
        seen_at: nowIso,
    };
}

function volcanoBulletins(json) {
    const issued = String(json.issued ?? "");
    return (json.data ?? []).slice(0, MAX_ROWS_PER_FEED).map((v) => {
        const name = String(v.volcano ?? "Volcano");
        const level = typeof v.alertLevel === "number" ? v.alertLevel : null;
        const identity = v.bid != null ? String(v.bid) : fnv1a(String(v.url ?? "")).slice(-10);
        const key = `volcano:${name.toLowerCase()}:${identity}:${fnv1a(`${level}|${v.title ?? ""}`).slice(-8)}`;
        return {
            kind: "volcano",
            event_key: key,
            source: "phivolcs",
            category: "volcano",
            nid: `v${fnv1a(key).slice(-12)}`,
            title: level != null ? `${name} — Alert Level ${level}` : `${name} bulletin`,
            body: `${v.title || "New PHIVOLCS volcano bulletin"}. Issued ${issued || "recently"} according to PHIVOLCS. Open for the full bulletin.`,
            link: v.url || "https://wovodat.phivolcs.dost.gov.ph/bulletin/list-of-bulletin",
            datetime: issued,
            location: name,
        };
    });
}

function tsunamiAdvisories(json) {
    const out = [];
    for (const row of (json.data ?? []).slice(0, MAX_ROWS_PER_FEED)) {
        const mag = Number(row.magnitude);
        const magLabel = Number.isFinite(mag) ? `M${mag.toFixed(1)}` : "an earthquake";
        const when = String(row.dateTimePST || row.occurredAtUtc || "recently");
        const where = String(row.location || "the Philippines");
        for (const a of (row.advisories ?? []).slice(0, 3)) {
            const url = String(a.url ?? "");
            if (!url) continue;
            const key = `tsunami:${url}`;
            const label = String(a.label ?? `Bulletin #${a.number ?? ""}`);
            out.push({
                kind: "tsunami",
                event_key: key,
                source: "phivolcs",
                category: "tsunami",
                nid: `t${fnv1a(key).slice(-12)}`,
                title: `Tsunami update — ${label}`,
                body: `PHIVOLCS issued ${label} for ${magLabel} near ${where} at ${when}. Source: PHIVOLCS. Open Tsunami for details — this is not an early warning.`,
                link: "/tsunami",
                datetime: String(a.fileUtc || row.occurredAtUtc || ""),
                location: where,
            });
            if (out.length >= MAX_ROWS_PER_FEED) break;
        }
        if (out.length >= MAX_ROWS_PER_FEED) break;
    }
    return out;
}

export async function runHazardPushMonitor(env) {
    const stats = {
        devices: 0,
        jobs: 0,
        sent: 0,
        error: null,
        volcano: { rows: 0, new: 0, seeded: 0, sent: 0, error: null },
        tsunami: { rows: 0, new: 0, seeded: 0, sent: 0, error: null },
    };
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        stats.error = "Supabase not configured";
        return stats;
    }

    try {
        // 1 — dedup set (one request). Null means the read failed: abort so no
        // bulletin is marked and the next tick retries it.
        const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
        const known = await pgGet(env, "processed_quakes", `seen_at=gt.${encodeURIComponent(since)}`, { limit: 2000 });
        if (known === null) {
            stats.error = "processed_quakes unreadable — will retry next tick";
            return stats;
        }
        const byKey = new Map(known.map((r) => [r.event_key, r]));
        const hasHistory = {
            volcano: known.some((r) => String(r.event_key).startsWith("volcano:")),
            tsunami: known.some((r) => String(r.event_key).startsWith("tsunami:")),
        };

        // 2 — devices (one request). Failed read is not "no devices".
        const devices = await pgGet(env, "fcm_tokens", "", { limit: 500 });
        if (devices === null) {
            stats.error = "fcm_tokens unreadable — will retry next tick";
            return stats;
        }
        stats.devices = devices.length;

        // 3 — both public feeds (failures are isolated per feed).
        const feeds = [
            { kind: "volcano", urls: VOLCANO_URLS, parse: volcanoBulletins },
            { kind: "tsunami", urls: TSUNAMI_URLS, parse: tsunamiAdvisories },
        ];
        const allEvents = [];
        for (const feed of feeds) {
            try {
                const events = feed.parse(await fetchJsonWithFailover(feed.urls));
                stats[feed.kind].rows = events.length;
                allEvents.push(...events);
            } catch (e) {
                stats[feed.kind].error = e instanceof Error ? e.message : String(e);
            }
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const jobs = [];
        const newRows = [];
        const jobsByEvent = new Set();

        for (const ev of allEvents) {
            if (byKey.has(ev.event_key)) continue;
            const seed = !hasHistory[ev.kind];
            newRows.push(dedupRow(ev.event_key, ev.datetime, ev.location, nowIso));
            if (seed) {
                stats[ev.kind].seeded++;
                continue;
            }
            const kindJobs = [];
            for (const t of devices) {
                const p = t.prefs;
                if (!p || p.enabled !== true) continue;
                const src = p.source ?? p.preferred_api ?? "phivolcs";
                if (src !== "phivolcs") continue;
                if (isQuietHours(p.quiet_hours, now)) continue;
                if (ev.kind === "volcano" && p.volcano_updates === false) continue;
                if (ev.kind === "tsunami" && p.tsunami_updates === false) continue;
                kindJobs.push({
                    event: null, // hazard jobs use `link`, not a quake slug
                    target: {
                        id: t.id,
                        token: t.token,
                        source: "phivolcs",
                        event_key: ev.event_key,
                        category: ev.category,
                        nid: ev.nid,
                        title: ev.title,
                        body: ev.body,
                        link: ev.link,
                    },
                });
            }
            if (kindJobs.length) jobsByEvent.add(ev.event_key);
            jobs.push(...kindJobs);
            stats[ev.kind].new++;
        }

        // 4 — deliver BEFORE dedup writes (same rule as the earthquake monitor).
        const capped = jobs.slice(0, MAX_HAZARD_SENDS);
        const delivery = await deliver(env, capped);
        const attempted = new Set(capped.map((j) => j.target.event_key));
        for (const key of attempted) {
            if (delivery.authError) break;
            const ev = allEvents.find((e) => e.event_key === key);
            if (!ev) continue;
            // Count a key as delivered only when at least one of its sends was
            // accepted (the audit log records the exact result per token).
            if (delivery.log.some((l) => l.event_key === key && l.fcm_status === "sent")) {
                stats[ev.kind].sent++;
            }
        }
        stats.sent = delivery.sent;
        stats.jobs = jobs.length;
        stats.error = delivery.authError;

        // 5 — persist dedup only for events actually handled or skipped.
        const rowsToInsert = newRows.filter((row) => {
            if (!jobsByEvent.has(row.event_key)) return true; // seeded or no targets
            if (delivery.authError) return false;
            return attempted.has(row.event_key);
        });
        if (rowsToInsert.length) {
            const ok = await pgInsertMany(env, "processed_quakes", rowsToInsert);
            if (!ok) stats.error = stats.error ?? "processed_quakes insert failed (check schema/RLS)";
        }
        if (delivery.log.length) await pgInsertMany(env, "notification_log", delivery.log);
        if (delivery.dead.length) await pgDeleteTokens(env, delivery.dead);
    } catch (e) {
        stats.error = e instanceof Error ? e.message : String(e);
    }
    return stats;
}
