/**
 * Sign-in / sign-up screen.
 *
 * Polished: clearer copy, inline validation, toast feedback, and actionable
 * guidance when Firebase isn't configured on the client.
 */
import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { isValidEmail, isReasonablePassword } from '../utils/validators.js';

export default function SignInPage() {
  const { user, signInEmail, signUpEmail, signInGoogle, loading, firebaseReady } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });

  const emailError = useMemo(
    () => (touched.email && email && !isValidEmail(email) ? 'Enter a valid email.' : ''),
    [touched.email, email]
  );
  const passwordError = useMemo(
    () =>
      touched.password && password && !isReasonablePassword(password)
        ? 'Password must be 8–128 characters.'
        : '',
    [touched.password, password]
  );

  if (!firebaseReady) {
    return (
      <div className="auth-page">
        <div className="auth-backdrop" />
        <div className="auth-card glass">
          <h1 className="auth-title">Firebase not configured</h1>
          <p className="muted small">
            Roomify uses Firebase for authentication. Add the following keys to{' '}
            <code>client/.env</code>, then rebuild the SPA:
          </p>
          <pre className="code-block" aria-label="Required env vars">{`APP_FIREBASE_API_KEY=
APP_FIREBASE_AUTH_DOMAIN=
APP_FIREBASE_PROJECT_ID=
APP_FIREBASE_STORAGE_BUCKET=
APP_FIREBASE_MESSAGING_SENDER_ID=
APP_FIREBASE_APP_ID=`}</pre>
          <p className="auth-privacy-link">
            <Link to="/privacy">Privacy Policy</Link>
          </p>
        </div>
      </div>
    );
  }

  if (user && !loading) {
    return <Navigate to="/dashboard" replace />;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    if (!isValidEmail(email) || !isReasonablePassword(password)) return;
    setBusy(true);
    try {
      if (showCreate) {
        await signUpEmail(email.trim(), password);
      } else {
        await signInEmail(email.trim(), password);
      }
      navigate('/dashboard');
    } catch (err) {
      toast.push({
        variant: 'error',
        title: showCreate ? 'Sign up failed' : 'Sign in failed',
        message: err.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    setBusy(true);
    try {
      await signInGoogle();
      navigate('/dashboard');
    } catch (err) {
      toast.push({ variant: 'error', title: 'Google sign-in failed', message: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-backdrop" />
      <div className="auth-card glass">
        <p className="brand-kicker">ROOMIFY</p>
        <h1 className="auth-title">{showCreate ? 'Create your account' : 'Welcome back'}</h1>
        <p className="muted small">
          {showCreate
            ? 'Start generating AI-assisted room concepts in seconds.'
            : 'Sign in to continue designing your space.'}
        </p>

        <div className="oauth-buttons">
          <button type="button" className="btn-oauth google" onClick={onGoogle} disabled={busy}>
            Continue with Google
          </button>
          <p className="hint small">
            You’ll be able to connect Google Photos &amp; YouTube after signing in.
          </p>
        </div>

        <div className="divider">
          <span>or continue with email</span>
        </div>

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          <label className="sr-only" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={!!emailError}
            maxLength={254}
            required
          />
          {emailError ? <p className="error-text small">{emailError}</p> : null}
          <label className="sr-only" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete={showCreate ? 'new-password' : 'current-password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={!!passwordError}
            minLength={8}
            maxLength={128}
            required
          />
          {passwordError ? <p className="error-text small">{passwordError}</p> : null}
          <button type="submit" className="btn-primary full" disabled={busy}>
            {busy ? 'Working…' : showCreate ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <div className="auth-footer">
          <button
            type="button"
            className="link-btn"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate
              ? 'Already have an account? Sign in'
              : 'New to Roomify? Create an account'}
          </button>
          <p className="auth-privacy-link">
            By continuing you agree to our <Link to="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
