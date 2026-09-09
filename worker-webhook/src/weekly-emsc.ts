/**
 * Cloudflare Worker — Weekly EMSC Analytics (separate file, private)
 * ESMC preferred, global M1.0 default, Mondays 08:00 UTC
 * Sends detailed weekly embed to WEEKLY_ANALYTICS_WEBHOOK_URL
 * Public fetch returns 404. Only Cron (scheduled) can trigger.
 */

export interface Env {
  WEEKLY_ANALYTICS_WEBHOOK_URL: string;
  WEBHOOK_KV: KVNamespace;
  BOT_TOKEN?: string; // optional, for future poll aggregation
  CRON_SECRET?: string;
  EMSC_MIN_MAG?: string; // default 1.0
}

const CORS = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET, OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization" };
const UTC_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function fmtDate(d: Date){ return `${String(d.getUTCDate()).padStart(2,"0")} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function fmtTime(d: Date){ let h=d.getUTCHours(); const m=String(d.getUTCMinutes()).padStart(2,"0"); const ampm=h>=12?"PM":"AM"; h=h%12||12; return `${String(h).padStart(2,"0")}:${m} ${ampm} UTC`; }

async function fetchEmscWeek(start: Date, end: Date, minMag: number){
  const params = new URLSearchParams({
    format:"json", limit:"20000", orderby:"time",
    starttime: start.toISOString(), endtime: end.toISOString(),
  });
  if(!isNaN(minMag)) params.set("minmag", String(minMag));
  const r = await fetch(`https://www.seismicportal.eu/fdsnws/event/1/query?${params}`, { headers:{ "User-Agent":"TerraGuard-Weekly-EMSC/1.0" }});
  if(r.status===204) return [];
  if(!r.ok) throw new Error(`EMSC ${r.status}`);
  const j = await r.json() as { features: Array<{ id:string; properties:{ time:string; mag:number; magtype:string; flynn_region:string; auth:string; depth:number; lat:number; lon:number } }> };
  return j.features || [];
}

async function handleWeekly(env: Env): Promise<string>{
  const webhook = env.WEEKLY_ANALYTICS_WEBHOOK_URL;
  if(!webhook) throw new Error("WEEKLY_ANALYTICS_WEBHOOK_URL not set");
  const minMag = parseFloat(env.EMSC_MIN_MAG || "1.0");
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0)); // Monday 08:00 UTC = end of week
  // Find last Monday 08:00
  let dow = end.getUTCDay(); // 0 Sun ..1 Mon
  let diff = dow === 1 ? 0 : dow === 0 ? 6 : dow - 1;
  // If today is Monday but before 08:00, go to previous Monday
  if(dow === 1 && now.getUTCHours() < 8) diff = 7;
  // Actually we want last completed week Mon->Mon, not including today if today is Monday 08:00 exactly
  // Simpler: week = last 7 days ending now
  const weekStart = new Date(end.getTime() - 7*24*3600*1000);
  const weekEnd = end;
  // If we are not Monday, adjust to last Monday
  // For manual trigger, just use last 7 days from now
  const start = new Date(now.getTime() - 7*24*3600*1000);
  const e = new Date(now.getTime());
  const feats = await fetchEmscWeek(start, e, minMag);
  if(feats.length===0){
    const content = `🌐 **WEEKLY EMSC ANALYTICS** 🌐\n📅 **Week:** ${fmtDate(start)} — ${fmtDate(e)} (UTC)\n\n_No quakes M≥${isNaN(minMag)?1:minMag} this week._\n\n*Source: EMSC-CSEM*`;
    await fetch(webhook, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ content }) }).catch(()=>{});
    return `weekly no data M>=${minMag}`;
  }
  let maxMag = -1, maxFeat: typeof feats[number] | null = null;
  let sumDepth = 0, cnt45=0, cnt60=0, cnt70=0;
  const regionCount = new Map<string, number>();
  const authCount = new Map<string, number>();
  for(const f of feats){
    const m = f.properties.mag;
    if(m > maxMag){ maxMag=m; maxFeat=f; }
    sumDepth += f.properties.depth;
    if(m>=4.5) cnt45++;
    if(m>=6) cnt60++;
    if(m>=7) cnt70++;
    const r = f.properties.flynn_region || "Unknown";
    regionCount.set(r, (regionCount.get(r)||0)+1);
    const a = f.properties.auth || "EMSC";
    authCount.set(a, (authCount.get(a)||0)+1);
  }
  const avgDepth = Math.round(sumDepth / feats.length);
  const topRegions = [...regionCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k} — ${v}`).join("\n");
  const topAuth = [...authCount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k,v])=>`${k}: ${v}`).join("  •  ");
  const maxLine = maxFeat ? `**M${maxFeat.properties.mag.toFixed(1)} (${maxFeat.properties.magtype})** — ${maxFeat.properties.flynn_region} — ${maxFeat.properties.auth}` : "—";
  const weekLabel = `${fmtDate(start)} — ${fmtDate(e)}`;
  const isBig = maxMag >= 7;
  const mention = isBig ? "@everyone " : "";
  const color = maxMag >= 6 ? 0xef4444 : maxMag >=5 ? 0xf59e0b : maxMag >=4.5 ? 0x3b82f6 : 0x10b981;

  const content = `${mention}🌐 **WEEKLY EMSC ANALYTICS** 🌐
