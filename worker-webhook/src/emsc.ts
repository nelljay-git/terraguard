/**
 * Cloudflare Worker — EMSC Earthquake Cron (separate file from index/tsunami)
 * Source: SeismicPortal FDSNWS https://www.seismicportal.eu/fdsnws/event/1/query?format=json
 * Public fetch returns 404. Only Cron (scheduled) can trigger.
 * Webhook: EMSC_WEBHOOK_URL (or reuse DISCORD_WEBHOOK_URL with different channel)
 */

export interface Env {
  EMSC_WEBHOOK_URL: string;
  WEBHOOK_KV: KVNamespace;
  CRON_SECRET?: string;
  EMSC_MIN_MAG?: string; // default 1.0 global
  EMSC_MIN_LAT?: string; // default -90 global, set 4.5 for PH-only
  EMSC_MAX_LAT?: string;
  EMSC_MIN_LNG?: string;
  EMSC_MAX_LNG?: string;
}

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const UTC_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function formatUtc(date: Date): string {
  return `${date.getUTCDate()} ${UTC_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} - ${String(date.getUTCHours()).padStart(2,"0")}:${String(date.getUTCMinutes()).padStart(2,"0")}:${String(date.getUTCSeconds()).padStart(2,"0")} UTC`;
}
function formatUstFromMs(ms: number){ const d=new Date(ms); const dateStr=`${String(d.getUTCDate()).padStart(2,"0")} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; let h=d.getUTCHours(); const m=String(d.getUTCMinutes()).padStart(2,"0"); const ampm=h>=12?"PM":"AM"; h=h%12||12; return {date:dateStr,time:`${String(h).padStart(2,"0")}:${m} ${ampm} UST`};}
function eqId(datetime:string, lat:string, lng:string){ return btoa(`${datetime}-${lat}-${lng}`).replace(/=/g,""); }
function color(m:number){ if(m<3) return "#10b981"; if(m<4) return "#3b82f6"; if(m<5) return "#f59e0b"; if(m<6) return "#ef4444"; return "#7f1d1d"; }

async function fetchLatestEmsc(env: Env){
  const minMag = parseFloat(env.EMSC_MIN_MAG || "1.0");
  const minLat = parseFloat(env.EMSC_MIN_LAT || "-90");
  const maxLat = parseFloat(env.EMSC_MAX_LAT || "90");
  const minLng = parseFloat(env.EMSC_MIN_LNG || "-180");
  const maxLng = parseFloat(env.EMSC_MAX_LNG || "180");
  const params = new URLSearchParams({ format:"json", limit:"20", orderby:"time" });
  if(!isNaN(minMag)) params.set("minmag", String(minMag));
  // Only add bbox if not global (to reduce query weight)
  const isGlobal = minLat===-90 && maxLat===90 && minLng===-180 && maxLng===180;
  if(!isGlobal){
    if(!isNaN(minLat)) params.set("minlatitude", String(minLat));
    if(!isNaN(maxLat)) params.set("maxlatitude", String(maxLat));
    if(!isNaN(minLng)) params.set("minlongitude", String(minLng));
    if(!isNaN(maxLng)) params.set("maxlongitude", String(maxLng));
  }
  const url = `https://www.seismicportal.eu/fdsnws/event/1/query?${params}`;
  const r = await fetch(url, { headers:{ "User-Agent":"TerraGuard-EMSC/1.0" } });
  if(r.status===204) return null;
  if(!r.ok) throw new Error(`EMSC ${r.status}`);
  const j = await r.json() as { features: Array<{ id:string; properties:{ time:string; lastupdate:string; lat:number; lon:number; depth:number; mag:number; magtype:string; flynn_region:string; auth:string; source_id:string; source_catalog:string }; geometry:{coordinates:[number,number,number]} }> };
  const feats = j.features || [];
  if(feats.length===0) return null;
  feats.sort((a,b)=> new Date(b.properties.time).getTime() - new Date(a.properties.time).getTime());
  const f = feats[0];
  const p = f.properties;
  const lat = p.lat, lon = p.lon, depth = p.depth, mag = p.mag;
  // Verify depth positive km (properties.depth), not coordinates negative metres
  const datetime = formatUtc(new Date(p.time));
  const latStr = (Math.round(lat*100)/100).toFixed(2);
  const lonStr = (Math.round(lon*100)/100).toFixed(2);
  const depthStr = String(Math.round(depth));
  const magStr = (Math.round(mag*10)/10).toFixed(1);
  const timeMs = new Date(p.time).getTime();
  return {
    datetime, latitude: latStr, longitude: lonStr, depth: depthStr, magnitude: magStr,
    location: p.flynn_region, link: `https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${p.source_id}`,
    unid: f.id, source_id: p.source_id, auth: p.auth, magtype: p.magtype, timeMs
  };
}

