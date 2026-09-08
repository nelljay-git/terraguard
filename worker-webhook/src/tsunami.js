/**
 * Cloudflare Worker — Tsunami Advisory (JS version for dashboard paste)
 * Paste this as a SEPARATE Worker (terraguard-tsunami), not into index.js
 * Source: tsunami.gov + NWS api.weather.gov/alerts
 */

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };

async function fetchTsunamiAlerts() {
  try {
    const r = await fetch("https://api.weather.gov/alerts?active=1", { headers: { "User-Agent": "TerraGuard-Tsunami/1.0", Accept: "application/geo+json" } });
    if (r.ok) {
      const j = await r.json();
      const feats = (j.features || []).filter(f => /tsunami/i.test(f.properties.event));
      if (feats.length > 0) return feats.map(f => ({ id: f.id || f.properties.id, event: f.properties.event, headline: f.properties.headline, description: f.properties.description, areaDesc: f.properties.areaDesc, sent: f.properties.sent, effective: f.properties.effective, expires: f.properties.expires, link: `https://api.weather.gov/alerts/${encodeURIComponent(f.properties.id)}`, tsunamiGovLink: "https://www.tsunami.gov/" }));
    }
  } catch(e){ console.warn(e); }
  try {
    const r = await fetch("https://www.tsunami.gov/", { headers: { "User-Agent": "TerraGuard-Tsunami/1.0" } });
    if (r.ok) {
      const html = await r.text();
      const linkRe = /href=["']\?p=([^"']+)["'][^>]*>([^<]*Tsunami[^<]*|[^<]*Warning[^<]*|[^<]*Advisory[^<]*)/gi;
      let m; const ids=[];
      while ((m = linkRe.exec(html)) !== null) { ids.push({ id: m[1], event: m[2].trim() }); if(ids.length>=5) break; }
      if(ids.length>0){
        const first=ids[0];
        const detail=await fetch(`https://www.tsunami.gov/?p=${first.id}`, { headers: { "User-Agent": "TerraGuard-Tsunami/1.0" } }).then(x=>x.text()).catch(()=> "");
        const headline=(/Message:\s*([^<\n]+)/i.exec(detail)?.[1]||first.event).trim();
        return [{ id:first.id, event:/Warning/i.test(headline)?"Tsunami Warning":/Advisory/i.test(headline)?"Tsunami Advisory":/Watch/i.test(headline)?"Tsunami Watch":headline, headline, description: detail.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,1200), areaDesc:"See tsunami.gov", sent:new Date().toISOString(), effective:new Date().toISOString(), link:`https://www.tsunami.gov/?p=${first.id}`, tsunamiGovLink:`https://www.tsunami.gov/?p=${first.id}` }];
      }
    }
  } catch(e){ console.warn(e); }
  return [];
}
function tsunamiColor(e){ e=e.toLowerCase(); if(e.includes("warning"))return 0xef4444; if(e.includes("advisory"))return 0xf59e0b; if(e.includes("watch"))return 0x3b82f6; return 0x10b981; }
function tsunamiEmoji(e){ e=e.toLowerCase(); if(e.includes("warning"))return "🚨"; if(e.includes("advisory"))return "⚠️"; if(e.includes("watch"))return "👀"; return "🌊"; }
async function sendTsunamiWebhook(alert, env){
  const webhook=env.TSUNAMI_WEBHOOK_URL; if(!webhook) throw new Error("TSUNAMI_WEBHOOK_URL not set");
  const color=tsunamiColor(alert.event), emoji=tsunamiEmoji(alert.event);
  const sentDate=new Date(alert.sent||alert.effective);
  const dateStr=sentDate.toLocaleDateString("en-US",{timeZone:"UTC",year:"numeric",month:"long",day:"2-digit"});
  const timeStr=sentDate.toLocaleTimeString("en-US",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",hour12:true,timeZoneName:"short"});
  const isThreat=!/no tsunami|no warning.*or threat/i.test(alert.event) && /warning|advisory|watch/i.test(alert.event);
  const mention=isThreat?"@everyone ":"";
  const content=`${mention}${emoji} **TSUNAMI ${alert.event.toUpperCase()}** ${emoji}\n\n**${alert.headline}**\n\n📍 **Areas:** ${alert.areaDesc?.slice(0,400)||"See details"}\n📅 **Issued:** ${dateStr} ${timeStr}\n🔗 **Details:** ${alert.link}\n\n${alert.description?.slice(0,900)||""}\n\n*Source: tsunami.gov / NWS*`;
  const payload={ content, ...(isThreat?{allowed_mentions:{parse:["everyone"]}}:{}), embeds:[{ title:`${emoji} ${alert.event} — ${alert.headline.slice(0,80)}`, description:`${alert.description?.slice(0,1000)||""}\n\n[View on tsunami.gov](${alert.tsunamiGovLink||alert.link})`, color, footer:{text:`TerraGuard Tsunami • ${dateStr} ${timeStr}`}, timestamp:sentDate.toISOString() }] };
  const waitUrl=webhook.includes("?")?`${webhook}&wait=true`:`${webhook}?wait=true`;
  const res=await fetch(waitUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!res.ok){ const t=await res.text().catch(()=> ""); throw new Error(`Tsunami webhook ${res.status}: ${t.slice(0,500)}`);}
  try{ const msg=await res.json(); if(msg?.id){ const emojis=["%F0%9F%8C%8A","%E2%9A%A0%EF%B8%8F"]; if(env.BOT_TOKEN && msg.channel_id){ for(const e of emojis){ await fetch(`https://discord.com/api/v10/channels/${msg.channel_id}/messages/${msg.id}/reactions/${e}/@me`,{method:"PUT",headers:{Authorization:`Bot ${env.BOT_TOKEN}`}}).catch(()=>{}); await new Promise(r=>setTimeout(r,300)); } } else { const m=/\/webhooks\/(\d+)\/([^/?]+)/.exec(webhook); if(m){ const whId=m[1],whToken=m[2]; for(const e of emojis){ await fetch(`https://discord.com/api/webhooks/${whId}/${whToken}/messages/${msg.id}/reactions/${e}/@me`,{method:"PUT"}).catch(()=>{}); await new Promise(r=>setTimeout(r,300)); } } } } }catch{}
}
async function handleCron(env){
  const alerts=await fetchTsunamiAlerts();
  if(alerts.length===0) return "no active tsunami alert (tsunami.gov: No Warning/Advisory/Watch)";
  let sent=0;
  for(const a of alerts){
    const key=`tsunami:${a.id}`; const already=await env.WEBHOOK_KV.get(key); if(already) continue;
    const min=(env.TSUNAMI_MIN_SEVERITY||"").toLowerCase();
    if(min){
      const e=a.event.toLowerCase();
      if(min==="warning" && !e.includes("warning")) continue;
      if(min==="advisory" && !(e.includes("warning")||e.includes("advisory"))) continue;
    }
    await sendTsunamiWebhook(a, env);
    await env.WEBHOOK_KV.put(key, JSON.stringify({...a, sentAt:new Date().toISOString()}), {expirationTtl:60*60*24*7});
    sent++; if(sent>=3) break;
  }
  if(sent===0) return `all ${alerts.length} tsunami alerts already sent`;
  return `sent ${sent} tsunami alert(s): ${alerts.slice(0,sent).map(a=>a.event).join(", ")}`;
}
export default {
  async fetch(request, env){
    if(request.method==="OPTIONS") return new Response(null,{headers:CORS});
    const url=new URL(request.url);
    if(url.pathname==="/health") return new Response("ok tsunami",{headers:CORS});
    const auth=request.headers.get("Authorization")||"";
    const expected=env.CRON_SECRET?`Bearer ${env.CRON_SECRET}`:"";
    const ok=expected&&auth===expected;
    if(ok && (url.pathname==="/trigger"||url.pathname==="/cron-tsunami")){
      try{ const msg=await handleCron(env); return new Response(JSON.stringify({success:true,source:"tsunami.gov",message:msg}),{headers:{"Content-Type":"application/json",...CORS}}); }
      catch(e){ return new Response(JSON.stringify({success:false,error:String(e)}),{status:500,headers:{"Content-Type":"application/json",...CORS}}); }
    }
    return new Response("Not Found",{status:404,headers:CORS});
  },
  async scheduled(_event, env, ctx){ ctx.waitUntil((async()=>{ try{ console.log(`[cron][tsunami] ${await handleCron(env)}`);}catch(e){ console.error("[cron][tsunami] failed",e); } })()); },
};
