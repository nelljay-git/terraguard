// Manual "Post to Facebook" endpoint for the gated button on /details.
// The Page access token MUST NOT ship to browsers, so the browser only
// sends the quake + its Supabase login token; everything secret stays here.
//
// Auth: the caller's Supabase access token is validated against the Auth
// API (anon key is public by design), then the token owner's email must
// match ADMIN_EMAIL (defaults to the site owner). Non-admins get 403 and
// the endpoint can never be abused to post as the Page.
//
// Required Pages env: FB_PAGE_ID, FB_USER_ACCESS_TOKEN, FB_APP_SECRET.
// Optional: ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const FB_GRAPH_VERSION = 'v21.0';
const DEFAULT_ADMIN = 'gianganwneljae@gmail.com';
// Public-by-design values (also in src/lib/supabase.ts); env overrides win.
const DEFAULT_SUPABASE_URL = 'https://qiszvooehbfjteyrfryk.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpc3p2b29laGJmanRleXJmcnlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3Njc5NTIsImV4cCI6MjEwMTM0Mzk1Mn0.mW_DHjAOqu99PlvrkAuc_VO4CQ-EilsJzZClLVaacio';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function esc(s: unknown): string {
  return String(s ?? '').trim();
}

function magPrefix(mag: number): string {
  if (isNaN(mag)) return '';
  if (mag >= 7) return '‼️MAJOR‼️ ';
  if (mag >= 6) return '🟥 ';
  if (mag >= 5) return '🟧 ';
  if (mag >= 4) return '🟨 ';
  if (mag >= 3) return '🟦 ';
  return '🟩 ';
}

function sourceTag(source: string): string {
  const s = source.toLowerCase();
  if (s === 'usgs') return 'USGS';
  if (s === 'emsc') return 'EMSC';
  return 'PHIVOLCS';
}

// PHIVOLCS bulletin number from the bulletin filename:
// ".../2026_0701_0004_B1.html" -> "1", "..._B2F.html" -> "2" (Final).
// "" when the link carries no bulletin marker (then number is omitted).
function infoNoFromLink(link: string): string {
  const m = /B(\d+)F?\.html?(?:[?#]|$)/i.exec(link || '');
  return m ? String(parseInt(m[1], 10)) : '';
}

// Split a Details-page datetime into display parts. PHIVOLCS strings are
// PHT wall time ("14 September 2026 - 05:22 PM"); USGS/EMSC normalized
// strings are UTC ("14 September 2026 - 09:22:15 UTC") and are converted to
// the quake country's local zone when resolvable (labelled), else UTC.
function displayParts(datetime: string, source: string, place: string): { date: string; time: string } {
  const raw = esc(datetime);
  if (sourceTag(source) === 'PHIVOLCS') {
    const m = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*-\s*(\d{1,2}:\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(raw);
    if (!m) return { date: raw, time: '' };
    const ap = (m[3] || '').toUpperCase();
    return { date: m[1].trim(), time: `${m[2]}${ap ? ` ${ap}` : ''} PHT`.trim() };
  }
  const utcFallback = (): { date: string; time: string } => {
    const m = /(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*-\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i.exec(raw);
    if (!m) return { date: raw, time: '' };
    let h = parseInt(m[2], 10);
    const ap = (m[4] || '').toUpperCase();
    if (ap) return { date: m[1].trim(), time: `${h}:${m[3]} ${ap} UTC` };
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return { date: m[1].trim(), time: `${h}:${m[3]} ${ampm} UTC` };
  };
  const ms = utcMsFromDisplay(raw);
  if (ms == null) return utcFallback();
  const iso = locationToIso3(place);
  const tz = iso ? COUNTRY_TZ[iso] : null;
  if (!tz) return utcFallback();
  try {
    const d = new Date(ms);
    return {
      date: new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'long', year: 'numeric' }).format(d),
      time: new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true, timeZoneName: 'short' }).format(d),
    };
  } catch {
    return utcFallback();
  }
}

