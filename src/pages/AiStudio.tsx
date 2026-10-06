import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Send, Eye, Trash2, KeyRound, ShieldAlert, Loader2, MessageCircle, Share2, Layers, AlertTriangle, CheckCircle2, Newspaper, ImagePlus, X, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import './AiStudio.css';

const ENV_ADMINS = (import.meta.env?.VITE_AI_ADMIN_EMAILS as string | undefined)
  ?.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean) ?? [];
const DEFAULT_ADMINS = ENV_ADMINS.length > 0 ? ENV_ADMINS : ['gianganwneljae@gmail.com'];

const WORKER_URL = (
  (import.meta.env?.VITE_WORKER_URL as string | undefined) ??
  'https://terraguard-monitor.gianganwneljae.workers.dev'
).replace(/\/+$/, '');

const LS = { base: 'tg-ai-base', key: 'tg-ai-key', model: 'tg-ai-model', sys: 'tg-ai-sys', tone: 'tg-ai-tone', length: 'tg-ai-length' };
const BODY_LIMIT = 6000;

const TONES = [
  { id: 'neutral', label: 'Neutral', prompt: 'Neutral, factual news tone' },
  { id: 'formal', label: 'Formal / official', prompt: 'Formal, official advisory tone' },
  { id: 'urgent', label: 'Urgent / alert', prompt: 'Urgent but calm public-safety alert tone' },
  { id: 'friendly', label: 'Friendly / community', prompt: 'Friendly, community-focused tone' },
] as const;

const LENGTHS = [
  { id: 'short', label: 'Short (1–2 paragraphs)', prompt: 'Keep it short: 1-2 paragraphs plus a safety reminder' },
  { id: 'standard', label: 'Standard (2–4 paragraphs)', prompt: 'Standard length: 2-4 short paragraphs plus a safety reminder' },
  { id: 'detailed', label: 'Detailed (4–6 paragraphs)', prompt: 'Detailed: 4-6 short paragraphs plus a safety reminder' },
] as const;

/** Built-in cover images shipped in public/. Posted as absolute URLs so
 * Facebook/Discord can fetch them — resolved against the current origin. */
const IMAGE_PRESETS = [
  { id: 'flash', label: 'Flash report', path: '/image-flash-report.jpg' },
  { id: 'weather', label: 'Weather report', path: '/image-weather-report.png' },
  { id: 'cyclone', label: 'Cyclone report', path: '/image-cyclone-report.png' },
];

/** Which preset (if any) the current URL points to. Custom/uploaded URLs → null. */
function presetIdFor(url: string): string | null {
  try {
    const u = new URL(url);
    const hit = IMAGE_PRESETS.find((p) => u.origin + u.pathname === window.location.origin + p.path);
    return hit ? hit.id : null;
  } catch {
    return null;
  }
}

const DEFAULT_SYSTEM = `You are a news writer for TerraGuard Philippines, a disaster-monitoring community.
Write in clear, factual English. Use ONLY the facts the user provides — never invent names, numbers, times, or quotes.
The user message starts with a "News date:" line — treat it as the dateline and use it in the story. Never invent a different date.
Format: first line is "# Headline", then 2-4 short paragraphs, then one line with a practical safety reminder for readers.
No hashtags, no emojis in the body.`;

function todayInputValue(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatLongDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso.trim() || 'today';
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(dt.getTime())) return iso.trim();
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function tonePrompt(id: string): string {
  return TONES.find((t) => t.id === id)?.prompt ?? TONES[0].prompt;
}

function lengthPrompt(id: string): string {
  return LENGTHS.find((l) => l.id === id)?.prompt ?? LENGTHS[1].prompt;
}

interface ChatMessage { role: 'system' | 'user'; content: string }

/** Host part of a URL for error messages. Never throws. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/**
 * Turn a fetch failure into something actionable. A TypeError means the request
 * never reached the server (DNS, offline, VPN, ad-blocker) — very different
 * from an HTTP 4xx/5xx, so it gets its own message naming the host.
 */
function fetchError(what: string, endpoint: string, e: unknown): string {
  if (e instanceof TypeError) {
    return `${what} — network error reaching ${hostOf(endpoint)}. Check your connection, VPN, or ad-blocker, and verify the URL in Settings.`;
  }
  return `${what} — ${e instanceof Error ? e.message : String(e)}`;
}

