import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Check, Copy, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// OAuth landing page for the TikTok Login Kit flow (personal automation).
// TikTok redirects here with ?code=... after approval; the page shows the
// one-time code for copy-paste into the token exchange (5-minute expiry).
// Owner-gated like the other publishing controls.
const OWNER_EMAIL = 'gianganwneljae@gmail.com';

export function TikTokCallback() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const code = params.get('code') || '';
  const error = params.get('error') || '';
  const errorDesc = params.get('error_description') || '';
  const isOwner = user?.email?.toLowerCase() === OWNER_EMAIL;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="glass" style={{ maxWidth: '640px', margin: '48px auto', padding: '28px' }}>
      <h2>TikTok authorization</h2>
      {!user ? (
        <p className="text-muted">
          Sign in first (<Link to="/auth">login page</Link>), then restart the TikTok approve step.
        </p>
      ) : !isOwner ? (
        <p className="text-muted">This page is for the site owner only.</p>
      ) : error ? (
        <p style={{ color: '#ef4444' }}>
          <AlertTriangle size={16} style={{ verticalAlign: '-3px' }} /> TikTok refused: {error}
          {errorDesc ? ` — ${errorDesc}` : ''}
        </p>
      ) : !code ? (
        <p className="text-muted">No authorization code in this URL. Start from the TikTok approve link.</p>
      ) : (
        <>
          <p className="text-muted">
            Approved ✓ — exchange this <strong>one-time code within 5 minutes</strong>:
          </p>
          <p
            style={{
              overflowWrap: 'anywhere',
              background: 'rgba(255,255,255,0.06)',
              padding: '12px',
              borderRadius: '8px',
              fontFamily: 'monospace',
            }}
          >
            {code}
          </p>
          <button type="button" className="action-btn glass flex-center" onClick={copy}>
            {copied ? <Check size={16} color="#10b981" /> : <Copy size={16} />}
            <span>{copied ? 'Copied!' : 'Copy code'}</span>
          </button>
        </>
      )}
    </div>
  );
}
