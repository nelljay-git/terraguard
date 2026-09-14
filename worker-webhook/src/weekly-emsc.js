/**
 * Weekly EMSC JS for dashboard paste
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const UTC_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
function fmtDate(d) {
  return `${String(d.getUTCDate()).padStart(2, "0")} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function fmtTime(d) {
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${m} ${ampm} UTC`;
}
async function fetchEmscWeek(start, end, minMag) {
  const params = new URLSearchParams({
    format: "json",
    limit: "20000",
    orderby: "time",
    starttime: start.toISOString(),
    endtime: end.toISOString(),
  });
  if (!isNaN(minMag)) params.set("minmag", String(minMag));
  const r = await fetch(
    `https://www.seismicportal.eu/fdsnws/event/1/query?${params}`,
    { headers: { "User-Agent": "TerraGuard-Weekly-EMSC/1.0" } },
  );
  if (r.status === 204) return [];
  if (!r.ok) throw new Error(`EMSC ${r.status}`);
  const j = await r.json();
  return j.features || [];
}
async function handleWeekly(env) {
  const webhook = env.WEEKLY_ANALYTICS_WEBHOOK_URL;
  if (!webhook) throw new Error("WEEKLY_ANALYTICS_WEBHOOK_URL not set");
  const minMag = parseFloat(env.EMSC_MIN_MAG || "1.0");
  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 3600 * 1000),
    e = new Date(now.getTime());
  const feats = await fetchEmscWeek(start, e, minMag);
  if (feats.length === 0) {
    const content = `🌐 **WEEKLY EMSC ANALYTICS** 🌐\n📅 **Week:** ${fmtDate(start)} — ${fmtDate(e)} (UTC)\n\n_No quakes M≥${isNaN(minMag) ? 1 : minMag} this week._\n\n*Source: EMSC-CSEM*`;
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).catch(() => {});
    return `weekly no data M>=${minMag}`;
  }
  let maxMag = -1,
    maxFeat = null,
    sumDepth = 0,
    cnt45 = 0,
    cnt60 = 0,
    cnt70 = 0;
  const regionCount = new Map(),
    authCount = new Map();
  for (const f of feats) {
    const m = f.properties.mag;
    if (m > maxMag) {
      maxMag = m;
      maxFeat = f;
    }
    sumDepth += f.properties.depth;
    if (m >= 4.5) cnt45++;
    if (m >= 6) cnt60++;
    if (m >= 7) cnt70++;
    const r = f.properties.flynn_region || "Unknown";
    regionCount.set(r, (regionCount.get(r) || 0) + 1);
    const a = f.properties.auth || "EMSC";
    authCount.set(a, (authCount.get(a) || 0) + 1);
  }
  const avgDepth = Math.round(sumDepth / feats.length);
  const topRegions = [...regionCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} — ${v}`)
    .join("\n");
  const topAuth = [...authCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${v}`)
    .join("  •  ");
  const maxLine = maxFeat
    ? `M${maxFeat.properties.mag.toFixed(1)} (${maxFeat.properties.magtype}) — ${maxFeat.properties.flynn_region} — ${maxFeat.properties.auth}`
    : "—";
  const weekLabel = `${fmtDate(start)} — ${fmtDate(e)}`;
  const isBig = maxMag >= 7,
    mention = isBig ? "@everyone " : "",
    color =
      maxMag >= 6
        ? 0xef4444
        : maxMag >= 5
          ? 0xf59e0b
          : maxMag >= 4.5
            ? 0x3b82f6
            : 0x10b981;
  const content = `${mention}🌐 **WEEKLY EMSC ANALYTICS** 🌐\n📅 **Week:** ${weekLabel} (UTC)\n\n📊 **Overview**\n• Total quakes (global M≥${isNaN(minMag) ? 1 : minMag}): **${feats.length}**\n• M≥4.5: **${cnt45}**  • M≥6.0: **${cnt60}**  • M≥7.0: **${cnt70}**${isBig ? " @everyone" : ""}\n• Max: ${maxLine}\n• Avg depth: **${avgDepth} km**\n\n🌍 **Top Regions**\n${topRegions || "—"}\n\n🏛️ **Authorities**\n${topAuth || "—"}\n\n📡 **Source:** EMSC-CSEM (CC BY 4.0) • Next: Mon 08:00 UTC`;
  const payload = {
    content,
    ...(isBig ? { allowed_mentions: { parse: ["everyone"] } } : {}),
    embeds: [
      {
        title: `🌐 Weekly EMSC — ${fmtDate(start)} → ${fmtDate(e)}`,
        description: `M≥${isNaN(minMag) ? 1 : minMag} global • ${feats.length} quakes • Max ${maxMag.toFixed(1)}`,
        color,
        fields: [
          {
            name: "M≥4.5 / ≥6 / ≥7",
            value: `${cnt45} / ${cnt60} / ${cnt70}`,
            inline: true,
          },
          { name: "Avg depth", value: `${avgDepth} km`, inline: true },
          {
            name: "Top region",
            value: topRegions.split("\n")[0] || "—",
            inline: false,
          },
        ],
        footer: {
          text: `TerraGuard Weekly • EMSC-CSEM • ${fmtDate(e)} ${fmtTime(e)}`,
        },
        timestamp: new Date().toISOString(),
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
    throw new Error(`Weekly webhook ${res.status}: ${t.slice(0, 500)}`);
  }
  return `weekly sent ${feats.length} quakes Max M${maxMag.toFixed(1)}`;
}
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return new Response("ok weekly-emsc", { headers: CORS });
    const auth = request.headers.get("Authorization") || "";
    const expected = env.CRON_SECRET ? `Bearer ${env.CRON_SECRET}` : "";
    const ok = expected && auth === expected;
    if (
      ok &&
      (url.pathname === "/trigger" || url.pathname === "/cron-weekly")
    ) {
      try {
        const msg = await handleWeekly(env);
        return new Response(
          JSON.stringify({
            success: true,
            source: "EMSC-weekly",
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
  async scheduled(_e, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          console.log(`[cron][weekly-emsc] ${await handleWeekly(env)}`);
        } catch (e) {
          console.error("[cron][weekly-emsc] failed", e);
        }
      })(),
    );
  },
};
