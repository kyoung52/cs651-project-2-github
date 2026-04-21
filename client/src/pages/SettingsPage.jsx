/**
 * Settings page — shows configuration / connection status for each optional
 * integration and surfaces connect / disconnect flows.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import ServiceStatusBadge from '../components/ui/ServiceStatusBadge.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useConfig } from '../hooks/useConfig.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../services/api.js';

const PINTEREST_MESSAGES = {
  connected: { variant: 'success', title: 'Pinterest connected.' },
  error: { variant: 'error', title: 'Pinterest connection failed.' },
  invalid: { variant: 'error', title: 'Pinterest request was invalid.' },
  expired: { variant: 'warn', title: 'Pinterest connection timed out. Try again.' },
  not_configured: {
    variant: 'warn',
    title: 'Pinterest is not configured on this server.',
  },
};

export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    status,
    isGeminiConfigured,
    isPinterestConfigured,
    isGoogleSearchConfigured,
    loading: configLoading,
  } = useConfig();
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [pinterestConnected, setPinterestConnected] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);

  // Surface Pinterest callback status once, then clean the URL
  useEffect(() => {
    const p = searchParams.get('pinterest');
    if (!p) return;
    const notice = PINTEREST_MESSAGES[p];
    if (notice) toast.push(notice);
    setSearchParams({}, { replace: true });
    if (p === 'connected') setPinterestConnected(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Best-effort: infer current connections from server-side responses
  useEffect(() => {
    let cancelled = false;
    async function probeConnections() {
      if (isPinterestConfigured) {
        try {
          const { data } = await api.get('/api/social/pinterest/boards');
          if (!cancelled) setPinterestConnected(Boolean(data?.connected));
        } catch {
          // not connected — fine
        }
      }
      try {
        const { data } = await api.get('/api/social/google-photos/albums');
        if (!cancelled) setGoogleConnected(Boolean(data?.configured));
      } catch {
        // not connected — fine
      }
    }
    if (user) probeConnections();
    return () => {
      cancelled = true;
    };
  }, [user, isPinterestConfigured]);

  const connectPinterest = async () => {
    setBusy(true);
    try {
      const { data } = await api.get('/api/auth/pinterest/url');
      window.location.href = data.url;
    } catch (err) {
      toast.push({ variant: 'error', title: 'Pinterest', message: err.message });
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <Navbar />
      <main className="content narrow">
        <h1>Settings</h1>
        <p className="muted">
          Connect optional integrations. Access tokens stay on the server — never shared with the browser.
        </p>

        <section className="settings-section">
          <div className="settings-row">
            <div>
              <h2>Firebase</h2>
              <p className="muted small">Required for sign-in and project storage.</p>
            </div>
            <ServiceStatusBadge configured={!!status.firebase?.configured} connected={!!user} />
          </div>
          {!status.firebase?.configured && !configLoading ? (
            <p className="hint small">{status.firebase?.reason}</p>
          ) : null}
        </section>

        <section className="settings-section">
          <div className="settings-row">
            <div>
              <h2>Google Gemini</h2>
              <p className="muted small">Powers image/audio analysis and concept generation.</p>
            </div>
            <ServiceStatusBadge configured={isGeminiConfigured} connected={isGeminiConfigured} />
          </div>
          {!isGeminiConfigured && !configLoading ? (
            <p className="hint small">{status.gemini?.reason}</p>
          ) : null}
        </section>

        <section className="settings-section">
          <div className="settings-row">
            <div>
              <h2>Google (Photos &amp; YouTube)</h2>
              <p className="muted small">
                Sign in with Google on the sign-in page to authorize Photos and YouTube scopes.
              </p>
            </div>
            <ServiceStatusBadge configured connected={googleConnected} />
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-row">
            <div>
              <h2>Pinterest</h2>
              <p className="muted small">Optional — browse inspiration from your boards.</p>
            </div>
            <ServiceStatusBadge
              configured={isPinterestConfigured}
              connected={pinterestConnected}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={connectPinterest}
            disabled={busy || !isPinterestConfigured}
            title={
              !isPinterestConfigured
                ? 'Set PINTEREST_APP_ID and PINTEREST_APP_SECRET on the server.'
                : undefined
            }
          >
            {busy
              ? 'Redirecting…'
              : pinterestConnected
                ? 'Reconnect Pinterest'
                : 'Connect Pinterest'}
          </button>
          {!isPinterestConfigured && !configLoading ? (
            <p className="hint small">{status.pinterest?.reason}</p>
          ) : null}
        </section>

        <section className="settings-section">
          <div className="settings-row">
            <div>
              <h2>Image search</h2>
              <p className="muted small">
                Google Custom Search brings similar-inspiration results with match scores.
              </p>
            </div>
            <ServiceStatusBadge
              configured={isGoogleSearchConfigured}
              connected={isGoogleSearchConfigured}
            />
          </div>
          {!isGoogleSearchConfigured && !configLoading ? (
            <p className="hint small">{status.googleSearch?.reason}</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
