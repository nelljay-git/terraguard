import { useEffect, useMemo, useState } from 'react';
import { Copy, Check, Code2, Globe, Link2, ShieldCheck, TerminalSquare, Database, Play, RefreshCw, Zap, Mail } from 'lucide-react';
import './ApiDocs.css';

type Endpoint = {
  title: string;
  method: string;
  path: string;
  description: string;
  response: string;
  example: string;
};

const endpoints: Endpoint[] = [
  {
    title: 'Recent earthquakes',
    method: 'GET',
    path: '/api/phivolcs',
    description: 'Returns the live PHIVOLCS feed used by the dashboard and archive page.',
    response: 'JSON response with `success`, `count`, and `data` fields.',
    example: `fetch('/api/phivolcs')`,
  },
  {
    title: 'Archive month',
    method: 'GET',
    path: '/api/phivolcs?path=EQLatest-Monthly/{year}/{year}_{month}.html',
    description: 'Returns a historical monthly archive from PHIVOLCS. The app uses this for the Archive page.',
    response: 'JSON when proxied data is available, otherwise HTML fallback parsed by the client.',
    example: `fetch('/api/phivolcs?path=EQLatest-Monthly/2026/2026_January.html')`,
  },
  {
    title: 'Earthquake details',
    method: 'GET',
    path: '/api/details?url={phivolcs_event_url}',
    description: 'Fetches expanded intensity, origin, and map details for a specific event.',
    response: 'JSON response with `origin`, intensity text, notes, and `mapUrl`.',
    example: `fetch('/api/details?url=https%3A%2F%2Fearthquake.phivolcs.dost.gov.ph%2F...')`,
  },
];

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button className="api-copy-btn" onClick={handleCopy} type="button" title="Copy example">
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

type TryMode = 'live' | 'archive' | 'details';

