import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Check, Copy, AlertTriangle, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './TikTokCallback.css';

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
    <div className="ttkb container">
      <section className="ttkb-panel" aria-labelledby="ttkb-title">
        <div className="ttkb-head">
          <KeyRound size={20} aria-hidden="true" />
          <div>
            <span className="ttkb-kicker">Owner tools · OAuth</span>
            <h1 id="ttkb-title" className="ttkb-title">TikTok authorization</h1>
          </div>
        </div>

        {!user ? (
          <p className="ttkb-body">
            Sign in first (<Link to="/auth" className="ttkb-link">login page</Link>), then restart the TikTok approve step.
          </p>
        ) : !isOwner ? (
          <p className="ttkb-body">This page is for the site owner only.</p>
        ) : error ? (
          <p className="ttkb-error" role="alert">
            <AlertTriangle size={17} aria-hidden="true" />
            <span>TikTok refused: {error}{errorDesc ? ` — ${errorDesc}` : ''}</span>
          </p>
        ) : !code ? (
          <p className="ttkb-body">No authorization code in this URL. Start from the TikTok approve link.</p>
        ) : (
          <>
            <p className="ttkb-body">
              Approved. Exchange this <strong>one-time code within 5 minutes</strong>:
            </p>
            <code className="ttkb-code" tabIndex={0}>{code}</code>
            <button type="button" className="ttkb-copy" onClick={copy}>
              {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
              <span>{copied ? 'Copied!' : 'Copy code'}</span>
            </button>
          </>
        )}
      </section>
    </div>
  );
}
