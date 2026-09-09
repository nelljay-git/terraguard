/**
 * On This Day JS for dashboard paste (USGS)
 */
const CORS={ "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"GET, OPTIONS", "Access-Control-Allow-Headers":"Content-Type, Authorization" };
const UTC_MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
function fmtDate(d){ return `${String(d.getUTCDate()).padStart(2,"0")} ${UTC_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function fmtTime(d){ let h=d.getUTCHours(); const m=String(d.getUTCMinutes()).padStart(2,"0"); const ampm=h>=12?"PM":"AM"; h=h%12||12; return `${String(h).padStart(2,"0")}:${m} ${ampm} UTC`; }
async function fetchOtdCandidates(now, minMag, yearsBack){
  const mm=now.getUTCMonth(), dd=now.getUTCDate();
  const cands=[];
  for(let y=now.getUTCFullYear()-1; y>=now.getUTCFullYear()-yearsBack; y--){
    const start=new Date(Date.UTC(y,mm,dd,0,0,0)), end=new Date(Date.UTC(y,mm,dd,23,59,59));
    if(start.getUTCMonth()!==mm) continue;
    const params=new URLSearchParams({format:"geojson",starttime:start.toISOString(),endtime:end.toISOString(),minmagnitude:String(minMag),orderby:"magnitude",limit:"5"});
    try{
      const r=await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params}`,{headers:{"User-Agent":"TerraGuard-OTD/1.0"}});
      if(r.status===204) continue;
      if(!r.ok) continue;
      const j=await r.json();
      for(const f of j.features||[]){ cands.push({id:f.id,mag:f.properties.mag,place:f.properties.place,time:f.properties.time,url:f.properties.url,depth:f.geometry.coordinates[2],lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0],year:y}); }
    }catch(e){ console.warn(e); }
    await new Promise(r=>setTimeout(r,200));
  }
  return cands;
}
async function handleOtd(env){
  const webhook=env.CONTENT_WEBHOOK_URL; if(!webhook) throw new Error("CONTENT_WEBHOOK_URL not set");
  const minMag=parseFloat(env.OTD_MIN_MAG||"5.0"), yearsBack=parseInt(env.OTD_YEARS_BACK||"25",10);
  const now=new Date();
  const keyToday=`otd:${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,"0")}-${String(now.getUTCDate()).padStart(2,"0")}`;
  const already=await env.WEBHOOK_KV.get(keyToday); if(already) return `duplicate ${keyToday}`;
  const cands=await fetchOtdCandidates(now,minMag,yearsBack);
  if(cands.length===0){
    const content=`📜 **On This Day — ${String(now.getUTCMonth()+1).padStart(2,"0")}/${String(now.getUTCDate()).padStart(2,"0")}**\n\nNo major (M≥${minMag}) quakes on this day in the last ${yearsBack} years — a quiet anniversary! 🌍\n\n*Source: USGS*`;
    await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({content})}).catch(()=>{});
    await env.WEBHOOK_KV.put(keyToday,"no-data",{expirationTtl:60*60*24*2});
    return `otd no data M>=${minMag}`;
  }
  cands.sort((a,b)=> b.mag - a.mag || b.time - a.time);
  const pick=cands[0], pickDate=new Date(pick.time), age=now.getUTCFullYear()-pickDate.getUTCFullYear();
  const mapUrl=`https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${pick.lon},${pick.lat}&z=5&size=600,400&l=map&pt=${pick.lon},${pick.lat},pm2rdm`;
  const color=pick.mag>=7?0xef4444:pick.mag>=6?0xf59e0b:0x3b82f6;
  const mention=pick.mag>=7?"@everyone ":"";
  const content=`${mention}📜 **On This Day — ${String(now.getUTCMonth()+1).padStart(2,"0")}/${String(now.getUTCDate()).padStart(2,"0")}**\n\n${pick.mag>=7?"🚨":"🌍"} **M${pick.mag.toFixed(1)}** struck **${pick.place}** — **${fmtDate(pickDate)}** (${age} year${age===1?"":"s"} ago)\n\n📅 **Original Date:** ${fmtDate(pickDate)} ${fmtTime(pickDate)}\n📏 **Depth:** ${Math.round(pick.depth)} km\n🌐 **Coordinates:** ${pick.lat.toFixed(2)}°N, ${pick.lon.toFixed(2)}°E\n\n*Source: USGS* • [USGS Event](${pick.url})`;
  const payload={ content, ...(pick.mag>=7?{allowed_mentions:{parse:["everyone"]}}:{}), embeds:[{ title:`📜 On This Day — M${pick.mag.toFixed(1)} — ${pick.place}`, description:`Historical quake from **${pickDate.getUTCFullYear()}** on this calendar day.\n[View on USGS](${pick.url}) • [View on TerraGuard](https://terraguard.pages.dev/archive)`, color, image:{url:mapUrl}, footer:{text:`TerraGuard On This Day • ${fmtDate(pickDate)} • USGS`}, timestamp:pickDate.toISOString() }] };
  const waitUrl=webhook.includes("?")?`${webhook}&wait=true`:`${webhook}?wait=true`;
  const res=await fetch(waitUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error(`OTD webhook ${res.status}: ${t.slice(0,500)}`);}
  try{ const msg=await res.json(); if(msg?.id && env.BOT_TOKEN && msg.channel_id){ for(const e of ["%F0%9F%93%9C","%E2%AD%90"]){ await fetch(`https://discord.com/api/v10/channels/${msg.channel_id}/messages/${msg.id}/reactions/${e}/@me`,{method:"PUT",headers:{Authorization:`Bot ${env.BOT_TOKEN}`}}).catch(()=>{}); await new Promise(r=>setTimeout(r,300)); } } }catch{}
  await env.WEBHOOK_KV.put(keyToday, JSON.stringify(pick), {expirationTtl:60*60*24*30});
  return `otd sent M${pick.mag.toFixed(1)} ${pick.place} ${pickDate.getUTCFullYear()}`;
}
export default{
  async fetch(request, env){
    if(request.method==="OPTIONS") return new Response(null,{headers:CORS});
    const url=new URL(request.url);
    if(url.pathname==="/health") return new Response("ok otd-usgs",{headers:CORS});
    const auth=request.headers.get("Authorization")||"";
    const expected=env.CRON_SECRET?`Bearer ${env.CRON_SECRET}`:"";
    const ok=expected&&auth===expected;
    if(ok && (url.pathname==="/trigger"||url.pathname==="/cron-otd")){
      try{ const msg=await handleOtd(env); return new Response(JSON.stringify({success:true,source:"USGS-OTD",message:msg}),{headers:{"Content-Type":"application/json",...CORS}});}
      catch(e){ return new Response(JSON.stringify({success:false,error:String(e)}),{status:500,headers:{"Content-Type":"application/json",...CORS}});}
    }
    return new Response("Not Found",{status:404,headers:CORS});
  },
  async scheduled(_e, env, ctx){ ctx.waitUntil((async()=>{ try{ console.log(`[cron][otd-usgs] ${await handleOtd(env)}`);}catch(e){ console.error("[cron][otd] failed",e);} })()); },
};
