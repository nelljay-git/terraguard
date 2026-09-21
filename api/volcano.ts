// @ts-nocheck
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const VOLCANO_HUB = "https://wovodat.phivolcs.dost.gov.ph/bulletin/list-of-bulletin";
const VOLCANO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
const FETCH_TIMEOUT = 10000;
const CACHE_TTL_MS = 10 * 60 * 1000;

type CacheEntry = { ts: number; payload: any };
const cache = new Map<string, CacheEntry>();

function getCache(key: string): any | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts >= CACHE_TTL_MS) return null;
  return e.payload;
}
function getCacheAny(key: string): any | null {
  const e = cache.get(key);
  return e ? e.payload : null;
}
function setCache(key: string, payload: any) {
  cache.set(key, { ts: Date.now(), payload });
}

async function fetchVolcanoPage(targetUrl: string): Promise<{ ok: boolean; body: string | null; error: string }> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(targetUrl, {
      headers: { "User-Agent": VOLCANO_UA, Accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, body: null, error: `PHIVOLCS responded with ${res.status}` };
    const body = await res.text();
    return { ok: true, body, error: "" };
  } catch (e: any) {
    return { ok: false, body: null, error: e?.message || "Unable to reach PHIVOLCS" };
  }
}

function resolveLink(href: string, pageUrl: string): string {
  href = href.trim();
  if (!href || href[0] === "#") return "";
  if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(href)) return href;
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return href;
  }
}
function capText(s: string, max: number): string {
  if (s.length > max) return s.slice(0, max) + "…";
  return s;
}
function stripText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHub(html: string, pageUrl: string): { issued: string; items: any[] } {
  const text = stripText(html);

  // Alert Level Status ticker
  const levels: Record<string, number> = {};
  const levelRe = /([A-Za-z ]+?)\s*-\s*([0-5])/g;
  let m: RegExpExecArray | null;
  while ((m = levelRe.exec(text)) !== null) {
    const name = m[1].trim().toUpperCase();
    if (name.length >= 3 && name.length <= 20 && levels[name] === undefined) {
      if (["TAAL", "KANLAON", "BULUSAN", "PINATUBO", "MAYON"].includes(name)) {
        levels[name] = parseInt(m[2], 10);
      }
    }
  }

  const items: any[] = [];
  const codes: Record<string, string> = { tvo: "TAAL", kvo: "KANLAON", bvo: "BULUSAN", mvo: "MAYON", pvo: "PINATUBO" };
  const seenVolcano: Record<string, boolean> = {};

  // Find all bulletin links: /bulletin/activity-xxx?bid=NNNN
  const linkRe = /href=["']([^"']*\/bulletin\/activity-([a-z]+)\?bid=(\d+)[^"']*)["']/gi;
  const linkMatches: Array<{ href: string; code: string; bid: string; isEn: boolean; title: string }> = [];
  // Also capture anchor text for lang detection
  const anchorRe = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  while ((am = anchorRe.exec(html)) !== null) {
    const href = am[1];
    const inner = stripText(am[2]);
    const bm = /\/bulletin\/activity-([a-z]+)\?bid=(\d+)/i.exec(href);
    if (!bm) continue;
    const code = bm[1].toLowerCase();
    if (!codes[code]) continue;
    const isEn = /Summary of 24Hr/i.test(inner) || /lang=en/i.test(href);
    linkMatches.push({ href, code, bid: bm[2], isEn, title: inner });
  }

  for (const lm of linkMatches) {
    const volcano = codes[lm.code];
    if (seenVolcano[volcano] && !lm.isEn) continue;
    if (seenVolcano[volcano] && lm.isEn) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].volcano === volcano) { items.splice(i, 1); break; }
      }
    }
    seenVolcano[volcano] = true;
    const hrefWithLang = lm.href.includes("lang=") ? lm.href : lm.href + "&lang=en";
    const url = resolveLink(hrefWithLang, pageUrl);
    const title = lm.title || `${volcano} Bulletin`;
    items.push({
      volcano,
      title: capText(title, 160),
      alertLevel: levels[volcano] ?? null,
      bid: lm.bid,
      url,
    });
    if (items.length >= 10) break;
  }

  // Ensure every known volcano appears even if no bulletin card
  for (const [volcano, lvl] of Object.entries(levels)) {
    if (!items.some((it) => it.volcano === volcano)) {
      items.push({ volcano, title: `${volcano} Volcano Status`, alertLevel: lvl, bid: null, url: pageUrl });
    }
  }

  let issued = "";
  const petsa = /(?:Petsa|Date):\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i.exec(text);
  if (petsa) issued = petsa[1].trim();
  else {
    const dm = /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Enero|Pebrero|Marso|Abril|Mayo|Hunyo|Hulyo|Agosto|Setyembre|Oktubre|Nobyembre|Disyembre)\s+\d{4}\b/i.exec(text);
    if (dm) issued = dm[0].trim();
  }

  return { issued, items };
}