// "14 September 2026 - 09:22:15 UTC" (or 12h variant) -> UTC epoch ms.
// PHT-suffixed strings are shifted back by +8. Null when unparseable.
function utcMsFromDisplay(datetime: string): number | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*-\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(datetime.trim());
  if (!m) return null;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mi = months.indexOf(m[2].slice(0, 3).toLowerCase());
  if (mi === -1) return null;
  let h = parseInt(m[4], 10);
  const ap = ((m[7] || '') as string).toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  const offMs = /PHT/i.test(datetime) ? 8 * 3600 * 1000 : 0;
  return Date.UTC(parseInt(m[3], 10), mi, parseInt(m[1], 10), h, parseInt(m[5], 10), m[6] ? parseInt(m[6], 10) : 0) - offMs;
}

// Country name -> ISO3, and ISO3 -> representative IANA zone.
// Mirrors worker-webhook/src/earthquake.js and apiphp/quake-card.php.
const COUNTRY_ISO3: Record<string, string> = {
  'PHILIPPINES': 'PHL', 'INDONESIA': 'IDN', 'MALAYSIA': 'MYS', 'JAPAN': 'JPN',
  'TAIWAN': 'TWN', 'CHINA': 'CHN', 'HONG KONG': 'HKG', 'MONGOLIA': 'MNG',
  'SOUTH KOREA': 'KOR', 'KOREA': 'KOR', 'NORTH KOREA': 'PRK', 'THAILAND': 'THA',
  'VIETNAM': 'VNM', 'CAMBODIA': 'KHM', 'LAOS': 'LAO', 'MYANMAR': 'MMR',
  'BANGLADESH': 'BGD', 'BHUTAN': 'BTN', 'NEPAL': 'NPL', 'INDIA': 'IND',
  'PAKISTAN': 'PAK', 'AFGHANISTAN': 'AFG', 'SRI LANKA': 'LKA', 'MALDIVES': 'MDV',
  'PAPUA NEW GUINEA': 'PNG', 'FIJI': 'FJI', 'VANUATU': 'VUT', 'SOLOMON ISLANDS': 'SLB',
  'NEW CALEDONIA': 'NCL', 'TONGA': 'TON', 'SAMOA': 'WSM', 'NEW ZEALAND': 'NZL',
  'AUSTRALIA': 'AUS', 'PALAU': 'PLW', 'MICRONESIA': 'FSM', 'MARSHALL ISLANDS': 'MHL',
  'KIRIBATI': 'KIR', 'TUVALU': 'TUV', 'NAURU': 'NRU', 'GUAM': 'GUM',
  'HAWAII': 'USA', 'ALASKA': 'USA', 'CALIFORNIA': 'USA', 'UNITED STATES': 'USA',
  'USA': 'USA', 'CANADA': 'CAN', 'MEXICO': 'MEX', 'GUATEMALA': 'GTM',
  'EL SALVADOR': 'SLV', 'HONDURAS': 'HND', 'NICARAGUA': 'NIC', 'COSTA RICA': 'CRI',
  'PANAMA': 'PAN', 'CUBA': 'CUB', 'JAMAICA': 'JAM', 'HAITI': 'HTI',
  'DOMINICAN REPUBLIC': 'DOM', 'PUERTO RICO': 'PRI', 'COLOMBIA': 'COL',
  'VENEZUELA': 'VEN', 'ECUADOR': 'ECU', 'PERU': 'PER', 'BOLIVIA': 'BOL',
  'CHILE': 'CHL', 'ARGENTINA': 'ARG', 'BRAZIL': 'BRA', 'URUGUAY': 'URY',
  'PARAGUAY': 'PRY', 'TURKEY': 'TUR', 'TURKIYE': 'TUR', 'GREECE': 'GRC',
  'ITALY': 'ITA', 'SPAIN': 'ESP', 'PORTUGAL': 'PRT', 'ICELAND': 'ISL',
  'UNITED KINGDOM': 'GBR', 'UK': 'GBR', 'ENGLAND': 'GBR', 'IRELAND': 'IRL',
  'FRANCE': 'FRA', 'GERMANY': 'DEU', 'NETHERLANDS': 'NLD', 'BELGIUM': 'BEL',
  'SWITZERLAND': 'CHE', 'AUSTRIA': 'AUT', 'POLAND': 'POL', 'CZECHIA': 'CZE',
  'SLOVAKIA': 'SVK', 'HUNGARY': 'HUN', 'ROMANIA': 'ROU', 'BULGARIA': 'BGR',
  'SERBIA': 'SRB', 'CROATIA': 'HRV', 'SLOVENIA': 'SVN', 'BOSNIA': 'BIH',
  'ALBANIA': 'ALB', 'NORTH MACEDONIA': 'MKD', 'UKRAINE': 'UKR', 'RUSSIA': 'RUS',
  'KAZAKHSTAN': 'KAZ', 'UZBEKISTAN': 'UZB', 'TAJIKISTAN': 'TJK', 'KYRGYZSTAN': 'KGZ',
  'TURKMENISTAN': 'TKM', 'AZERBAIJAN': 'AZE', 'GEORGIA': 'GEO', 'ARMENIA': 'ARM',
  'IRAN': 'IRN', 'IRAQ': 'IRQ', 'SAUDI ARABIA': 'SAU', 'YEMEN': 'YEM',
  'OMAN': 'OMN', 'UAE': 'ARE', 'QATAR': 'QAT', 'KUWAIT': 'KWT',
  'ISRAEL': 'ISR', 'JORDAN': 'JOR', 'LEBANON': 'LBN', 'SYRIA': 'SYR',
  'EGYPT': 'EGY', 'MOROCCO': 'MAR', 'ALGERIA': 'DZA', 'TUNISIA': 'TUN',
  'ETHIOPIA': 'ETH', 'KENYA': 'KEN', 'TANZANIA': 'TZA', 'MOZAMBIQUE': 'MOZ',
  'MADAGASCAR': 'MDG', 'SOUTH AFRICA': 'ZAF', 'GHANA': 'GHA', 'NIGERIA': 'NGA',
  'SOMALIA': 'SOM', 'SUDAN': 'SDN',
};
const COUNTRY_TZ: Record<string, string> = {
  'PHL': 'Asia/Manila', 'IDN': 'Asia/Jakarta', 'MYS': 'Asia/Kuala_Lumpur', 'JPN': 'Asia/Tokyo',
  'TWN': 'Asia/Taipei', 'CHN': 'Asia/Shanghai', 'HKG': 'Asia/Hong_Kong', 'MNG': 'Asia/Ulaanbaatar',
  'KOR': 'Asia/Seoul', 'PRK': 'Asia/Pyongyang', 'THA': 'Asia/Bangkok', 'VNM': 'Asia/Ho_Chi_Minh',
  'KHM': 'Asia/Phnom_Penh', 'LAO': 'Asia/Vientiane', 'MMR': 'Asia/Yangon', 'BGD': 'Asia/Dhaka',
  'BTN': 'Asia/Thimphu', 'NPL': 'Asia/Kathmandu', 'IND': 'Asia/Kolkata', 'PAK': 'Asia/Karachi',
  'AFG': 'Asia/Kabul', 'LKA': 'Asia/Colombo', 'MDV': 'Indian/Maldives', 'PNG': 'Pacific/Port_Moresby',
  'FJI': 'Pacific/Fiji', 'VUT': 'Pacific/Efate', 'SLB': 'Pacific/Guadalcanal', 'NCL': 'Pacific/Noumea',
  'TON': 'Pacific/Tongatapu', 'WSM': 'Pacific/Apia', 'NZL': 'Pacific/Auckland', 'AUS': 'Australia/Sydney',
  'PLW': 'Pacific/Palau', 'FSM': 'Pacific/Chuuk', 'MHL': 'Pacific/Majuro', 'KIR': 'Pacific/Tarawa',
  'TUV': 'Pacific/Funafuti', 'NRU': 'Pacific/Nauru', 'GUM': 'Pacific/Guam', 'USA': 'America/New_York',
  'CAN': 'America/Toronto', 'MEX': 'America/Mexico_City', 'GTM': 'America/Guatemala', 'SLV': 'America/El_Salvador',
  'HND': 'America/Tegucigalpa', 'NIC': 'America/Managua', 'CRI': 'America/Costa_Rica', 'PAN': 'America/Panama',
  'CUB': 'America/Havana', 'JAM': 'America/Jamaica', 'HTI': 'America/Port-au-Prince', 'DOM': 'America/Santo_Domingo',
  'PRI': 'America/Puerto_Rico', 'COL': 'America/Bogota', 'VEN': 'America/Caracas', 'ECU': 'America/Guayaquil',
  'PER': 'America/Lima', 'BOL': 'America/La_Paz', 'CHL': 'America/Santiago', 'ARG': 'America/Argentina/Buenos_Aires',
  'BRA': 'America/Sao_Paulo', 'URY': 'America/Montevideo', 'PRY': 'America/Asuncion', 'TUR': 'Europe/Istanbul',
  'GRC': 'Europe/Athens', 'ITA': 'Europe/Rome', 'ESP': 'Europe/Madrid', 'PRT': 'Europe/Lisbon',
  'ISL': 'Atlantic/Reykjavik', 'GBR': 'Europe/London', 'IRL': 'Europe/Dublin', 'FRA': 'Europe/Paris',
  'DEU': 'Europe/Berlin', 'NLD': 'Europe/Amsterdam', 'BEL': 'Europe/Brussels', 'CHE': 'Europe/Zurich',
  'AUT': 'Europe/Vienna', 'POL': 'Europe/Warsaw', 'CZE': 'Europe/Prague', 'SVK': 'Europe/Bratislava',
  'HUN': 'Europe/Budapest', 'ROU': 'Europe/Bucharest', 'BGR': 'Europe/Sofia', 'SRB': 'Europe/Belgrade',
  'HRV': 'Europe/Zagreb', 'SVN': 'Europe/Ljubljana', 'BIH': 'Europe/Sarajevo', 'ALB': 'Europe/Tirane',
  'MKD': 'Europe/Skopje', 'UKR': 'Europe/Kyiv', 'RUS': 'Europe/Moscow', 'KAZ': 'Asia/Almaty',
  'UZB': 'Asia/Samarkand', 'TJK': 'Asia/Dushanbe', 'KGZ': 'Asia/Bishkek', 'TKM': 'Asia/Ashgabat',
  'AZE': 'Asia/Baku', 'GEO': 'Asia/Tbilisi', 'ARM': 'Asia/Yerevan', 'IRN': 'Asia/Tehran',
  'IRQ': 'Asia/Baghdad', 'SAU': 'Asia/Riyadh', 'YEM': 'Asia/Aden', 'OMN': 'Asia/Muscat',
  'ARE': 'Asia/Dubai', 'QAT': 'Asia/Qatar', 'KWT': 'Asia/Kuwait', 'ISR': 'Asia/Jerusalem',
  'JOR': 'Asia/Amman', 'LBN': 'Asia/Beirut', 'SYR': 'Asia/Damascus', 'EGY': 'Africa/Cairo',
  'MAR': 'Africa/Casablanca', 'DZA': 'Africa/Algiers', 'TUN': 'Africa/Tunis', 'ETH': 'Africa/Addis_Ababa',
  'KEN': 'Africa/Nairobi', 'TZA': 'Africa/Dar_es_Salaam', 'MOZ': 'Africa/Maputo', 'MDG': 'Indian/Antananarivo',
  'ZAF': 'Africa/Johannesburg', 'GHA': 'Africa/Accra', 'NGA': 'Africa/Lagos', 'SOM': 'Africa/Mogadishu',
  'SDN': 'Africa/Khartoum',
};
function locationToIso3(location: string): string | null {
  const loc = String(location ?? '');
  let tail = loc;
  const p = loc.lastIndexOf(',');
  if (p !== -1) tail = loc.slice(p + 1).trim();
  const up = tail.toUpperCase();
  if (up && COUNTRY_ISO3[up]) return COUNTRY_ISO3[up];
  const full = loc.toUpperCase();
  for (const name of Object.keys(COUNTRY_ISO3)) {
    if (up && (up.includes(name) || name.includes(up))) return COUNTRY_ISO3[name];
  }
  for (const name of Object.keys(COUNTRY_ISO3)) {
    if (full.includes(name)) return COUNTRY_ISO3[name];
  }
  return null;
}

