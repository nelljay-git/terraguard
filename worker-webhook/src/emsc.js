/**
 * EMSC JS version for dashboard paste (separate Worker terraguard-emsc)
 */
const CORS={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET, OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization" };
const UTC_MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
function formatUtc(d){ return `${d.getUTCDate()} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} - ${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}:${String(d.getUTCSeconds()).padStart(2,"0")} UTC`; }
function formatUstFromMs(ms){ const d=new Date(ms); const dateStr=`${String(d.getUTCDate()).padStart(2,"0")} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; let h=d.getUTCHours(); const m=String(d.getUTCMinutes()).padStart(2,"0"); const ampm=h>=12?"PM":"AM"; h=h%12||12; return {date:dateStr,time:`${String(h).padStart(2,"0")}:${m} ${ampm} UST`}; }
function eqId(datetime, lat, lng){ return btoa(`${datetime}-${lat}-${lng}`).replace(/=/g,""); }
function color(m){ if(m<3) return "#10b981"; if(m<4) return "#3b82f6"; if(m<5) return "#f59e0b"; if(m<6) return "#ef4444"; return "#7f1d1d"; }
async function fetchLatestEmsc(env){
  const minMag=parseFloat(env.EMSC_MIN_MAG||"1.0");
  const minLat=parseFloat(env.EMSC_MIN_LAT||"-90"), maxLat=parseFloat(env.EMSC_MAX_LAT||"90"), minLng=parseFloat(env.EMSC_MIN_LNG||"-180"), maxLng=parseFloat(env.EMSC_MAX_LNG||"180");
  const params=new URLSearchParams({format:"json",limit:"20",orderby:"time"});
  if(!isNaN(minMag)) params.set("minmag", String(minMag));
  const isGlobal=minLat===-90 && maxLat===90 && minLng===-180 && maxLng===180;
  if(!isGlobal){ if(!isNaN(minLat)) params.set("minlatitude",String(minLat)); if(!isNaN(maxLat)) params.set("maxlatitude",String(maxLat)); if(!isNaN(minLng)) params.set("minlongitude",String(minLng)); if(!isNaN(maxLng)) params.set("maxlongitude",String(maxLng)); }
  const url=`https://www.seismicportal.eu/fdsnws/event/1/query?${params}`;
  const r=await fetch(url,{headers:{"User-Agent":"TerraGuard-EMSC/1.0"}});
  if(r.status===204) return null;
  if(!r.ok) throw new Error(`EMSC ${r.status}`);
  const j=await r.json();
  const feats=j.features||[];
  if(feats.length===0) return null;
  feats.sort((a,b)=> new Date(b.properties.time).getTime() - new Date(a.properties.time).getTime());
  const f=feats[0], p=f.properties;
  const lat=p.lat, lon=p.lon, depth=p.depth, mag=p.mag;
  const datetime=formatUtc(new Date(p.time));
  const latStr=(Math.round(lat*100)/100).toFixed(2), lonStr=(Math.round(lon*100)/100).toFixed(2), depthStr=String(Math.round(depth)), magStr=(Math.round(mag*10)/10).toFixed(1), timeMs=new Date(p.time).getTime();
  return { datetime, latitude:latStr, longitude:lonStr, depth:depthStr, magnitude:magStr, location:p.flynn_region, link:`https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${p.source_id}`, unid:f.id, source_id:p.source_id, auth:p.auth, magtype:p.magtype, timeMs };
}
async function sendEmscWebhook(eq, env){
  const wh=env.EMSC_WEBHOOK_URL; if(!wh) throw new Error("EMSC_WEBHOOK_URL not set");
  const lat=parseFloat(eq.latitude), lng=parseFloat(eq.longitude), hasCoords=!isNaN(lat)&&!isNaN(lng);
  const {date,time}=formatUstFromMs(eq.timeMs);
  const epicenterImage=hasCoords?`https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=7&size=600,400&l=map&pt=${lng},${lat},pm2rdm`:`https://terraguard.pages.dev/pwa-512x512.png`;
  const mag=parseFloat(eq.magnitude), hex=color(isNaN(mag)?5:mag).replace("#",""), embedColor=parseInt(hex.length===3?hex.split("").map(c=>c+c).join(""):hex,16)||0x3b82f6;
  const magNum=parseFloat(eq.magnitude), mention=magNum>=7?"@everyone ":"";
  const content=`${mention}🌐 **EMSC EARTHQUAKE ALERT** 🌐\n\n💥 **M${eq.magnitude} (${eq.magtype})** earthquake near **${eq.location}**.\n\n📅 **Date:** ${date}\n⏰ **Time:** ${time}\n📏 **Depth:** ${eq.depth} km\n📍 **Epicenter:** ${eq.location}\n🌐 **Coordinates:** ${eq.latitude}°N, ${eq.longitude}°E\n🏛️ **Authority:** ${eq.auth}\n\n📡 **Source:** EMSC-CSEM (${eq.unid})\n\n❓ **Did you feel it?** React ✅ for Yes, ❎ for No`;
  const payload={ content, allowed_mentions:{parse:["everyone"]}, embeds:[{ title:`🌐 M${eq.magnitude} — ${eq.location}`, description:`[View on EMSC](https://www.emsc-csem.org/Earthquake_information/earthquake.php?id=${eq.source_id}) • [View on TerraGuard](https://terraguard-ph.pages.dev/details/${eqId(eq.datetime, eq.latitude, eq.longitude)})`, color:embedColor, image:{url:epicenterImage}, footer:{text:`TerraGuard • EMSC-CSEM • ${date} ${time}`}, timestamp:new Date(eq.timeMs).toISOString() }] };
  const waitUrl=wh.includes("?")?`${wh}&wait=true`:`${wh}?wait=true`;
  const res=await fetch(waitUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error(`EMSC webhook ${res.status}: ${t.slice(0,500)}`);}
  try{ const msg=await res.json(); if(msg?.id){ const m=/\/webhooks\/(\d+)\/([^/?]+)/.exec(wh); if(m){ const whId=m[1],whToken=m[2]; for(const e of ["%E2%9C%85","%E2%9D%8E"]){ await fetch(`https://discord.com/api/webhooks/${whId}/${whToken}/messages/${msg.id}/reactions/${e}/@me`,{method:"PUT"}).catch(()=>{}); await new Promise(r=>setTimeout(r,300)); } } } }catch{}
}
async function handleCron(env){
  const latest=await fetchLatestEmsc(env);
  if(!latest) return "no EMSC data (no quake >= threshold)";
  const dedupKey=`emsc:${latest.unid}`; const last=await env.WEBHOOK_KV.get("last_emsc_id"); const already=await env.WEBHOOK_KV.get(`sent:${dedupKey}`); if(already||last===dedupKey) return `duplicate ${dedupKey}`;
  await sendEmscWebhook(latest, env);
  await env.WEBHOOK_KV.put("last_emsc_id", dedupKey);
  await env.WEBHOOK_KV.put(`sent:${dedupKey}`, JSON.stringify({...latest, sentAt:new Date().toISOString()}), {expirationTtl:60*60*24*30});
  return `sent ${dedupKey} M${latest.magnitude} ${latest.location}`;
}
export default{
  async fetch(request, env){
    if(request.method==="OPTIONS") return new Response(null,{headers:CORS});
    const url=new URL(request.url);
    if(url.pathname==="/health") return new Response("ok emsc",{headers:CORS});
    const auth=request.headers.get("Authorization")||"";
    const expected=env.CRON_SECRET?`Bearer ${env.CRON_SECRET}`:"";
    const ok=expected&&auth===expected;
    if(ok && (url.pathname==="/trigger"||url.pathname==="/cron-emsc")){
      try{ const msg=await handleCron(env); return new Response(JSON.stringify({success:true,source:"EMSC",message:msg}),{headers:{"Content-Type":"application/json",...CORS}});}
      catch(e){ return new Response(JSON.stringify({success:false,error:String(e)}),{status:500,headers:{"Content-Type":"application/json",...CORS}});}
    }
    return new Response("Not Found",{status:404,headers:CORS});
  },
  async scheduled(_e, env, ctx){ ctx.waitUntil((async()=>{ try{ console.log(`[cron][EMSC] ${await handleCron(env)}`);}catch(e){ console.error("[cron][EMSC] failed",e);} })()); },
};
