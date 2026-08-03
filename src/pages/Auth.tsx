import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogIn, UserPlus, Loader2, ShieldAlert, CheckCircle2, Mail, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

export function Auth() {
  const { user, profile, signIn, signUp, signOut } = useAuth();
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
      </div>
    </div>
  );
}