function hashtags(location: string, tag: string): string {
  const base = ['#Earthquake', `#${tag}`, '#TerraGuard', '#EarthquakeReport', '#SeismicActivity', '#StaySafe'];
  if (/philipp/i.test(location)) {
    return [...base, '#Philippines', '#EarthquakePH', '#Lindol', '#TerraGuardPH'].join(' ');
  }
  return [...base, '#BreakingNews', '#NaturalDisaster'].join(' ');
}

async function resolvePageToken(env: Record<string, unknown>, appSecretProof: (t: string) => Promise<string | null>): Promise<string | null> {
  const userToken = String(env.FB_USER_ACCESS_TOKEN ?? '').trim();
  const pageId = String(env.FB_PAGE_ID ?? '').trim();
  if (!userToken || !pageId) return null;
  try {
    const url = new URL(`https://graph.facebook.com/${FB_GRAPH_VERSION}/me/accounts`);
    url.searchParams.set('access_token', userToken);
    url.searchParams.set('fields', 'id,name,access_token');
    url.searchParams.set('limit', '50');
    const proof = await appSecretProof(userToken);
    if (proof) url.searchParams.set('appsecret_proof', proof);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: Array<{ id: string | number; access_token?: string }> };
    const match = (data?.data ?? []).find((p) => String(p.id) === String(pageId));
    return match?.access_token ? String(match.access_token) : null;
  } catch {
    return null;
  }
}

