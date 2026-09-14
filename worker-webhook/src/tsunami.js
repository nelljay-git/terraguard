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
    : q.location || alert.areaDesc || "See details";
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
  return [
    `${emoji}${label}: ${String(alert.event).toUpperCase()} ${emoji}`,
    ``,
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
    `Source: tsunami.gov / NWS`,
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

async function postTsunamiToFacebook(alert, env) {
  const pageId = (env.FB_PAGE_ID ?? "").trim();
  const userToken = (env.FB_USER_ACCESS_TOKEN ?? "").trim();
  const appSecret = (env.FB_APP_SECRET ?? "").trim();
  if (!pageId || !userToken)
    return "skipped (FB_PAGE_ID / FB_USER_ACCESS_TOKEN not set)";
  if (!isTsunamiThreat(alert))
    return `skipped (not a threat: ${alert.event})`;
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
  // Warmed first: first hit compiles WASM + fetches tiles/fonts, and FB's
  // scraper times out on slow responses (then we'd silently downgrade).
  const coords = quakeCoords(alert);
  if (coords) {
    try {
      const cardUrl =
        `https://terraguard-ph.pages.dev/api/tsunami-card` +
        `?lat=${coords.lat}&lng=${coords.lng}`;
      let cardOk = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 13000);
          const warm = await fetch(cardUrl, { method: "GET", signal: ctrl.signal, headers: { "User-Agent": "TerraGuard-FB-Warmup/1.0" } });
          clearTimeout(t);
          if (warm.ok) {
            cardOk = true;
            break;
          }
          console.error(`[fb][tsunami] card warmup ${warm.status} (attempt ${attempt})`);
        }
        catch (e) {
          console.error(`[fb][tsunami] card warmup failed (attempt ${attempt}): ${e instanceof Error ? e.message : String(e)}`);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!cardOk) {
        console.error("[fb][tsunami] card not renderable, using /feed fallback");
      } else {
        const body = withProof({ access_token: pageToken, caption: message, url: cardUrl });
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
  const content = `${mention}${emoji} **TSUNAMI ${alert.event.toUpperCase()}** ${emoji}\n\n**${alert.headline}**\n\n📍 **Areas:** ${alert.areaDesc?.slice(0, 400) || "See details"}\n📅 **Issued:** ${dateStr} ${timeStr}\n🔗 **Details:** ${alert.link}\n\n${alert.description?.slice(0, 900) || ""}\n\n*Source: tsunami.gov / NWS*`;
  const payload = {
    content,
    ...(isThreat ? { allowed_mentions: { parse: ["everyone"] } } : {}),
    embeds: [
      {
        title: `${emoji} ${alert.event} — ${alert.headline.slice(0, 80)}`,
        description: `${alert.description?.slice(0, 1000) || ""}\n\n[View on tsunami.gov](${alert.tsunamiGovLink || alert.link})`,
        color,
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
async function handleCron(env) {
  const alerts = await fetchTsunamiAlerts();
  if (alerts.length === 0)
    return "no active tsunami alert (tsunami.gov: No Warning/Advisory/Watch)";
  let sent = 0;
  for (const a of alerts) {
    const key = `tsunami:${a.id}`;
    const already = await env.WEBHOOK_KV.get(key);
    if (already) continue;
    const min = (env.TSUNAMI_MIN_SEVERITY || "").toLowerCase();
    if (min) {
      const e = a.event.toLowerCase();
      if (min === "warning" && !e.includes("warning")) continue;
      if (
        min === "advisory" &&
        !(e.includes("warning") || e.includes("advisory"))
      )
        continue;
    }
    await sendTsunamiWebhook(a, env);
    // Facebook auto-post — threats only. Best-effort: never blocks or throws.
    let fbStatus = "skipped";
    try {
      fbStatus = await postTsunamiToFacebook(a, env);
    } catch (e) {
      fbStatus = `error ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    }
    console.log(`[fb][tsunami] ${key}: ${fbStatus}`);
    await env.WEBHOOK_KV.put(
      key,
      JSON.stringify({ ...a, fbStatus, sentAt: new Date().toISOString() }),
      { expirationTtl: 60 * 60 * 24 * 7 },
    );
    sent++;
    if (sent >= 3) break;
  }
  if (sent === 0) return `all ${alerts.length} tsunami alerts already sent`;
  return `sent ${sent} tsunami alert(s): ${alerts
    .slice(0, sent)
    .map((a) => a.event)
    .join(", ")}`;
}
// Named exports for unit testing (harmless in the worker runtime).
export { parseQuakeFromText, buildTsunamiMessage, tsunamiSeverityLabel, isTsunamiThreat, quakeCoords };
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return new Response("ok tsunami", { headers: CORS });
    const auth = request.headers.get("Authorization") || "";
    const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : "";
    const ok = expected && auth === expected;
    if (
      ok &&
      (url.pathname === "/trigger" || url.pathname === "/cron-tsunami")
    ) {
      try {
        const msg = await handleCron(env);
        return new Response(
          JSON.stringify({
            success: true,
            source: "tsunami.gov",
            message: msg,
          }),
          { headers: { "Content-Type": "application/json", ...CORS } },
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ success: false, error: String(e) }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS },
          },
        );
      }
    }
    return new Response("Not Found", { status: 404, headers: CORS });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          console.log(`[cron][tsunami] ${await handleCron(env)}`);
        } catch (e) {
          console.error("[cron][tsunami] failed", e);
        }
      })(),
    );
  },
};