function formatPreview(value: unknown): string {
  if (value == null) return 'No data returned.';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseEarthquakeHtml(html: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const rows = doc.querySelectorAll('table tr');
  const earthquakes = Array.from(rows)
    .map((row) => {
      const cols = row.querySelectorAll('td');
      if (cols.length < 6) return null;

      const aTag = cols[0].querySelector('a');
      let link = aTag?.getAttribute('href') || '';
      if (link && !link.startsWith('http')) {
        link = link.replace(/\\/g, '/');
        link = new URL(link, 'https://earthquake.phivolcs.dost.gov.ph/').href;
      }

      return {
        datetime: cols[0].textContent?.trim() || '',
        latitude: cols[1].textContent?.trim() || '',
        longitude: cols[2].textContent?.trim() || '',
        depth: cols[3].textContent?.trim() || '',
        magnitude: cols[4].textContent?.trim() || '',
        location: cols[5].textContent?.trim() || '',
        link,
      };
    })
    .filter(Boolean) as Array<{
      datetime: string;
      latitude: string;
      longitude: string;
      depth: string;
      magnitude: string;
      location: string;
      link: string;
    }>;

  return {
    earthquakes,
    firstEvent: earthquakes[0] ?? null,
  };
}

export function ApiDocs() {
  const baseUrl = useMemo(() => window.location.origin, []);
  const [tryMode, setTryMode] = useState<TryMode>('live');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('Click Run Sample to fetch a live response.');
  const [error, setError] = useState<string | null>(null);
  const runSample = async (mode: TryMode) => {
    setTryMode(mode);
    setLoading(true);
    setError(null);
    setOutput('Fetching live response...');

    try {
      const headers = { 'x-api-key': 'terraguard-api-2026' };

      if (mode === 'live') {
        const res = await fetch('/api/phivolcs', { headers });
        const contentType = res.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          const json = await res.json();
          setOutput(formatPreview({
            endpoint: '/api/phivolcs',
            status: res.status,
            contentType,
            count: json.count,
            firstEvent: json.data?.[0] ?? null,
          }));
          return;
        }

        const html = await res.text();
        const parsed = parseEarthquakeHtml(html);
        setOutput(formatPreview({
          endpoint: '/api/phivolcs',
          status: res.status,
          contentType,
          note: 'HTML fallback parsed the same way the app parses the feed.',
          count: parsed.earthquakes.length,
          firstEvent: parsed.firstEvent,
        }));
        return;
      }

      if (mode === 'archive') {
        const url = '/api/phivolcs?path=EQLatest-Monthly/2026/2026_January.html';
        const res = await fetch(url, { headers });
        const contentType = res.headers.get('content-type') || '';
        const payload = contentType.includes('application/json') ? await res.json() : await res.text();
        setOutput(formatPreview({
          endpoint: url,
          status: res.status,
          contentType,
          preview: typeof payload === 'string' ? payload.slice(0, 1000) : payload,
        }));
        return;
      }

      const liveRes = await fetch('/api/phivolcs', { headers });
      const liveType = liveRes.headers.get('content-type') || '';
      const liveData = liveType.includes('application/json')
        ? await liveRes.json()
        : parseEarthquakeHtml(await liveRes.text());
      const firstEvent = 'data' in liveData ? liveData.data?.[0] : liveData.firstEvent;
      if (!firstEvent?.link) {
        throw new Error('No event link available from the live feed yet.');
      }

      const res = await fetch(firstEvent.link.replace('https://earthquake.phivolcs.dost.gov.ph', '/api/phivolcs'), { headers });
      if (!res.ok) {
        throw new Error(`Failed to load sample event (${res.status})`);
      }

      const contentType = res.headers.get('content-type') || '';
      let details: any;
      if (contentType.includes('application/json')) {
        details = await res.json();
      } else {
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const cleanText = html.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const originMatch = /Origin\s*:\s*(.*?)\s*Magnitude/i.exec(cleanText);
        const reportedMatch = /Reported Intensities\s*:\s*(.*?)(?:Instrumental Intensities|This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
        const instrumentalMatch = /Instrumental Intensities\s*:?\s*(.*?)(?:This is an aftershock|Expecting Damage|$)/i.exec(cleanText);
        const noteMatch = /(This is an aftershock.*?)(?:Expecting Damage|$)/i.exec(cleanText);
        const img = doc.querySelector('img');
        details = {
          origin: originMatch ? originMatch[1].trim() : 'Unknown',
          reportedIntensities: reportedMatch ? reportedMatch[1].trim() : '',
          instrumentalIntensities: instrumentalMatch ? instrumentalMatch[1].trim() : '',
          note: noteMatch ? noteMatch[1].trim() : '',
          mapUrl: img?.getAttribute('src') || '',
        };
      }

      setOutput(formatPreview({
        endpoint: '/details fallback preview',
        status: res.status,
        data: details.data ?? details,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sample request failed.');
      setOutput('No response yet.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runSample('live');
  }, []);

  return (
    <div className="api-docs container">
      <div className="api-hero glass">
        <div className="api-hero-badge">
          <ShieldCheck size={14} />
          <span>Developer Access</span>
        </div>
        <h1 className="api-title">API Management</h1>
        <p className="api-subtitle">
          Sharing the earthquake data surface for other developers building on top of TerraGuard.
          This page documents the same routes the app uses for archives and event details.
        </p>

        <div className="api-hero-grid">
          <div className="api-hero-card glass-card">
            <Database size={18} />
            <div>
              <div className="api-card-label">Base URL</div>
              <div className="api-card-value">{baseUrl}</div>
            </div>
          </div>
          <div className="api-hero-card glass-card">
            <Link2 size={18} />
            <div>
              <div className="api-card-label">Primary use</div>
              <div className="api-card-value">Archive and /details support</div>
            </div>
          </div>
          <div className="api-hero-card glass-card">
            <TerminalSquare size={18} />
            <div>
              <div className="api-card-label">Format</div>
              <div className="api-card-value">REST-style GET endpoints</div>
            </div>
          </div>
          <div className="api-hero-card glass-card api-key-card">
            <ShieldCheck size={18} />
            <div>
              <div className="api-card-label">Access</div>
              <div className="api-card-value api-key-value">Request api key</div>
            </div>
            <button type="button" className="api-copy-btn api-copy-btn--compact" title="Request api key">
              <Mail size={14} />
              <span>Request api key</span>
            </button>
          </div>
        </div>
      </div>

      <section className="api-section">
        <div className="api-section-header">
          <Code2 size={18} />
          <h2>Available endpoints</h2>
        </div>

        <div className="api-endpoint-list">
          {endpoints.map((endpoint) => (
            <article key={endpoint.path} className="api-endpoint glass-card">
              <div className="api-endpoint-top">
                <div>
                  <div className="api-method">{endpoint.method}</div>
                  <h3>{endpoint.title}</h3>
                </div>
                <CopyButton value={endpoint.example} />
              </div>

              <p className="api-endpoint-desc">{endpoint.description}</p>

              <div className="api-code-block">
                <span className="api-code-label">Route</span>
                <code>{endpoint.path}</code>
              </div>

              <div className="api-code-block">
                <span className="api-code-label">Response</span>
                <code>{endpoint.response}</code>
              </div>

              <div className="api-code-block api-code-block--highlight">
                <span className="api-code-label">Example</span>
                <code>{endpoint.example}</code>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="api-section api-section--two">
        <div className="api-panel glass-card">
          <div className="api-section-header">
            <Globe size={18} />
            <h2>Integration notes</h2>
          </div>
          <ul className="api-notes">
            <li>The live dashboard reads `/api/phivolcs` and caches results in the browser.</li>
            <li>The Archive page can request monthly history through the same proxy layer.</li>
            <li>The details endpoint enriches a single event with intensities and map data.</li>
            <li>Responses are proxied from PHIVOLCS, so availability depends on the source feed.</li>
          </ul>
        </div>

        <div className="api-panel glass-card">
          <div className="api-section-header">
            <Code2 size={18} />
            <h2>Quick start</h2>
          </div>
          <div className="api-snippet">
            <span className="api-code-label">JavaScript</span>
            <pre>{`const res = await fetch('/api/phivolcs');
const json = await res.json();
console.log(json.data);`}</pre>
          </div>
          <div className="api-snippet">
            <span className="api-code-label">Historical archive</span>
            <pre>{`await fetch('/api/phivolcs?path=EQLatest-Monthly/2026/2026_January.html');`}</pre>
          </div>
        </div>

        <div className="api-panel glass-card api-tryit-panel">
          <div className="api-section-header">
            <Play size={18} />
            <h2>Try it live</h2>
          </div>
          <p className="api-tryit-desc">
            Run a sample request against the same routes the app uses and inspect a live preview of the response.
          </p>

          <div className="api-tryit-actions">
            <button className={`api-tryit-btn ${tryMode === 'live' ? 'active' : ''}`} onClick={() => runSample('live')} disabled={loading} type="button">
              <Zap size={14} />
              Live feed
            </button>
            <button className={`api-tryit-btn ${tryMode === 'archive' ? 'active' : ''}`} onClick={() => runSample('archive')} disabled={loading} type="button">
              <Code2 size={14} />
              Archive sample
            </button>
            <button className={`api-tryit-btn ${tryMode === 'details' ? 'active' : ''}`} onClick={() => runSample('details')} disabled={loading} type="button">
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
              Details sample
            </button>
          </div>

          <div className="api-tryit-output">
            <div className="api-tryit-output-head">
              <span className="api-code-label">Result</span>
              <span className="api-tryit-status">{loading ? 'Fetching...' : 'Ready'}</span>
            </div>
            {error ? <div className="api-tryit-error">{error}</div> : null}
            <pre>{output}</pre>
          </div>
        </div>

        <div className="api-panel glass-card api-tutorial-panel">
          <div className="api-section-header">
            <Play size={18} />
            <h2>Beginner tutorial</h2>
          </div>
          <div className="api-tutorial">
            <div className="api-tutorial-step">
              <span className="api-tutorial-num">1</span>
              <div>
                <h3>Find the base URL</h3>
                <p>Use the site address that is shown above. If you are local, it may look like <code>{baseUrl}</code>.</p>
              </div>
            </div>
            <div className="api-tutorial-step">
              <span className="api-tutorial-num">2</span>
              <div>
                <h3>Request access</h3>
                <p>Use the <code>Request api key</code> button, then paste the key into the <code>x-api-key</code> header.</p>
              </div>
            </div>
            <div className="api-tutorial-step">
              <span className="api-tutorial-num">3</span>
              <div>
                <h3>Choose an endpoint</h3>
                <p>Start with <code>/api/phivolcs</code> for live data, then try archive or details once that works.</p>
              </div>
            </div>
            <div className="api-tutorial-step">
              <span className="api-tutorial-num">4</span>
              <div>
                <h3>Read the JSON</h3>
                <p>Most endpoints return JSON, so you can call <code>await res.json()</code> after fetch.</p>
              </div>
            </div>
          </div>
          <div className="api-snippet">
            <span className="api-code-label">Simple fetch example</span>
            <pre>{`const res = await fetch('YOUR_BASE_URL/api/phivolcs', {
  headers: {
    'x-api-key': 'YOUR_API_KEY',
  },
});

const data = await res.json();`}</pre>
          </div>
        </div>
      </section>
    </div>
  );
}
