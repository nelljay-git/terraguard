import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Send, Eye, Trash2, KeyRound, ShieldAlert, Loader2, MessageCircle, Share2, Layers } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import './AiStudio.css';

const DEFAULT_ADMINS = (import.meta.env?.VITE_AI_ADMIN_EMAILS as string | undefined)
  ?.split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean) ?? ['gianganwneljae@gmail.com'];

const WORKER_URL = (
  (import.meta.env?.VITE_WORKER_URL as string | undefined) ??
  'https://terraguard-monitor.gianganwneljae.workers.dev'
).replace(/\/+$/, '');

const LS = { base: 'tg-ai-base', key: 'tg-ai-key', model: 'tg-ai-model', sys: 'tg-ai-sys' };

const DEFAULT_SYSTEM = `You are a news writer for TerraGuard Philippines, a disaster-monitoring community.
Write in clear, factual English. Use ONLY the facts the user provides — never invent names, numbers, times, or quotes.
Format: first line is "# Headline", then 2-4 short paragraphs, then one line with a practical safety reminder for readers.
No hashtags, no emojis in the body.`;

interface ChatMessage { role: 'system' | 'user'; content: string }

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

  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem(LS.base) ?? 'https://api.openai.com/v1');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS.key) ?? '');
  const [model, setModel] = useState(() => localStorage.getItem(LS.model) ?? 'gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem(LS.sys) ?? DEFAULT_SYSTEM);
  const [showSettings, setShowSettings] = useState(false);

  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function saveSettings() {
    localStorage.setItem(LS.base, baseUrl.trim());
    localStorage.setItem(LS.key, apiKey.trim());
    localStorage.setItem(LS.model, model.trim());
    localStorage.setItem(LS.sys, systemPrompt);
    setResult('Settings saved in this browser.');
  }

  function clearKey() {
    localStorage.removeItem(LS.key);
    setApiKey('');
    setResult('API key removed from this browser.');
  }

  async function generate() {
    setError(null);
    setResult(null);
    if (!topic.trim()) { setError('Describe the news first — facts, place, time.'); return; }
    if (!apiKey.trim()) { setError('Add your AI API key in Settings first.'); setShowSettings(true); return; }
    setBusy(true);
    try {
      const endpoint = baseUrl.trim().replace(/\/+$/, '') + '/chat/completions';
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: topic.trim() },
      ];
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({ model: model.trim(), messages, temperature: 0.7, max_tokens: 1200 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `AI request failed (HTTP ${res.status})`);
      }
      const content: string = data?.choices?.[0]?.message?.content ?? '';
      if (!content.trim()) throw new Error('The AI returned an empty response.');
      const split = splitTitleBody(content, topic.trim().split('\n')[0].slice(0, 200));
      setTitle(split.title);
      setBody(split.body);
      setResult('Draft generated — review and edit before posting.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
      if (!res.ok) throw new Error(data?.error ?? `Post failed (HTTP ${res.status})`);
      setResult(dryRun ? `Preview OK — ${data.message ?? 'ready to post.'}` : `Posted — ${data.message ?? 'done.'}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        <div className="ai-card glass">
          <ShieldAlert size={28} />
          <h1 className="ai-title">TerraGuard AI</h1>
          <p className="text-muted">Sign in to continue.</p>
          <Link className="ai-btn primary" to="/auth" state={{ from: '/ai' }}>Go to sign in</Link>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="ai-container container">
        <div className="ai-card glass">
          <ShieldAlert size={28} />
          <h1 className="ai-title">Restricted</h1>
          <p className="text-muted">This page is private.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-container container">
      <div className="ai-card glass">
        <h1 className="ai-title"><Sparkles size={20} /> TerraGuard AI News Desk</h1>
        <p className="ai-sub text-muted">Generate a draft with AI, review it, then post to Discord, Facebook, or both.</p>

        <button type="button" className="ai-toggle" onClick={() => setShowSettings((v) => !v)}>
          <KeyRound size={15} /> AI settings {showSettings ? '▾' : '▸'}
        </button>
        {showSettings && (
          <div className="ai-settings">
            <label>API base URL (OpenAI-compatible)
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" spellCheck={false} />
            </label>
            <label>API key (stored only in this browser)
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" autoComplete="off" spellCheck={false} />
            </label>
            <label>Model
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" spellCheck={false} />
            </label>
            <label>System prompt
              <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={6} />
            </label>
            <div className="ai-row">
              <button type="button" className="ai-btn" onClick={saveSettings}>Save settings</button>
              <button type="button" className="ai-btn danger" onClick={clearKey}><Trash2 size={15} /> Remove key</button>
            </div>
          </div>
        )}

        <label className="ai-label">Facts for the AI (what happened, where, when)
          <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={4}
            placeholder="e.g. Magnitude 5.2 earthquake off Davao Oriental, 6:40 AM, felt Intensity III in Mati. No tsunami threat per PHIVOLCS." />
        </label>
        <button type="button" className="ai-btn primary" onClick={generate} disabled={busy || posting}>
          {busy ? (<><Loader2 size={15} className="spin" /> Generating…</>) : (<><Sparkles size={15} /> Generate draft</>)}
        </button>

        <label className="ai-label">Headline
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Headline" />
        </label>
        <label className="ai-label">Body <span className="ai-count">{body.length}/6000</span>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder="News body — editable" />
        </label>
        <label className="ai-label">Image URL (optional, https)
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://… (Facebook posts it as a photo)" spellCheck={false} />
        </label>

        {error && <p className="ai-error">{error}</p>}
        {result && <p className="ai-ok">{result}</p>}

        <div className="ai-actions">
          <button type="button" className="ai-btn" disabled={busy || posting}
            onClick={() => postNews(false, false, true)}>
            <Eye size={15} /> Preview
          </button>
          <button type="button" className="ai-btn primary" disabled={busy || posting} data-skip="none"
            onClick={() => postNews(false, false, false)}>
            <Send size={15} /> Post to Discord &amp; Facebook
          </button>
          <button type="button" className="ai-btn discord" disabled={busy || posting} data-skip="facebook"
            onClick={() => postNews(false, true, false)}>
            <MessageCircle size={15} /> Discord only
          </button>
          <button type="button" className="ai-btn fb" disabled={busy || posting} data-skip="discord"
            onClick={() => postNews(true, false, false)}>
            <Share2 size={15} /> Facebook only
          </button>
        </div>
        <p className="ai-foot text-muted"><Layers size={13} /> Posts carry an “AI-assisted draft · Reviewed by TerraGuard” disclosure.</p>
      </div>
    </div>
  );
}
