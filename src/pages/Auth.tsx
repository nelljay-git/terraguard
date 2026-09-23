import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogIn, UserPlus, Loader2, ShieldAlert, CheckCircle2, Mail, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

export function Auth() {
  const { user, profile, signIn, signUp, signInWithGoogle, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (user) {
    return (
      <div className="auth-container container">
        <div className="auth-card glass">
          <div className="auth-header">
            <div className="auth-avatar">{profile?.username?.[0]?.toUpperCase() ?? 'U'}</div>
            <h1 className="auth-title">Signed in</h1>
            <p className="auth-subtitle text-muted">{profile?.username ?? user.email}</p>
          </div>
          <div className="auth-form">
            <button
              type="button"
              className="auth-submit"
              onClick={async () => {
                await signOut();
                navigate('/');
              }}
            >
              <LogIn size={16} />
              Sign Out
            </button>
            <button type="button" className="auth-link-btn" onClick={() => navigate('/stars')}>
              View My Starred Earthquakes
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!email.trim() || password.length < 6) {
      setError('Enter a valid email and a password of at least 6 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        const err = await signIn(email.trim(), password);
        if (err) {
          setError(err);
        } else {
          navigate(from, { replace: true });
        }
      } else {
        const result = await signUp(email.trim(), password);
        if (result.error) {
          setError(result.error);
        } else if (result.needsConfirmation) {
          setInfo(`We sent a confirmation link to ${email.trim()}. Check your inbox, then come back and sign in.`);
          setEmail('');
          setPassword('');
        } else {
          setInfo('Account created! You are now signed in.');
          navigate(from, { replace: true });
        }
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-container container">
      <div className="auth-card glass">
        <div className="auth-header">
          <h1 className="auth-title">
            {mode === 'login' ? 'Welcome Back' : 'Create Account'}
          </h1>
          <p className="auth-subtitle text-muted">
            {mode === 'login'
              ? 'Sign in to star earthquakes, like events, and join the discussion.'
              : 'Join TerraGuard to track and engage with seismic activity.'}
          </p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => {
              setMode('login');
              setError(null);
              setInfo(null);
            }}
          >
            <LogIn size={15} />
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setMode('signup');
              setError(null);
              setInfo(null);
            }}
          >
            <UserPlus size={15} />
            Create Account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span className="auth-label">Email</span>
            <div className="auth-input-wrap">
              <Mail size={16} className="auth-input-icon" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
          </label>

          <label className="auth-field">
            <span className="auth-label">Password</span>
            <div className="auth-input-wrap">
              <Lock size={16} className="auth-input-icon" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </div>
          </label>

          {error && (
            <div className="auth-message error">
              <ShieldAlert size={16} />
              {error}
            </div>
          )}
          {info && (
            <div className="auth-message info">
              <CheckCircle2 size={16} />
              {info}
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? (
              <Loader2 size={16} className="spin" />
            ) : mode === 'login' ? (
              <LogIn size={16} />
            ) : (
              <UserPlus size={16} />
            )}
            {submitting
              ? 'Please wait...'
              : mode === 'login'
                ? 'Sign In'
                : 'Create Account'}
          </button>

          <p className="auth-note text-muted">
            {mode === 'login' ? "Don't have an account yet?" : 'Already have an account?'}{' '}
            <button
              type="button"
              className="auth-link-btn"
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError(null);
                setInfo(null);
              }}
            >
              {mode === 'login' ? 'Create one now' : 'Sign in instead'}
            </button>
          </p>
        </form>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '14px 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.12)' }} />
          <span className="text-muted" style={{ fontSize: '0.78rem' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.12)' }} />
        </div>

        <button
          type="button"
          className="auth-submit"
          style={{ background: '#fff', color: '#111', border: '1px solid #dadce0', fontWeight: 600 }}
          onClick={async () => {
            setError(null);
            const err = await signInWithGoogle();
            if (err) setError(err);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C34.7 32.1 30.1 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 2.9l6-6C34.5 5.1 29.6 3 24 3 11.3 3 1.1 13.2 1.1 24s10.2 21 22.9 21c11.3 0 20.9-8 20.9-21 0-1.4-.1-2.7-.3-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.5 16.1 18.8 12 24 12c3.1 0 5.9 1.1 8 2.9l6-6C34.5 5.1 29.6 3 24 3 16.3 3 9.6 7.1 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 45c5.3 0 10.2-1.9 13.8-5.2l-6.4-5.2C29.6 36.7 26.9 38 24 38c-6.1 0-10.4-3.9-11.1-9.3l-6.6 5.1C9.6 40.9 16.3 45 24 45z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.6 5.6-6.9 6.9l6.4 5.2c3.6-3.3 5.7-8.1 5.7-13.6 0-1.4-.1-2.7-.3-3.5z"/>
          </svg>
          Continue with Google
        </button>
        <p className="auth-note text-muted" style={{ marginTop: '10px', fontSize: '0.74rem' }}>
          Google sign-in requires enabling the Google provider in Supabase Auth (Google Cloud OAuth client + authorized redirect: <code>https://qiszvooehbfjteyrfryk.supabase.co/auth/v1/callback</code>).
        </p>
      </div>
    </div>
  );
}