function extractVolcanoDetail(html: string, pageUrl: string): any {
  // Strip style/script/noscript
  let stripped = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  // Prefer the main content block: <div class="content"> ... </div> holds the bulletin.
  // The naive regex is truncated by the first </div>, so we detect that and fall back to whole doc.
  const scopeMatch = stripped.match(/<div[^>]*class=["'][^"']*(?:bulletin|article|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  let scope = scopeMatch ? scopeMatch[1] : stripped;
  if (stripText(scope).length < 200) scope = stripped;

  // Title: prefer orange bulletin header ("MAYON VOLCANO") inside the content
  let title = "";
  const scopeText = stripText(scope);
  const fullTextForTitle = stripText(stripped);
  const titleM = /\b(BULKANG\s+[A-Z]+|MAYON\s+VOLCANO|TAAL\s+VOLCANO|KANLAON\s+VOLCANO|BULUSAN\s+VOLCANO|PINATUBO\s+VOLCANO)\b/i.exec(scopeText) || /\b(BULKANG\s+[A-Z]+|MAYON\s+VOLCANO|TAAL\s+VOLCANO|KANLAON\s+VOLCANO|BULUSAN\s+VOLCANO|PINATUBO\s+VOLCANO)\b/i.exec(fullTextForTitle);
  if (titleM) {
    title = titleM[1].trim();
    title = title.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  } else {
    const tM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (tM) title = stripText(tM[1]);
    const h1M = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(scope);
    if (h1M && stripText(h1M[1])) title = stripText(h1M[1]);
  }

  const text = capText(stripText(scope), 12000);
  // For parametros, isolate the PARAMETERS section to avoid capturing the page header "Volcano Activity"
  const paramsSource = (() => {
    const idx = text.search(/PARAMETERS/i);
    if (idx >= 0) return text.slice(idx);
    return text;
  })();

  let alertLevel: number | null = null;
  const am1 = /ALERT LEVEL\s*([0-5])/i.exec(text);
  if (am1) alertLevel = parseInt(am1[1], 10);
  else {
    const am2 = /ANTAS NG ALERTO\s*([0-5])/i.exec(text);
    if (am2) alertLevel = parseInt(am2[1], 10);
  }

  let issued = "";
  const im1 = /Petsa:\s*([^\n]{4,60}\d{4})/i.exec(text);
  if (im1) issued = im1[1].trim();
  else {
    const im2 = /Date:\s*([^\n]{4,60}\d{4})/i.exec(text);
    if (im2) issued = im2[1].trim();
    else {
      const im3 = /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Enero|Pebrero|Marso|Abril|Mayo|Hunyo|Hulyo|Agosto|Setyembre|Oktubre|Nobyembre|Disyembre)\s+\d{4}\b/i.exec(text);
      if (im3) issued = im3[0].trim();
    }
  }

  const parametros: Record<string, string> = {};
  const labels: Record<string, RegExp> = {
    seismicity: /Seismicity\s*([^\n]+?)(?=\s*(?:Banaag|Crater glow|Sulfur|Plume|Ground|Earthquake Location|Total no\.|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
    craterGlow: /(?:Banaag|Crater glow)\s*([^\n]+?)(?=\s*(?:Sulfur|Plume|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
    so2: /Sulfur Dioxide Flux\s*([^\n]+?)(?=\s*(?:Plume|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
    plume: /Plume\s*([^\n]+?)(?=\s*(?:Ground Deformation|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
    groundDeformation: /Ground Deformation\s*([^\n]+?)(?=\s*(?:Earthquake Location|Total no\.|Rekomendasyon|RECOMMENDATION|Paalala|Lokasyon|Additional information|Department of Science|$))/is,
    eruption: /Eruption\s*([^\n]+?)(?=\s*(?:Activity|Aktibidad|Seismicity|Banaag|Sulfur|Plume|Ground|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
    activity: /Activity\s*([^\n]+?)(?=\s*(?:Seismicity|Banaag|Sulfur|Plume|Ground|Earthquake Location|Rekomendasyon|RECOMMENDATION|Paalala|$))/is,
  };
  for (const [k, pat] of Object.entries(labels)) {
    const src = (k === 'eruption' || k === 'activity') ? text : paramsSource;
    const mm = pat.exec(src);
    if (mm) {
      let val = mm[1].trim().replace(/\s+/g, " ");
      // Hard trim any leaked legend/footer that survived the lookahead
      val = val.split(/Earthquake Location:/i)[0].trim();
      val = val.split(/Total no\. of volcanic earthquake/i)[0].trim();
      val = val.split(/RECOMMENDATION\/COMMENT/i)[0].trim();
      val = val.split(/Rekomendasyon/i)[0].trim();
      // Filter garbage from header captures (e.g. "MAYON VOLCANO Summary..." when activity matched the header)
      if (k === 'activity' && /Volcano Activity|Summary of 24Hr/i.test(val) && val.length > 80) continue;
      if (k === 'eruption' && val.length > 400) continue;
      if (val.length < 2) continue;
      // Keep values concise — the legend/footer should never be part of a param
      if (val.length > 240) val = val.slice(0, 240).trim() + '…';
      parametros[k] = val;
    }
  }
  if (!parametros["activity"] && /2 pagbuga[^\n]+/i.test(paramsSource)) {
    const mm = /2 pagbuga[^\n]+/i.exec(paramsSource);
    if (mm) parametros["activity"] = mm[0].trim();
  }
  if (!parametros["seismicity"] && /23 volcanic[^\n]+/i.test(paramsSource)) {
    const mm = /23 volcanic[^\n]+/i.exec(paramsSource);
    if (mm) parametros["seismicity"] = mm[0].trim();
  }

  const links: string[] = [];
  const seen = new Set<string>();
  const anchorSrcRe = /<(?:a[^>]*href|img[^>]*src)=["']([^"']+)["']/gi;
  let lm: RegExpExecArray | null;
  while ((lm = anchorSrcRe.exec(scope)) !== null) {
    const raw = lm[1];
    const url = resolveLink(raw, pageUrl);
    if (!url || seen.has(url)) continue;
    if (/bulletinMap\//i.test(url) || /\.(jpg|png)(\?|#|$)/i.test(url)) { seen.add(url); links.push(url); }
    else if (/phivolcs/i.test(url) || /wovodat/i.test(url)) { seen.add(url); links.push(url); }
    if (links.length >= 20) break;
  }

  return { title: capText(title, 200), alertLevel, issued, text, parametros, links };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ success: false, count: 0, data: [], error: "Method not allowed" });

  const page = (req.query.page as string) ? String(req.query.page).toLowerCase().trim() : "hub";
  const detailUrl = (req.query.url as string) || "";
  const isDetail = req.query.detail === "1" || req.query.detail === "true";

  if (isDetail && detailUrl) {
    const cacheKey = `detail:${detailUrl}`;
    const cached = getCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    const scrape = await fetchVolcanoPage(detailUrl);
    if (!scrape.ok || !scrape.body) {
      const stale = getCacheAny(cacheKey);
      if (stale) return res.status(200).json(stale);
      return res.status(200).json({ success: false, count: 0, data: [], error: scrape.error });
    }
    // Validate we actually got a detail page, not the hub (hub contains "Visitors:" + "Alert Level Status:" but no "Summary of 24Hr Observation")
    const isDetailHtml = /Summary of 24Hr Observation/i.test(scrape.body) && /ALERT LEVEL/i.test(scrape.body);
    const isHubHtml = /Alert Level Status:/i.test(scrape.body) && /Visitors:/i.test(scrape.body) && !isDetailHtml;
    if (isHubHtml) {
      return res.status(200).json({ success: false, count: 0, data: [], error: 'Upstream returned hub instead of bulletin detail — invalid bid or wovodat redirect' });
    }
    if (!isDetailHtml && !/PARAMETERS/i.test(scrape.body)) {
      return res.status(200).json({ success: false, count: 0, data: [], error: 'Unexpected HTML — not a volcano bulletin' });
    }
    try {
      const detail = extractVolcanoDetail(scrape.body, detailUrl);
      let altUrl = "";
      if (/lang=en/i.test(detailUrl)) altUrl = detailUrl.replace(/[&?]lang=en/i, "");
      else altUrl = detailUrl + (detailUrl.includes("?") ? "&lang=en" : "?lang=en");
      let altDetail: any = null;
      if (altUrl && altUrl !== detailUrl) {
        const altScrape = await fetchVolcanoPage(altUrl);
        if (altScrape.ok && altScrape.body) {
          try { altDetail = extractVolcanoDetail(altScrape.body, altUrl); } catch {}
        }
      }
      const isEn = /lang=en/i.test(detailUrl);
      if (altDetail) {
        detail.parametros_en = isEn ? detail.parametros ?? [] : altDetail.parametros ?? [];
        detail.parametros_fil = isEn ? altDetail.parametros ?? [] : detail.parametros ?? [];
        detail.text_en = isEn ? detail.text ?? "" : altDetail.text ?? "";
        detail.text_fil = isEn ? altDetail.text ?? "" : detail.text ?? "";
        detail.title_en = isEn ? detail.title ?? "" : altDetail.title ?? "";
        detail.title_fil = isEn ? altDetail.title ?? "" : detail.title ?? "";
      }
      const payload = { success: true, count: 1, data: detail };
      setCache(cacheKey, payload);
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate");
      return res.status(200).json(payload);
    } catch (e: any) {
      return res.status(500).json({ success: false, count: 0, data: [], error: "extractDetail: " + (e?.message || String(e)) });
    }
  }

  const pages: Record<string, string> = { hub: VOLCANO_HUB, bulletin: VOLCANO_HUB };
  if (!pages[page]) {
    return res.status(400).json({ success: false, count: 0, data: [], error: `Unknown page. Valid: ${Object.keys(pages).join(", ")}` });
  }
  const source = pages[page];
  const cacheKey = `page:${page}`;
  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    return res.status(200).json(cached);
  }

  const scrape = await fetchVolcanoPage(source);
  if (!scrape.ok || !scrape.body) {
    const stale = getCacheAny(cacheKey);
    if (stale) {
      res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
      return res.status(200).json(stale);
    }
    return res.status(200).json({ success: false, count: 0, data: [], error: scrape.error, page, source });
  }

  try {
    const result = extractHub(scrape.body, source);
    const payload = { success: true, page, source, issued: result.issued, count: result.items.length, data: result.items };
    setCache(cacheKey, payload);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate");
    return res.status(200).json(payload);
  } catch (e: any) {
    return res.status(500).json({ success: false, count: 0, data: [], error: "extract: " + (e?.message || String(e)) });
  }
}
