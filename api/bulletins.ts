// @ts-nocheck
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Discovers all PHIVOLCS bulletins (Information No. 1, 2, ... Final) for an
// earthquake sequence by probing candidate URLs derived from a known bulletin link.
export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'Missing or invalid URL parameter' });
  }

  const m = /^(.+)_B(\d+)(F)?\.html$/i.exec(url);
  if (!m) {
    return res.status(200).json({ success: true, data: [] });
  }

  const prefix = m[1];
  const build = (n: number, final: boolean) => `${prefix}_B${n}${final ? 'F' : ''}.html`;

  const exists = async (candidate: string): Promise<boolean> => {
    try {
      const r = await fetch(candidate, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      if (!r.ok) return false;
      const html = await r.text();
      return /EARTHQUAKE INFORMATION/i.test(html);
    } catch {
      return false;
    }
  };

  const results: { no: number; final: boolean; url: string }[] = [];
  // Cap the probe loop: sequences this long are effectively nonexistent, and
  // every miss here is a wasted request to PHIVOLCS.
  for (let n = 1; n <= 8; n++) {
    const [plain, final] = await Promise.all([exists(build(n, false)), exists(build(n, true))]);
    if (!plain && !final) break;
    if (plain) results.push({ no: n, final: false, url: build(n, false) });
    if (final) results.push({ no: n, final: true, url: build(n, true) });
  }

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  return res.status(200).json({ success: true, data: results });
}