export async function onRequest(context: { request: Request; env?: Record<string, unknown> }) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (request.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const e: Record<string, unknown> = env ?? {};

  // --- 1. Authenticate + authorize the caller ---
  const adminEmail = String(e.ADMIN_EMAIL ?? DEFAULT_ADMIN).toLowerCase();
  const auth = request.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json({ success: false, error: 'Missing login token' }, 401);
  const supabaseUrl = String(e.SUPABASE_URL ?? DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const anonKey = String(e.SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY);
  const getCallerEmail = async (): Promise<string | null> => {
    try {
      const me = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
      });
      if (!me.ok) return null;
      const meJson = (await me.json()) as { email?: string };
      return String(meJson?.email ?? '').toLowerCase() || null;
    } catch {
      return null;
    }
  };
  const callerEmail = await getCallerEmail();
  if (!callerEmail) {
    return json({ success: false, error: 'Invalid login token' }, 401);
  }
  if (callerEmail !== adminEmail) {
    return json({ success: false, error: 'Not authorized' }, 403);
  }

  // --- 2. Validate the quake payload ---
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const lat = parseFloat(String(body.latitude ?? ''));
  const lng = parseFloat(String(body.longitude ?? ''));
  const mag = parseFloat(String(body.magnitude ?? ''));
  const place = esc(body.location) || `${body.latitude ?? ''}, ${body.longitude ?? ''}`;
  const depth = esc(body.depth) || '?';
  const tag = sourceTag(esc(body.source));
  const pageUrl = esc(body.pageUrl);
  const sourceLink = esc(body.sourceLink);
  if (!place || !pageUrl) return json({ success: false, error: 'Missing location/pageUrl' }, 400);

  const { date, time } = displayParts(esc(body.datetime), tag, place);
  const timeBare = time.replace(/\s*(UTC|PHT|UST)\s*$/i, '').trim();
  // PHIVOLCS-only: bulletin number. Prefer the explicit number the
  // Details page sends (it already resolved Final variants); fall back to
  // parsing the source-link filename (worker auto-posts show the same line;
  // EMSC/USGS posts never carry it).
  const explicitNo = parseInt(esc(body.infoNo), 10);
  const infoNo = tag === 'PHIVOLCS'
    ? (Number.isFinite(explicitNo) && explicitNo > 0 ? String(explicitNo) : infoNoFromLink(sourceLink))
    : '';
  // Tsunami line: only for real threats (warning/advisory). 'No Tsunami
  // Threat'/empty stays omitted so normal posts are byte-identical.
  const tsunamiLabel = esc(body.tsunamiThreat);
  const tsunamiLevel = esc(body.tsunamiLevel).toLowerCase();
  const hasTsunamiThreat = tsunamiLabel !== '' && (
    tsunamiLevel === 'warning' || tsunamiLevel === 'advisory' ||
    (tsunamiLevel === '' && /warning|advisory|threat exists|may generate/i.test(tsunamiLabel) &&
      !/no tsunami|no threat|no hazard|not expect|does not pose/i.test(tsunamiLabel))
  );
  const lines = [
    `${magPrefix(mag)}JUST IN: A Magnitude: ${esc(body.magnitude) || '?'} struck near ${place} on ${date}${timeBare ? ` - ${timeBare}` : ''}`,
    ``,
    ...(infoNo ? [`Information No.: ${infoNo}`] : []),
    `Magnitude: ${esc(body.magnitude) || '?'}`,
    `Location: ${place}`,
    `Date & Time: ${date}${timeBare ? ` - ${timeBare}` : ''}`,
    `Depth: ${depth} km`,
    ...(hasTsunamiThreat ? [`⚠️ Tsunami Threat: ${tsunamiLabel}`] : []),
  ];
  if (!isNaN(lat) && !isNaN(lng)) {
    lines.push(`Coordinates: ${lat.toFixed(2)}°N, ${lng.toFixed(2)}°E`);
  }
  lines.push(
    ``,
    `Earthquake Info: ${pageUrl}`,
    `Please take note that this is not the final report. pleminary information`,
    ``,
    `Source: ${tag}${sourceLink ? `\nBulletin: ${sourceLink}` : ''}`,
    ``,
    `Join our discord for discussions: https://discord.gg/tdGrvnvehP`,
    ``,
    hashtags(place, tag),
  );
  const message = lines.join('\n');

  // --- 3. Post to Facebook (designed card photo, /feed fallback) ---
  const pageId = String(e.FB_PAGE_ID ?? '').trim();
  const userToken = String(e.FB_USER_ACCESS_TOKEN ?? '').trim();
  const appSecret = String(e.FB_APP_SECRET ?? '').trim();
  if (!pageId || !userToken) {
    return json({ success: false, error: 'Facebook is not configured (FB_PAGE_ID / FB_USER_ACCESS_TOKEN)' }, 500);
  }
  const cryptoSubtle = crypto?.subtle;
  const proofFor = async (t: string): Promise<string | null> => {
    try {
      if (!t || !appSecret || !cryptoSubtle) return null;
      const key = await cryptoSubtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await cryptoSubtle.sign('HMAC', key, new TextEncoder().encode(t));
      return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return null;
    }
  };
  let pageToken = await resolvePageToken(e, proofFor);
  if (!pageToken) pageToken = userToken;
  const proof = await proofFor(pageToken);
  const withProof = (p: Record<string, string>) => (proof ? { ...p, appsecret_proof: proof } : p);

  const hasCoords = !isNaN(lat) && !isNaN(lng);
  const cardParams = hasCoords
    ? new URLSearchParams({
        lat: String(body.latitude),
        lng: String(body.longitude),
        mag: String(body.magnitude ?? ''),
        place: place.slice(0, 90),
        date,
        time,
        depth: String(body.depth ?? ''),
        source: tag,
        ...(infoNo ? { info: infoNo } : {}),
        ...(hasTsunamiThreat ? { tsunami: tsunamiLabel } : {}),
      }).toString()
    : '';
  // Primary card renderer (trikefare) with automatic fallback to the backup
  // host (backup) when the primary 503s or is unreachable.
  const cardUrls =
    hasCoords && cardParams
      ? [
          `https://trikefare.x10.mx/terraguard/api/quake-card.php?${cardParams}`,
          `https://terraguard-auto.page.gd/terraguard/api/quake-card.php?${cardParams}`,
        ]
      : [];
  for (const cardUrl of cardUrls) {
    try {
      const warm = await fetch(cardUrl, { headers: { 'User-Agent': 'TerraGuard-FB-Warmup/1.0' } });
      if (warm.ok) {
        const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(withProof({ access_token: pageToken, caption: message, url: cardUrl })),
        });
        const data = (await res.json().catch(() => ({}))) as { post_id?: string; id?: string; error?: { message?: string } };
        if (res.ok && (data.post_id || data.id)) {
          return json({ success: true, id: data.post_id ?? data.id });
        }
      }
    } catch {
      /* try next host, then fall through to /feed */
    }
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${FB_GRAPH_VERSION}/${pageId}/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withProof({ access_token: pageToken, message, link: pageUrl })),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data?.id) {
      return json({ success: false, error: data?.error?.message ?? `Facebook HTTP ${res.status}` }, 502);
    }
    return json({ success: true, id: data.id });
  } catch (err) {
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
}