async function sendEmscWebhook(eq: NonNullable<Awaited<ReturnType<typeof fetchLatestEmsc>>>, env: Env){
  const wh = env.EMSC_WEBHOOK_URL; if(!wh) throw new Error("EMSC_WEBHOOK_URL not set");
  const lat=parseFloat(eq.latitude), lng=parseFloat(eq.longitude);
  const hasCoords=!isNaN(lat)&&!isNaN(lng);
  const {date,time}=formatUstFromMs(eq.timeMs);
  const epicenterImage = hasCoords ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=7&size=600,400&l=map&pt=${lng},${lat},pm2rdm` : `https://terraguard.pages.dev/pwa-512x512.png`;
  const mag=parseFloat(eq.magnitude); const hex=color(isNaN(mag)?5:mag).replace("#",""); const embedColor=parseInt(hex.length===3?hex.split("").map(c=>c+c).join(""):hex,16)||0x3b82f6;
  const content = `🌐 **EMSC EARTHQUAKE ALERT** 🌐

💥 **M${eq.magnitude} (${eq.magtype})** earthquake near **${eq.location}**.

📅 **Date:** ${date}
⏰ **Time:** ${time}
📏 **Depth:** ${eq.depth} km
📍 **Epicenter:** ${eq.location}
🌐 **Coordinates:** ${eq.latitude}°N, ${eq.longitude}°E
🏛️ **Authority:** ${eq.auth}

📡 **Source:** EMSC-CSEM (${eq.unid})

❓ **Did you feel it?** React ✅ for Yes, ❎ for No`;
  const payload={ content, embeds:[{ title:`🌐 M${eq.magnitude} — ${eq.location}`, description:`[View on EMSC](https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${eq.source_id}) • [View on TerraGuard](https://terraguard.pages.dev/details/${eqId(eq.datetime, eq.latitude, eq.longitude)})`, color:embedColor, image:{url:epicenterImage}, footer:{text:`TerraGuard • EMSC-CSEM • ${date} ${time}`}, timestamp:new Date(eq.timeMs).toISOString() }] };
  const waitUrl = wh.includes("?")?`${wh}&wait=true`:`${wh}?wait=true`;
  const res = await fetch(waitUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error(`EMSC webhook ${res.status}: ${t.slice(0,500)}`);}
  try{
    const msg = await res.json() as {id:string};
    if(msg?.id){ const m=/\/webhooks\/(\d+)\/([^/?]+)/.exec(wh); if(m){ const whId=m[1], whToken=m[2]; for(const e of ["%E2%9C%85","%E2%9D%8E"]){ await fetch(`https://discord.com/api/webhooks/${whId}/${whToken}/messages/${msg.id}/reactions/${e}/@me`,{method:"PUT"}).catch(()=>{}); await new Promise(r=>setTimeout(r,300)); } } }
  }catch{}
}

async function handleCron(env: Env){
  const latest = await fetchLatestEmsc(env);
  if(!latest) return "no EMSC data (no quake >= threshold)";
  const dedupKey = `emsc:${latest.unid}`;
  const last = await env.WEBHOOK_KV.get("last_emsc_id");
  const already = await env.WEBHOOK_KV.get(`sent:${dedupKey}`);
  if(already || last===dedupKey) return `duplicate ${dedupKey}`;
  await sendEmscWebhook(latest, env);
  await env.WEBHOOK_KV.put("last_emsc_id", dedupKey);
  await env.WEBHOOK_KV.put(`sent:${dedupKey}`, JSON.stringify({...latest, sentAt:new Date().toISOString()}), {expirationTtl:60*60*24*30});
  return `sent ${dedupKey} M${latest.magnitude} ${latest.location}`;
}

export default{
  async fetch(request: Request, env: Env){
    if(request.method==="OPTIONS") return new Response(null,{headers:CORS});
    const url=new URL(request.url);
    if(url.pathname==="/health") return new Response("ok emsc",{headers:CORS});
    const auth=request.headers.get("Authorization")||"";
    const expected=env.CRON_SECRET?`Bearer ${env.CRON_SECRET}`:"";
    const ok=expected&&auth===expected;
    if(ok && (url.pathname==="/trigger" || url.pathname==="/cron-emsc")){
      try{ const msg=await handleCron(env); return new Response(JSON.stringify({success:true,source:"EMSC",message:msg}),{headers:{"Content-Type":"application/json",...CORS}});}
      catch(e){ return new Response(JSON.stringify({success:false,error:String(e)}),{status:500,headers:{"Content-Type":"application/json",...CORS}});}
    }
    return new Response("Not Found",{status:404,headers:CORS});
  },
  async scheduled(_e: ScheduledEvent, env: Env, ctx: ExecutionContext){
    ctx.waitUntil((async()=>{ try{ console.log(`[cron][EMSC] ${await handleCron(env)}`);}catch(e){ console.error("[cron][EMSC] failed",e);} })());
  },
};