📅 **Week:** ${weekLabel} (UTC)

📊 **Overview**
• Total quakes (global M≥${isNaN(minMag)?1:minMag}): **${feats.length}**
• M≥4.5: **${cnt45}**  • M≥6.0: **${cnt60}**  • M≥7.0: **${cnt70}**${isBig?" @everyone":""}
• Max: ${maxLine}
• Avg depth: **${avgDepth} km**

🌍 **Top Regions**
${topRegions || "—"}

🏛️ **Authorities**
${topAuth || "—"}

📡 **Source:** EMSC-CSEM (CC BY 4.0) • Next: Mon 08:00 UTC`;

  const payload = {
    content,
    allowed_mentions: isBig ? { parse: ["everyone"] } : undefined,
    embeds: [{
      title: `🌐 Weekly EMSC — ${fmtDate(start)} → ${fmtDate(e)}`,
      description: `M≥${isNaN(minMag)?1:minMag} global • ${feats.length} quakes • Max ${maxMag.toFixed(1)}`,
      color,
      fields: [
        { name: "M≥4.5 / ≥6 / ≥7", value: `${cnt45} / ${cnt60} / ${cnt70}`, inline: true },
        { name: "Avg depth", value: `${avgDepth} km`, inline: true },
        { name: "Top region", value: topRegions.split("\n")[0] || "—", inline: false },
      ],
      footer: { text: `TerraGuard Weekly • EMSC-CSEM • ${fmtDate(e)} ${fmtTime(e)}` },
      timestamp: new Date().toISOString(),
    }],
  };

  const waitUrl = webhook.includes("?") ? `${webhook}&wait=true` : `${webhook}?wait=true`;
  const res = await fetch(waitUrl, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
  if(!res.ok){ const t=await res.text().catch(()=>""); throw new Error(`Weekly webhook ${res.status}: ${t.slice(0,500)}`); }
  return `weekly sent ${feats.length} quakes Max M${maxMag.toFixed(1)}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response>{
    if(request.method==="OPTIONS") return new Response(null,{headers:CORS});
    const url=new URL(request.url);
    if(url.pathname==="/health") return new Response("ok weekly-emsc",{headers:CORS});
    const auth=request.headers.get("Authorization")||"";
    const expected=env.CRON_SECRET?`Bearer ${env.CRON_SECRET}`:"";
    const ok=expected&&auth===expected;
    if(ok && (url.pathname==="/trigger" || url.pathname==="/cron-weekly")){
      try{ const msg=await handleWeekly(env); return new Response(JSON.stringify({success:true,source:"EMSC-weekly",message:msg}),{headers:{"Content-Type":"application/json",...CORS}});}
      catch(e){ return new Response(JSON.stringify({success:false,error:String(e)}),{status:500,headers:{"Content-Type":"application/json",...CORS}});}
    }
    return new Response("Not Found",{status:404,headers:CORS});
  },
  async scheduled(_e: ScheduledEvent, env: Env, ctx: ExecutionContext){
    ctx.waitUntil((async()=>{ try{ console.log(`[cron][weekly-emsc] ${await handleWeekly(env)}`);}catch(e){ console.error("[cron][weekly-emsc] failed",e);} })());
  },
};
