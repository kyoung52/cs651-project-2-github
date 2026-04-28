import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useConfig } from '../hooks/useConfig.jsx';
import { useWorkspace } from '../hooks/useWorkspace.jsx';
import { api } from '../services/api.js';

function getBaseUrl(media) {
  return typeof media?.baseUrl === 'string' ? media.baseUrl : '';
}

// Bound the polling cadence the server hands us. The Picker docs default
// to a 5s interval and a 5-minute timeout; we still cap defensively in
// case the server returns something unexpected.
const PICKER_POLL_MIN_MS = 2_000;
const PICKER_POLL_MAX_MS = 30_000;
const PICKER_POLL_DEFAULT_MS = 5_000;
const PICKER_POLL_TIMEOUT_MS = 6 * 60 * 1000;

function durationToMs(d, fallback) {
  // Picker pollingConfig values come back as strings like "5s".
  if (typeof d === 'string') {
    const m = d.match(/^(\d+(?:\.\d+)?)s$/i);
    if (m) return Math.round(Number(m[1]) * 1000);
  }
  if (typeof d === 'number' && Number.isFinite(d)) return d;
  return fallback;
}

export default function InspirationPage() {
  const { connectGoogleMedia } = useAuth();
  const { isGooglePhotosPickerConfigured } = useConfig();
  const { setDashboardState, resetDashboardState } = useWorkspace();
  const toast = useToast();
  const nav = useNavigate();

  const [albums, setAlbums] = useState([]);
  const [media, setMedia] = useState([]);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [selected, setSelected] = useState([]); // [{ id, baseUrl, mimeType, filename }]
  const [busy, setBusy] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);

  // Picker-flow state
  const [pickerSession, setPickerSession] = useState(null); // { sessionId, pickerUri, expireTime }
  const [pickerWaiting, setPickerWaiting] = useState(false);
  const [pickerReady, setPickerReady] = useState(false);
  const pickerTimersRef = useRef({ poll: null, timeout: null });

  useEffect(() => {
    let cancelled = false;
    async function loadAlbums() {
      setBusy(true);
      try {
        const { data } = await api.get('/api/social/google-photos/albums');
        if (cancelled) return;
        setGoogleConnected(Boolean(data?.configured));
        setAlbums(Array.isArray(data?.albums) ? data.albums : []);
      } catch (err) {
        if (cancelled) return;
        // Library being unavailable doesn't disable the Picker path;
        // surface as a soft warn rather than a hard error.
        toast.push({ variant: 'warn', title: 'Google Photos albums', message: err.message });
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    loadAlbums();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pickerTimersRef.current.poll) clearTimeout(pickerTimersRef.current.poll);
      if (pickerTimersRef.current.timeout) clearTimeout(pickerTimersRef.current.timeout);
    };
  }, []);

  const stopPickerPolling = () => {
    if (pickerTimersRef.current.poll) {
      clearTimeout(pickerTimersRef.current.poll);
      pickerTimersRef.current.poll = null;
    }
    if (pickerTimersRef.current.timeout) {
      clearTimeout(pickerTimersRef.current.timeout);
      pickerTimersRef.current.timeout = null;
    }
    setPickerWaiting(false);
  };

  async function startPicker() {
    if (busy || pickerWaiting) return;
    setBusy(true);
    setPickerReady(false);
    try {
      const { data } = await api.post('/api/social/google-photos/picker/session');
      if (!data?.pickerUri || !data?.sessionId) {
        throw new Error('Picker session did not return a URL.');
      }
      const session = {
        sessionId: data.sessionId,
        pickerUri: data.pickerUri,
        expireTime: data.expireTime || null,
      };
      setPickerSession(session);

      // Open the picker dialog in a new tab. Browsers may block this if
      // it's not directly tied to a click — startPicker IS triggered from
      // a click handler so this should succeed.
      const w = window.open(data.pickerUri, '_blank', 'noopener,noreferrer');
      if (!w) {
        toast.push({
          variant: 'warn',
          title: 'Popup blocked',
          message: 'Allow popups for this site, then click "Open picker" below.',
        });
      }

      const intervalMs = Math.max(
        PICKER_POLL_MIN_MS,
        Math.min(
          PICKER_POLL_MAX_MS,
          durationToMs(data?.pollingConfig?.pollInterval, PICKER_POLL_DEFAULT_MS)
        )
      );

      setPickerWaiting(true);

      const tick = async () => {
        try {
          const { data: poll } = await api.get(
            `/api/social/google-photos/picker/session/${encodeURIComponent(session.sessionId)}`
          );
          if (poll?.mediaItemsSet) {
            stopPickerPolling();
            setPickerReady(true);
            return;
          }
        } catch (err) {
          if (err?.code === 'SESSION_NOT_FOUND') {
            stopPickerPolling();
            toast.push({
              variant: 'warn',
              title: 'Picker session expired',
              message: 'Start a new picker session.',
            });
            setPickerSession(null);
            return;
          }
          // Soft errors (network blips) — keep polling.
        }
        pickerTimersRef.current.poll = setTimeout(tick, intervalMs);
      };

      pickerTimersRef.current.poll = setTimeout(tick, intervalMs);
      pickerTimersRef.current.timeout = setTimeout(() => {
        stopPickerPolling();
        toast.push({
          variant: 'warn',
          title: 'Picker timed out',
          message: 'No selection was made within the time limit. Start over.',
        });
      }, PICKER_POLL_TIMEOUT_MS);
    } catch (err) {
      if (err?.code === 'GOOGLE_SCOPE_MISSING') {
        toast.push({
          variant: 'warn',
          title: 'Reconnect Google',
          message:
            'The Google Photos Picker scope is missing. Reconnect Google in Settings and grant access to Photos.',
        });
      } else if (err?.code === 'NOT_CONNECTED') {
        setGoogleConnected(false);
        toast.push({
          variant: 'warn',
          title: 'Not connected',
          message: 'Connect your Google account first.',
        });
      } else {
        toast.push({ variant: 'error', title: 'Picker', message: err?.message || 'Unable to start picker.' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function generateFromPicker() {
    if (!pickerSession?.sessionId) return;
    setBusy(true);
    try {
      const chatContext =
        'Generate a cohesive room concept inspired by these photos.\n' +
        'Google Photos Picker selection.\n' +
        'Focus on style, palette, materials, and layout.';
      const { data } = await api.post('/api/media/process-picker-items', {
        sessionId: pickerSession.sessionId,
        chatContext,
        useRealisticFurniture: true,
      });

      resetDashboardState();
      setDashboardState({
        messages: [
          { role: 'bot', text: 'Loaded inspiration from Google Photos picker.' },
          { role: 'user', text: chatContext },
        ],
        chatContext,
        files: [],
        audioNames: [],
        realistic: true,
        concept: data?.concept || null,
        similar: data?.similarInspiration || [],
        searchWasConfigured: data?.searchConfigured ?? null,
        analysisKeywords: [],
        tab: 'renders',
        regen: data?.regen || null,
      });

      // Local cleanup; server already best-effort deletes the session
      // after responding.
      setPickerSession(null);
      setPickerReady(false);
      nav('/dashboard');
    } catch (err) {
      if (err?.code === 'SESSION_NOT_FOUND') {
        setPickerSession(null);
        setPickerReady(false);
        toast.push({
          variant: 'warn',
          title: 'Picker session expired',
          message: 'Start a new picker session.',
        });
      } else if (err?.code === 'NO_ITEMS') {
        toast.push({
          variant: 'warn',
          title: 'No photos selected',
          message: 'Reopen the picker and select at least one photo.',
        });
      } else {
        toast.push({ variant: 'error', title: 'Generate', message: err?.message || 'Generation failed.' });
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelPicker() {
    stopPickerPolling();
    const sid = pickerSession?.sessionId;
    setPickerSession(null);
    setPickerReady(false);
    if (sid) {
      try {
        await api.delete(`/api/social/google-photos/picker/session/${encodeURIComponent(sid)}`);
      } catch {
        // best-effort
      }
    }
  }

  async function openAlbum(album) {
    setSelectedAlbum(album);
    setMedia([]);
    setLoadingMedia(true);
    try {
      const { data } = await api.get(`/api/social/google-photos/albums/${encodeURIComponent(album.id)}/media`);
      setMedia(Array.isArray(data?.media) ? data.media : []);
    } catch (err) {
      toast.push({ variant: 'error', title: 'Google Photos', message: err.message });
    } finally {
      setLoadingMedia(false);
    }
  }

  const moodboardItems = useMemo(
    () =>
      selected
        .map((s) => ({
          id: s.id,
          baseUrl: s.baseUrl,
          mimeType: s.mimeType,
          filename: s.filename,
        }))
        .filter((x) => x.id && x.baseUrl),
    [selected]
  );

  function toggleMediaItem(item) {
    const id = String(item?.id || '');
    const baseUrl = getBaseUrl(item);
    if (!id || !baseUrl) return;
    setSelected((prev) => {
      const exists = prev.some((p) => p.id === id);
      if (exists) return prev.filter((p) => p.id !== id);
      if (prev.length >= 6) {
        toast.push({ variant: 'warn', title: 'Moodboard', message: 'Select up to 6 photos for the MVP.' });
        return prev;
      }
      return [
        ...prev,
        {
          id,
          baseUrl,
          mimeType: item?.mimeType || '',
          filename: item?.filename || '',
        },
      ];
    });
  }

  async function generateFromMoodboard() {
    if (moodboardItems.length === 0) return;
    setBusy(true);
    try {
      const albumName = selectedAlbum?.title ? `Album: ${selectedAlbum.title}` : 'Google Photos selection';
      const chatContext = `Generate a cohesive room concept inspired by these photos.\n${albumName}\nFocus on style, palette, materials, and layout.`;

      const { data } = await api.post('/api/media/process-google-photos', {
        items: moodboardItems,
        chatContext,
        useRealisticFurniture: true,
      });

      resetDashboardState();
      setDashboardState({
        messages: [
          { role: 'bot', text: 'Loaded inspiration from Google Photos moodboard.' },
          { role: 'user', text: chatContext },
        ],
        chatContext,
        files: [],
        audioNames: [],
        realistic: true,
        concept: data?.concept || null,
        similar: data?.similarInspiration || [],
        searchWasConfigured: data?.searchConfigured ?? null,
        analysisKeywords: [],
        tab: 'renders',
        regen: data?.regen || null,
      });

      nav('/dashboard');
    } catch (err) {
      toast.push({ variant: 'error', title: 'Generate', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectGoogle() {
    setBusy(true);
    try {
      const result = await connectGoogleMedia();
      if (result?.ok) {
        setGoogleConnected(true);
        try {
          const { data } = await api.get('/api/social/google-photos/albums');
          setAlbums(Array.isArray(data?.albums) ? data.albums : []);
        } catch {
          // Library may be unavailable — Picker still works.
        }
        if (!result.hasPickerScope) {
          toast.push({
            variant: 'warn',
            title: 'Limited access',
            message:
              'Picker permission was not granted. You can still browse albums (legacy), but the Picker won\'t open.',
          });
        }
      } else {
        toast.push({
          variant: 'warn',
          title: 'Google',
          message: 'Permission was not granted. Try again and allow Photos access.',
        });
      }
    } catch (err) {
      toast.push({ variant: 'error', title: 'Google', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <Navbar />
      <main className="content">
        <h1>Inspiration</h1>
        <p className="muted">
          Pick photos directly from Google Photos with the new Picker, or browse album-by-album below.
        </p>

        {!googleConnected ? (
          <EmptyState
            title="Connect Google Photos"
            description="Click below to connect your Google account. Roomify will request the Photos Picker scope so you can choose photos in Google's own dialog."
            action={
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={handleConnectGoogle}
              >
                {busy ? 'Connecting…' : 'Connect Google Photos'}
              </button>
            }
          />
        ) : (
          <>
            {/* --- Picker (preferred path) --- */}
            <section className="panel">
              <div className="row-between">
                <h2 className="mb-0">Pick from Google Photos</h2>
                {pickerWaiting ? <div className="spinner" /> : null}
              </div>
              {!isGooglePhotosPickerConfigured ? (
                <p className="hint small mt-2">
                  Picker is disabled on this server (GOOGLE_PHOTOS_PICKER=false). Use the legacy album browser below.
                </p>
              ) : !pickerSession ? (
                <>
                  <p className="hint small mt-2">
                    Roomify will open Google's hosted picker in a new tab. After you choose your
                    photos and click "Done" there, come back to this page — we'll detect the
                    selection automatically and generate a concept.
                  </p>
                  <div className="row-actions compact mt-2">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={startPicker}
                      disabled={busy || pickerWaiting}
                    >
                      {busy ? 'Starting…' : 'Open Google Photos Picker'}
                    </button>
                  </div>
                </>
              ) : pickerReady ? (
                <>
                  <p className="hint small mt-2">
                    Selection received. Ready to generate a concept from your picked photos.
                  </p>
                  <div className="row-actions compact mt-2">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={generateFromPicker}
                      disabled={busy}
                    >
                      {busy ? 'Generating…' : 'Generate from picked photos'}
                    </button>
                    <button type="button" className="btn-outline" onClick={cancelPicker} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="hint small mt-2">
                    Waiting for you to finish picking in the Google tab. If the tab didn't open,
                    use the link below.
                  </p>
                  <div className="row-actions compact mt-2">
                    <a
                      className="btn-outline"
                      href={pickerSession.pickerUri}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open picker
                    </a>
                    <button type="button" className="btn-ghost" onClick={cancelPicker} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </section>

            {/* --- Legacy album browser (Library API) --- */}
            <div className="inspo-grid mt-2">
              <section className="panel">
                <div className="row-between">
                  <h2 className="mb-0">Albums (legacy)</h2>
                  {busy ? <div className="spinner" /> : null}
                </div>
                {albums.length === 0 ? (
                  <p className="hint small">
                    Library API access may be limited (Google deprecated it for new apps).
                    Use the Picker above for the supported flow.
                  </p>
                ) : (
                  <ul className="project-list">
                    {albums.map((a) => (
                      <li key={a.id} className="project-card">
                        <div className="row-between">
                          <div>
                            <div className="strong">{a.title || 'Untitled album'}</div>
                            <div className="hint small">
                              {a.mediaItemsCount ? `${a.mediaItemsCount} items` : ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn-outline small"
                            onClick={() => openAlbum(a)}
                            disabled={busy || loadingMedia}
                          >
                            View photos
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="panel">
                <div className="row-between">
                  <h2 className="mb-0">Photos</h2>
                  {loadingMedia ? <div className="spinner" /> : null}
                </div>
                {selectedAlbum ? (
                  <p className="hint small mb-2">Album: {selectedAlbum.title || selectedAlbum.id}</p>
                ) : (
                  <p className="hint small mb-2">Select an album to view photos.</p>
                )}

                {media.length === 0 ? null : (
                  <div className="pin-grid">
                    {media.map((m) => {
                      const url = getBaseUrl(m);
                      const on = selected.some((s) => s.id === String(m?.id || ''));
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`pin-tile ${on ? 'selected' : ''}`}
                          onClick={() => toggleMediaItem(m)}
                          disabled={!url || busy}
                          title={m.filename || 'Google Photos item'}
                        >
                          {url ? (
                            <img src={url} alt={m.filename || 'Photo'} />
                          ) : (
                            <span className="hint small">No image</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="row-between">
                  <h2 className="mb-0">Moodboard</h2>
                  <span className="badge">{moodboardItems.length}/6</span>
                </div>

                {moodboardItems.length === 0 ? (
                  <p className="hint small">Click photos to add them here.</p>
                ) : (
                  <div className="pin-grid compact">
                    {selected.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="pin-tile selected"
                        onClick={() => setSelected((prev) => prev.filter((p) => p.id !== s.id))}
                        disabled={busy}
                        title="Remove"
                      >
                        <img src={s.baseUrl} alt={s.filename || 'Selected'} />
                      </button>
                    ))}
                  </div>
                )}

                <div className="row-actions compact mt-2">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={generateFromMoodboard}
                    disabled={busy || moodboardItems.length === 0}
                  >
                    Generate from moodboard
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => setSelected([])}
                    disabled={busy || moodboardItems.length === 0}
                  >
                    Clear
                  </button>
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
