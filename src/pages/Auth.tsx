import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { LogIn, UserPlus, Loader2, ShieldAlert, CheckCircle2, Mail, Lock, Star, MessagesSquare, Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import logoSrc from '../assets/logo.png';
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
    <div className="auth-page">
      <div className="auth-split">
        {/* ══════════ Editorial aside ══════════ */}
        <aside className="auth-aside" aria-hidden="false">
          <Link to="/" className="auth-brand" aria-label="TerraGuard — home">
            <img src={logoSrc} alt="" className="auth-brand-logo" />
            <span className="auth-brand-text">
              <span className="auth-brand-name">TerraGuard</span>
              <span className="auth-brand-sub">Seismic Monitor</span>
            </span>
          </Link>

          <div className="auth-aside-body">
            <span className="auth-aside-kicker">Accounts</span>
            <p className="auth-aside-headline">
              One account.<br />
              The whole seismic picture.
            </p>
            <ul className="auth-aside-list">
              <li><Star size={15} aria-hidden="true" /> Star any event and build your own watchlist</li>
              <li><MessagesSquare size={15} aria-hidden="true" /> Join the community bulletin</li>
              <li><Bell size={15} aria-hidden="true" /> Get browser alerts for the zones you care about</li>
            </ul>
          </div>

          {/* Flat seismic trace — decorative */}
          <svg className="auth-trace" viewBox="0 0 400 72" fill="none" aria-hidden="true" preserveAspectRatio="none">
            <path
              d="M0 40h60l6-4 5 8 6-22 7 30 6-12 5 6 8-4h56l6-3 5 6 6-18 7 24 6-10 5 5 8-3h160"
              stroke="#3b82f6"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity="0.85"
            />
            <path
              d="M0 40h60l6-4 5 8 6-22 7 30 6-12 5 6 8-4h56l6-3 5 6 6-18 7 24 6-10 5 5 8-3h160"
              stroke="#3b82f6"
              strokeWidth="6"
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity="0.12"
            />
          </svg>
          <p className="auth-aside-foot">Independent · Non-commercial · PHIVOLCS · USGS · EMSC</p>
        </aside>

        {/* ══════════ Form panel ══════════ */}
        <main className="auth-main">
          {user ? (
            <div className="auth-card">
              <div className="auth-header">
                <div className="auth-avatar" aria-hidden="true">
                  {(profile?.username?.[0] ?? user.email?.[0] ?? 'U').toUpperCase()}
                </div>
                <h1 className="auth-title">Signed in</h1>
                <p className="auth-subtitle">{profile?.username ?? user.email}</p>
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
                  <LogIn size={16} aria-hidden="true" />
                  Sign Out
                </button>
                <button type="button" className="auth-link-btn auth-link-center" onClick={() => navigate('/stars')}>
                  View my starred earthquakes
                </button>
              </div>
            </div>
          ) : (
            <div className="auth-card">
              <div className="auth-header">
                <h1 className="auth-title">
                  {mode === 'login' ? 'Welcome back' : 'Create your account'}
                </h1>
                <p className="auth-subtitle">
                  {mode === 'login'
                    ? 'Sign in to star earthquakes, join the discussion, and get alerts.'
                    : 'Join TerraGuard to track and discuss seismic activity.'}
                </p>
              </div>

              <div className="auth-tabs" role="tablist" aria-label="Sign in or create account">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
                  onClick={() => { setMode('login'); setError(null); setInfo(null); }}
                >
                  <LogIn size={15} aria-hidden="true" />
                  Sign In
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  className={`auth-tab ${mode === 'signup' ? 'active' : ''}`}
                  onClick={() => { setMode('signup'); setError(null); setInfo(null); }}
                >
                  <UserPlus size={15} aria-hidden="true" />
                  Create Account
                </button>
              </div>

              <form className="auth-form" onSubmit={handleSubmit}>
                <label className="auth-field">
                  <span className="auth-label">Email</span>
                  <div className="auth-input-wrap">
                    <Mail size={16} className="auth-input-icon" aria-hidden="true" />
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
                    <Lock size={16} className="auth-input-icon" aria-hidden="true" />
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
                  <div className="auth-message error" role="alert">
                    <ShieldAlert size={16} aria-hidden="true" />
                    {error}
                  </div>
                )}
                {info && (
                  <div className="auth-message info" role="status">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    {info}
                  </div>
                )}

                <button type="submit" className="auth-submit" disabled={submitting}>
                  {submitting ? (
                    <Loader2 size={16} className="spin" aria-hidden="true" />
                  ) : mode === 'login' ? (
                    <LogIn size={16} aria-hidden="true" />
                  ) : (
                    <UserPlus size={16} aria-hidden="true" />
                  )}
                  {submitting
                    ? 'Please wait…'
                    : mode === 'login'
                      ? 'Sign In'
                      : 'Create Account'}
                </button>

                <p className="auth-note">
                  {mode === 'login' ? "Don't have an account yet?" : 'Already have an account?'}{' '}
                  <button
                    type="button"
                    className="auth-link-btn"
                    onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setInfo(null); }}
                  >
                    {mode === 'login' ? 'Create one now' : 'Sign in instead'}
                  </button>
                </p>
              </form>

              <div className="auth-divider" aria-hidden="true">
                <span className="auth-divider-line" />
                <span className="auth-divider-text">or</span>
                <span className="auth-divider-line" />
              </div>

              <button
                type="button"
                className="auth-google"
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
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
