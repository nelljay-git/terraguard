/**
 * Cloudflare Worker — Automated Discord Earthquake Webhook (USGS ONLY) — JS version
 * Paste this into dashboard to avoid TypeScript errors.
 * Public fetch returns 404. Only Cron can trigger scheduled().
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const UTC_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function formatUtc(date) {
  const day = date.getUTCDate();
  const month = UTC_MONTHS[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const h = String(date.getUTCHours()).padStart(2,"0");
  const m = String(date.getUTCMinutes()).padStart(2,"0");
  const s = String(date.getUTCSeconds()).padStart(2,"0");
  return `${day} ${month} ${year} - ${h}:${m}:${s} UTC`;
}

function formatUstFromMs(timeMs) {
  const d = new Date(timeMs);
  const dateStr = `${String(d.getUTCDate()).padStart(2,"0")} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2,"0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  const timeStr = `${String(h).padStart(2,"0")}:${m} ${ampm} UST`;
  return { date: dateStr, time: timeStr };
}

function earthquakeToEqId(eq) {
  return btoa(`${eq.datetime}-${eq.latitude}-${eq.longitude}`).replace(/=/g, "");
}

function severityColor(mag) {
  if (mag < 3) return "#10b981";
  if (mag < 4) return "#3b82f6";
  if (mag < 5) return "#f59e0b";
  if (mag < 6) return "#ef4444";
  return "#7f1d1d";
}

function usgsTsunamiLabel(tsunami) {
  if (tsunami === 1) return "TSUNAMI ADVISORY";
  return "NONE";
}

function isInPhilippines(lat, lng) {
  return lat >= 4.5 && lat <= 21.5 && lng >= 116.0 && lng <= 127.0;
}

async function fetchLatestUsgsEarthquake(env) {
  const feed = (env.USGS_FEED || "all_day.geojson").replace(/^\//,"");
  const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}`;
  const res = await fetch(url, { headers: { "User-Agent": "TerraGuard-Cron-USGS/1.0" } });
  if (!res.ok) throw new Error(`USGS ${res.status}`);
  const data = await res.json();
  const feats = data.features || [];
  if (feats.length === 0) return null;
  feats.sort((a,b) => (b.properties.time || 0) - (a.properties.time || 0));
  const minMag = parseFloat(env.MIN_MAGNITUDE || "4.5");
  const minLat = parseFloat(env.USGS_MIN_LAT || "-90");
  const maxLat = parseFloat(env.USGS_MAX_LAT || "90");
  const minLng = parseFloat(env.USGS_MIN_LNG || "-180");
  const maxLng = parseFloat(env.USGS_MAX_LNG || "180");
  const filterByPH = !isNaN(minLat) && !isNaN(maxLat) && !isNaN(minLng) && !isNaN(maxLng) && !(minLat === -90 && maxLat === 90 && minLng === -180 && maxLng === 180);
  for (const f of feats) {
    const mag = f.properties.mag || 0;
    if (!isNaN(minMag) && mag < minMag) continue;
    const lng = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    const depth = f.geometry.coordinates[2];
    if (filterByPH && (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng)) continue;
    const timeMs = f.properties.time;
    const dt = new Date(timeMs);
    const datetime = formatUtc(dt);
    const latStr = (Math.round(lat * 100) / 100).toFixed(2);
    const lngStr = (Math.round(lng * 100) / 100).toFixed(2);
    const depthStr = String(Math.round(depth));
    const magStr = (Math.round(mag * 10) / 10).toFixed(1);
    return {
      datetime, latitude: latStr, longitude: lngStr, depth: depthStr,
      magnitude: magStr, location: f.properties.place || `${latStr}, ${lngStr}`,
      link: f.properties.url, usgsId: f.id, timeMs, tsunami: f.properties.tsunami || 0,
    };
  }
  return null;
}

async function sendDiscordWebhook(eq, env) {
  const webhook = env.DISCORD_WEBHOOK_URL;
  if (!webhook) throw new Error("DISCORD_WEBHOOK_URL not set");
  const lat = parseFloat(eq.latitude), lng = parseFloat(eq.longitude);
  const hasCoords = !isNaN(lat) && !isNaN(lng);
  const { date, time } = formatUstFromMs(eq.timeMs);
  const tsunamiLabel = usgsTsunamiLabel(eq.tsunami);
  const epicenterImage = hasCoords ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=7&size=600,400&l=map&pt=${lng},${lat},pm2rdm` : `https://terraguard.pages.dev/pwa-512x512.png`;
  const mag = parseFloat(eq.magnitude);
  const magNum = mag;
  const mention = magNum >= 7 ? "@everyone " : "";
  const colorHex = severityColor(isNaN(mag) ? 5 : mag).replace("#","");
  const embedColor = parseInt(colorHex.length === 3 ? colorHex.split("").map(c=>c+c).join("") : colorHex, 16) || 0x3b82f6;
  const content = `${mention}🚨 **EARTHQUAKE ALERT** 🚨\n\n💥 **M${eq.magnitude}** earthquake detected near **${eq.location}**.\n\n📅 **Date:** ${date}\n⏰ **Time:** ${time}\n📏 **Depth:** ${eq.depth} km\n📍 **Epicenter:** ${eq.location}\n🌐 **Coordinates:** ${eq.latitude}°N, ${eq.longitude}°E\n\n🌊 **Tsunami Threat:** ${tsunamiLabel}\n\n📡 **Source:** USGS\n\n❓ **Did you feel it?** React ✅ for Yes, ❎ for No`;
  const payload = {
    content,
    allowed_mentions: { parse: ["everyone"] },
    embeds: [{ title: `🌍 M${eq.magnitude} — ${eq.location}`, description: `[View on TerraGuard](https://terraguard-ph.pages.dev/details/${earthquakeToEqId(eq)}) • [Open USGS](${eq.link})`, color: embedColor, image: { url: epicenterImage }, footer: { text: `TerraGuard • ${date} ${time} • USGS` }, timestamp: new Date(eq.timeMs).toISOString() }],
  };
  const waitUrl = webhook.includes("?") ? `${webhook}&wait=true` : `${webhook}?wait=true`;
  const res = await fetch(waitUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) { const t = await res.text().catch(()=> ""); throw new Error(`Discord webhook ${res.status}: ${t.slice(0,500)}`); }
  try {
    const msg = await res.json();
    if (msg?.id) {
      const m = /\/webhooks\/(\d+)\/([^/?]+)/.exec(webhook);
      if (m) {
        const whId = m[1], whToken = m[2];
        for (const emoji of ["%E2%9C%85", "%E2%9D%8E"]) {
          await fetch(`https://discord.com/api/webhooks/${whId}/${whToken}/messages/${msg.id}/reactions/${emoji}/@me`, { method: "PUT" }).catch(()=>{});
          await new Promise(r=> setTimeout(r, 300));
        }
      }
    }
  } catch (_) {}
}

async function handleCron(env) {
  const latest = await fetchLatestUsgsEarthquake(env);
  if (!latest) return "no USGS data (no PH-region quake >= threshold)";
  const dedupKey = `usgs:${latest.usgsId}`;
  const lastId = await env.WEBHOOK_KV.get("last_eq_id");
  const already = await env.WEBHOOK_KV.get(`sent:${dedupKey}`);
  if (already || lastId === dedupKey || lastId === earthquakeToEqId(latest)) return `duplicate ${dedupKey}`;
  await sendDiscordWebhook(latest, env);
  await env.WEBHOOK_KV.put("last_eq_id", dedupKey);
  await env.WEBHOOK_KV.put(`sent:${dedupKey}`, JSON.stringify({ ...latest, sentAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
  await env.WEBHOOK_KV.put(`sent:${earthquakeToEqId(latest)}`, dedupKey, { expirationTtl: 60 * 60 * 24 * 30 });
  return `sent ${dedupKey} M${latest.magnitude} ${latest.location}`;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok USGS", { headers: CORS });
    const auth = request.headers.get("Authorization") || "";
    const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : "";
    const hasValidSecret = expected && auth === expected;
    if (hasValidSecret && (url.pathname === "/trigger" || url.pathname === "/cron-webhook")) {
      try { const msg = await handleCron(env); return new Response(JSON.stringify({ success: true, source: "USGS", message: msg }), { headers: { "Content-Type": "application/json", ...CORS } }); }
      catch (e) { const msg = e instanceof Error ? e.message : String(e); return new Response(JSON.stringify({ success: false, error: msg }), { status: 500, headers: { "Content-Type": "application/json", ...CORS } }); }
    }
    return new Response("Not Found", { status: 404, headers: CORS });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => { try { const msg = await handleCron(env); console.log(`[cron][USGS] ${msg}`); } catch (e) { console.error("[cron][USGS] failed", e); } })());
  },
};