function splitTitleBody(text: string, fallbackTitle: string): { title: string; body: string } {
  const lines = text.trim().split('\n');
  const first = (lines[0] ?? '').trim();
  const hash = /^#\s+(.+)$/.exec(first);
  if (hash) return { title: hash[1].trim().slice(0, 200), body: lines.slice(1).join('\n').trim() };
  const labeled = /^(title|headline)\s*:\s*(.+)$/i.exec(first);
  if (labeled) return { title: labeled[2].trim().slice(0, 200), body: lines.slice(1).join('\n').trim() };
  return { title: fallbackTitle, body: text.trim() };
}

export function AiStudio() {
  const { user, loading } = useAuth();
  const email = (user?.email ?? '').toLowerCase();
  const allowed = !!user && DEFAULT_ADMINS.includes(email);

  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem(LS.base) ?? 'https://openrouter.ai/api/v1');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS.key) ?? '');
  const [model, setModel] = useState(() => localStorage.getItem(LS.model) ?? 'meta-llama/llama-3.3-70b-instruct');
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem(LS.sys) ?? DEFAULT_SYSTEM);
  const [showSettings, setShowSettings] = useState(false);

  const [topic, setTopic] = useState('');
  const [newsDate, setNewsDate] = useState(todayInputValue);
  const [tone, setTone] = useState(() => localStorage.getItem(LS.tone) ?? 'neutral');
  const [length, setLength] = useState(() => localStorage.getItem(LS.length) ?? 'standard');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [improving, setImproving] = useState(false);
  const [improveNotes, setImproveNotes] = useState('');
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  async function uploadImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so the same file can be picked again after an error.
    e.target.value = '';
    setError(null);
    setResult(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError(`"${file.name}" is not an image — pick a JPG, PNG, or WebP file.`); return; }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB — 5 MB max.`);
      return;
    }
    setUploading(true);
    try {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) throw new Error('Session expired — sign in again.');
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      const path = `${u.id}/news/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('forum-images').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'image/jpeg',
      });
      if (upErr) throw new Error(upErr.message);
      const { data } = supabase.storage.from('forum-images').getPublicUrl(path);
      setImageUrl(data.publicUrl);
      setResult('Image uploaded — preview it below before posting.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  const hasKey = apiKey.trim().length > 0;
  const overLimit = body.length > BODY_LIMIT;
  const canPost = !busy && !improving && !posting && !uploading && !overLimit && (!!title.trim() || !!body.trim());
  const canImprove = !busy && !improving && !posting && (!!title.trim() || !!body.trim());

  function saveSettings() {
    localStorage.setItem(LS.base, baseUrl.trim());
    localStorage.setItem(LS.key, apiKey.trim());
    localStorage.setItem(LS.model, model.trim());
    localStorage.setItem(LS.sys, systemPrompt);
    localStorage.setItem(LS.tone, tone);
    localStorage.setItem(LS.length, length);
    setResult('Settings saved in this browser.');
  }

  function clearKey() {
    localStorage.removeItem(LS.key);
    setApiKey('');
    setResult('API key removed from this browser.');
  }

  function requireApiKey(): string | null {
    if (!apiKey.trim()) { setError('Add your AI API key in Settings first.'); setShowSettings(true); return null; }
    return apiKey.trim();
  }

  function resolveEndpoint(): string {
    // Validate before sending: a malformed base URL (e.g. a missing colon
    // after https) fails DNS and surfaces only as a bare "Failed to fetch".
    try {
      const parsed = new URL(baseUrl.trim());
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
      return baseUrl.trim().replace(/\/+$/, '') + '/chat/completions';
    } catch {
      throw new Error(`API base URL looks invalid ("${baseUrl.trim() || '(empty)'}") — expected something like https://openrouter.ai/api/v1. Fix it in Settings and save.`);
    }
  }

  async function chatCompletion(messages: ChatMessage[]): Promise<string> {
    const key = requireApiKey();
    if (!key) throw new Error('__nokey__');
    const endpoint = resolveEndpoint();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        // Recommended by OpenRouter for attribution; harmless elsewhere.
        'HTTP-Referer': window.location.origin,
        'X-Title': 'TerraGuard AI News Desk',
      },
      body: JSON.stringify({ model: model.trim(), messages, temperature: 0.7, max_tokens: 1500 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error?.message ?? `AI request failed (HTTP ${res.status})`);
    }
    const content: string = data?.choices?.[0]?.message?.content ?? '';
    if (!content.trim()) throw new Error('The AI returned an empty response.');
    return content;
  }

  async function generate() {
    setError(null);
    setResult(null);
    if (!topic.trim()) { setError('Describe the news first — facts, place, time.'); return; }
    setBusy(true);
    try {
      const content = await chatCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `News date: ${formatLongDate(newsDate)}\nTone: ${tonePrompt(tone)}\nLength: ${lengthPrompt(length)}\nFacts:\n${topic.trim()}` },
      ]);
      const split = splitTitleBody(content, topic.trim().split('\n')[0].slice(0, 200));
      setTitle(split.title);
      setBody(split.body);
      setResult('Draft generated — review and edit before posting.');
    } catch (e) {
      if (e instanceof Error && e.message === '__nokey__') return;
      const endpoint = baseUrl.trim().replace(/\/+$/, '') + '/chat/completions';
      setError(fetchError('AI request failed', endpoint, e));
    } finally {
      setBusy(false);
    }
  }

  async function improveDraft() {
    setError(null);
    setResult(null);
    if (!title.trim() && !body.trim()) { setError('Nothing to improve — generate or write a draft first.'); return; }
    setImproving(true);
    try {
      const notes = improveNotes.trim() || 'Tighten the wording, keep all facts, fix grammar.';
      const content = await chatCompletion([
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Rewrite this news draft. Keep every fact exactly — do not add or remove facts.\nNews date: ${formatLongDate(newsDate)}\nTone: ${tonePrompt(tone)}\nLength: ${lengthPrompt(length)}\nRewrite instructions: ${notes}\n\nCurrent headline: ${title.trim() || '(none)'}\nCurrent body:\n${body.trim()}\n\nReturn in the same format: first line "# Headline", then paragraphs, then a safety reminder. No hashtags, no emojis.`,
        },
      ]);
      const split = splitTitleBody(content, title.trim() || topic.trim().split('\n')[0].slice(0, 200));
      setTitle(split.title);
      setBody(split.body);
      setResult('Draft improved — review before posting.');
    } catch (e) {
      if (e instanceof Error && e.message === '__nokey__') return;
      const endpoint = baseUrl.trim().replace(/\/+$/, '') + '/chat/completions';
      setError(fetchError('Improve failed', endpoint, e));
    } finally {
      setImproving(false);
    }
  }

  async function accessToken(): Promise<string> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? '';
    if (!token) throw new Error('Session expired — sign in again.');
    return token;
  }

  async function postNews(skipDiscord: boolean, skipFacebook: boolean, dryRun: boolean) {
    setError(null);
    setResult(null);
    if (!title.trim() && !body.trim()) { setError('Nothing to post — generate or write something first.'); return; }
    if (overLimit) { setError(`Body is over the ${BODY_LIMIT}-character limit — shorten it first.`); return; }
    if (skipDiscord && skipFacebook) { setError('Both channels are skipped — nothing would be sent.'); return; }
    const target = skipDiscord ? 'facebook' : skipFacebook ? 'discord' : 'both';
    const where = skipDiscord ? 'Facebook only' : skipFacebook ? 'Discord only' : 'Discord and Facebook';
    if (!dryRun && !window.confirm(`Post "${title.trim() || 'untitled'}" to ${where}?\n\nThis really sends. Continue?`)) return;
    setPosting(true);
    try {
      const token = await accessToken();
      const res = await fetch(`${WORKER_URL}/post-news${dryRun ? '?dryrun=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: title.trim(), text: body.trim(), target, imageUrl: imageUrl.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Empty 404 almost always means the worker predates /post-news.
        if (res.status === 404 && !data?.error) {
          throw new Error('Post failed (HTTP 404) — the worker has no /post-news route yet. Repaste terraguard.js into terraguard-monitor and try again.');
        }
        throw new Error(data?.error ?? `Post failed (HTTP ${res.status})`);
      }
      setResult(dryRun ? `Preview OK — ${data.message ?? 'ready to post.'}` : `Posted — ${data.message ?? 'done.'}`);
    } catch (e) {
      const url = `${WORKER_URL}/post-news`;
      setError(e instanceof TypeError ? fetchError('Post failed', url, e) : `Post failed — ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPosting(false);
    }
  }

  if (loading) {
    return (
      <div className="ai-container container">
        <div className="ai-card glass"><p className="text-muted">Loading…</p></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="ai-container container">
        <div className="ai-card glass ai-gate">
          <div className="ai-badge"><ShieldAlert size={26} /></div>
          <h1 className="ai-title">TerraGuard AI</h1>
          <p className="text-muted">This is a private news desk. Sign in to continue.</p>
          <Link className="ai-btn primary" to="/auth" state={{ from: '/ai' }}>Go to sign in</Link>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="ai-container container">
        <div className="ai-card glass ai-gate">
          <div className="ai-badge"><ShieldAlert size={26} /></div>
          <h1 className="ai-title">Restricted</h1>
          <p className="text-muted">This page is private.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-container container">
      <div className="ai-card glass">
        <div className="ai-head">
          <div className="ai-badge"><Newspaper size={22} /></div>
          <div>
            <h1 className="ai-title">TerraGuard AI News Desk</h1>
            <p className="ai-sub text-muted">Generate a draft with AI, review it, then post to Discord, Facebook, or both.</p>
          </div>
          <span className={`ai-key-pill${hasKey ? ' on' : ''}`}>{hasKey ? 'AI key saved' : 'No AI key'}</span>
        </div>

        <section className="ai-section" aria-label="Generate draft">
          <h2 className="ai-step"><span className="ai-step-n">1</span> Generate draft</h2>
          <div className="ai-field">
            <span><label htmlFor="ai-topic">Facts for the AI</label></span>
            <small>What happened, where, when. The AI uses only what you write here.</small>
            <textarea id="ai-topic" className="ai-textarea" value={topic} onChange={(e) => setTopic(e.target.value)} rows={4}
              placeholder="e.g. Magnitude 5.2 earthquake off Davao Oriental, 6:40 AM, felt Intensity III in Mati. No tsunami threat per PHIVOLCS." />
          </div>
          <div className="ai-field">
            <span><label htmlFor="ai-date">News date</label></span>
            <small>Joined to the prompt as “News date: …” so the draft uses this date.</small>
            <input id="ai-date" type="date" className="ai-input" value={newsDate} onChange={(e) => setNewsDate(e.target.value)} />
          </div>
          <div className="ai-grid-2">
            <div className="ai-field">
              <span><label htmlFor="ai-tone">Tone</label></span>
              <small>Joined to the prompt.</small>
              <select id="ai-tone" className="ai-input" value={tone} onChange={(e) => { setTone(e.target.value); localStorage.setItem(LS.tone, e.target.value); }}>
                {TONES.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
              </select>
            </div>
            <div className="ai-field">
              <span><label htmlFor="ai-length">Length</label></span>
              <small>Joined to the prompt.</small>
              <select id="ai-length" className="ai-input" value={length} onChange={(e) => { setLength(e.target.value); localStorage.setItem(LS.length, e.target.value); }}>
                {LENGTHS.map((l) => (<option key={l.id} value={l.id}>{l.label}</option>))}
              </select>
            </div>
          </div>
          <div className="ai-row">
            <button type="button" className="ai-btn primary block" onClick={generate} disabled={busy || improving || posting}>
              {busy ? (<><Loader2 size={15} className="spin" /> Generating…</>) : (<><Sparkles size={15} /> Generate draft</>)}
            </button>
            <button type="button" className="ai-btn block" onClick={generate} disabled={busy || improving || posting || !topic.trim()} title="Run again with the same facts (uses current tone/length/date)">
              <RefreshCw size={15} /> Regenerate
            </button>
            <button type="button" className="ai-toggle" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
              <KeyRound size={15} /> AI settings {showSettings ? '▾' : '▸'}
            </button>
          </div>
          {showSettings && (
            <div className="ai-settings">
              <div className="ai-grid-2">
                <div className="ai-field">
                  <span><label htmlFor="ai-base">API base URL</label></span>
                  <small>Any OpenAI-compatible endpoint.</small>
                  <input id="ai-base" className="ai-input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" spellCheck={false} />
                </div>
                <div className="ai-field">
                  <span><label htmlFor="ai-model">Model</label></span>
                  <small>Must exist on the endpoint above. Pick a suggestion or type any OpenRouter model id.</small>
                  <input id="ai-model" className="ai-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="meta-llama/llama-3.3-70b-instruct" spellCheck={false} list="ai-model-picks" />
                  <datalist id="ai-model-picks">
                    <option value="openai/gpt-4o-mini" />
                    <option value="google/gemini-2.5-flash" />
                    <option value="meta-llama/llama-3.3-70b-instruct" />
                    <option value="deepseek/deepseek-chat" />
                    <option value="meta-llama/llama-3.3-70b-instruct:free" />
                  </datalist>
                </div>
              </div>
              <div className="ai-field">
                <span><label htmlFor="ai-key">API key</label></span>
                <small>Stored only in this browser, never sent anywhere except the AI endpoint.</small>
                <input id="ai-key" className="ai-input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" autoComplete="off" spellCheck={false} />
              </div>
              <div className="ai-field">
                <span><label htmlFor="ai-sys">System prompt</label></span>
                <textarea id="ai-sys" className="ai-textarea" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={5} />
              </div>
              <div className="ai-row">
                <button type="button" className="ai-btn" onClick={saveSettings}>Save settings</button>
                <button type="button" className="ai-btn danger" onClick={clearKey}><Trash2 size={15} /> Remove key</button>
              </div>
            </div>
          )}
        </section>

        <section className="ai-section" aria-label="Review draft">
          <h2 className="ai-step"><span className="ai-step-n">2</span> Review &amp; edit</h2>
          <div className="ai-field">
            <span><label htmlFor="ai-title">Headline</label></span>
            <input id="ai-title" className="ai-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Headline" maxLength={200} />
          </div>
          <div className="ai-field">
            <span><label htmlFor="ai-body">Body</label><span className={`ai-count${overLimit ? ' over' : ''}`}>{body.length}/{BODY_LIMIT}</span></span>
            <textarea id="ai-body" className="ai-textarea" value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder="News body — editable" />
          </div>
          <div className="ai-field">
            <span><label htmlFor="ai-improve">Improve draft</label></span>
            <small>Optional instructions — e.g. “shorter”, “more formal”, “add safety tips”. Uses the tone/length/date above and keeps all facts.</small>
            <textarea id="ai-improve" className="ai-textarea" value={improveNotes} onChange={(e) => setImproveNotes(e.target.value)} rows={2}
              placeholder="e.g. Make it shorter and more urgent, keep all facts." />
            <div className="ai-row">
              <button type="button" className="ai-btn block" onClick={improveDraft} disabled={!canImprove}>
                {improving ? (<><Loader2 size={15} className="spin" /> Improving…</>) : (<><Sparkles size={15} /> Improve with AI</>)}
              </button>
            </div>
          </div>
          <div className="ai-field">
            <span><label htmlFor="ai-image">Image</label></span>
            <small>Optional. Pick a preset, upload from your device, or paste a URL. Facebook posts it as a photo; Discord embeds it. Presets resolve to this site, so post from the live site for Facebook to fetch them.</small>
            <div className="ai-presets" role="radiogroup" aria-label="Preset images">
              <button type="button" className={`ai-preset${!imageUrl ? ' sel' : ''}`}
                onClick={() => setImageUrl('')} aria-pressed={!imageUrl} title="No image">
                <span className="ai-preset-none">None</span>
                <span>No image</span>
              </button>
              {IMAGE_PRESETS.map((p) => {
                const active = presetIdFor(imageUrl) === p.id;
                return (
                  <button key={p.id} type="button" className={`ai-preset${active ? ' sel' : ''}`}
                    onClick={() => setImageUrl(window.location.origin + p.path)}
                    aria-pressed={active} title={p.label}>
                    <img src={p.path} alt={p.label} loading="lazy" />
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="ai-upload-row">
              <label className="ai-btn" htmlFor="ai-file">
                {uploading
                  ? (<><Loader2 size={15} className="spin" /> Uploading…</>)
                  : (<><ImagePlus size={15} /> Upload image</>)}
              </label>
              <input id="ai-file" type="file" accept="image/*" onChange={uploadImage} hidden disabled={uploading || posting} />
              <input id="ai-image" className="ai-input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="…or paste https:// URL" spellCheck={false} />
            </div>
            {imageUrl && (
              <div className="ai-preview">
                <img src={imageUrl} alt="Attached preview" />
                <button type="button" className="ai-btn danger ai-preview-x" onClick={() => setImageUrl('')} aria-label="Remove image">
                  <X size={15} /> Remove
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="ai-section" aria-label="Post">
          <h2 className="ai-step"><span className="ai-step-n">3</span> Post</h2>
          {error && <p className="ai-msg error" role="alert"><AlertTriangle size={16} /> <span>{error}</span></p>}
          {result && <p className="ai-msg ok" role="status"><CheckCircle2 size={16} /> <span>{result}</span></p>}
          <div className="ai-actions">
            <button type="button" className="ai-btn" disabled={busy || improving || posting}
              onClick={() => postNews(false, false, true)}>
              <Eye size={15} /> Preview
            </button>
            <button type="button" className="ai-btn primary" disabled={!canPost} data-skip="none"
              onClick={() => postNews(false, false, false)}>
              <Send size={15} /> Post to Discord &amp; Facebook
            </button>
            <button type="button" className="ai-btn discord" disabled={!canPost} data-skip="facebook"
              onClick={() => postNews(false, true, false)}>
              <MessageCircle size={15} /> Discord only
            </button>
            <button type="button" className="ai-btn fb" disabled={!canPost} data-skip="discord"
              onClick={() => postNews(true, false, false)}>
              <Share2 size={15} /> Facebook only
            </button>
          </div>
          <p className="ai-foot text-muted"><Layers size={13} /> Posts carry an “AI-assisted draft · Reviewed by TerraGuard” disclosure.</p>
        </section>
      </div>
    </div>
  );
}
