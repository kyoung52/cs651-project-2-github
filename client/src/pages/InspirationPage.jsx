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

function truncate(s, max) {
  const str = typeof s === 'string' ? s.trim() : '';
  if (!str) return '';
  if (str.length <= max) return str;
  return `${str.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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
  const { isGooglePhotosPickerConfigured, isPinterestConfigured, status } = useConfig();
  const { setDashboardState, resetDashboardState } = useWorkspace();
  const toast = useToast();
  const nav = useNavigate();

  const [source, setSource] = useState('google'); // 'google' | 'pinterest'

  const [albums, setAlbums] = useState([]);
  const [media, setMedia] = useState([]);
  const [selectedAlbum, setSelectedAlbum] = useState(null);
  const [selected, setSelected] = useState([]); // [{ id, baseUrl, mimeType, filename }]
  const [busy, setBusy] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);

  const [pinterestBoards, setPinterestBoards] = useState([]);
  const [pinterestPins, setPinterestPins] = useState([]);
  const [selectedPinterestBoard, setSelectedPinterestBoard] = useState(null);
  const [selectedPinterestPins, setSelectedPinterestPins] = useState([]); // [{ id, imageUrl, title, description, link }]
  const [pinterestConnected, setPinterestConnected] = useState(false);
  const [loadingPinterest, setLoadingPinterest] = useState(false);

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
    let cancelled = false;
    async function loadPinterestBoards() {
      if (!isPinterestConfigured) return;
      setLoadingPinterest(true);
      try {
        const { data } = await api.get('/api/social/pinterest/boards');
        if (cancelled) return;
        setPinterestConnected(Boolean(data?.connected));
        const boards = Array.isArray(data?.boards) ? data.boards : [];
        setPinterestBoards(boards);
      } catch (err) {
        if (cancelled) return;
        toast.push({ variant: 'warn', title: 'Pinterest boards', message: err?.message || 'Unable to load boards.' });
      } finally {
        if (!cancelled) setLoadingPinterest(false);
      }
    }

    if (source === 'pinterest') loadPinterestBoards();
    return () => {
      cancelled = true;
    };
  }, [source, isPinterestConfigured, toast]);

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

  async function openPinterestBoard(board) {
    if (!board?.id) return;
    setSelectedPinterestBoard(board);
    setPinterestPins([]);
    setSelectedPinterestPins([]);
    setLoadingPinterest(true);
    try {
      const { data } = await api.get(
        `/api/social/pinterest/boards/${encodeURIComponent(board.id)}/pins`
      );
      const pins = Array.isArray(data?.pins) ? data.pins : [];
      setPinterestPins(pins);
      setPinterestConnected(Boolean(data?.connected));
    } catch (err) {
      toast.push({ variant: 'error', title: 'Pinterest', message: err?.message || 'Unable to load pins.' });
    } finally {
      setLoadingPinterest(false);
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

  const pinterestMoodboardItems = useMemo(
    () =>
      selectedPinterestPins
        .map((p) => ({
          id: p.id,
          imageUrl: p.imageUrl,
          title: p.title,
          description: p.description,
          link: p.link,
        }))
        .filter((x) => x.id && x.imageUrl),
    [selectedPinterestPins]
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

  function togglePinterestPin(pin) {
    const id = String(pin?.id || '');
    const imageUrl = typeof pin?.imageUrl === 'string' ? pin.imageUrl : '';
    if (!id || !imageUrl) return;
    setSelectedPinterestPins((prev) => {
      const exists = prev.some((p) => p.id === id);
      if (exists) return prev.filter((p) => p.id !== id);
      if (prev.length >= 6) {
        toast.push({ variant: 'warn', title: 'Moodboard', message: 'Select up to 6 pins for the MVP.' });
        return prev;
      }
      return [
        ...prev,
        {
          id,
          imageUrl,
          title: typeof pin?.title === 'string' ? pin.title : '',
          description: typeof pin?.description === 'string' ? pin.description : '',
          link: typeof pin?.link === 'string' ? pin.link : '',
        },
      ];
    });
  }

  function importPinterestBoard() {
    if (!Array.isArray(pinterestPins) || pinterestPins.length === 0) return;
    const picked = [];
    for (const p of pinterestPins) {
      const id = String(p?.id || '');
      const imageUrl = typeof p?.imageUrl === 'string' ? p.imageUrl : '';
      if (!id || !imageUrl) continue;
      picked.push({
        id,
        imageUrl,
        title: typeof p?.title === 'string' ? p.title : '',
        description: typeof p?.description === 'string' ? p.description : '',
        link: typeof p?.link === 'string' ? p.link : '',
      });
      if (picked.length >= 6) break;
    }
    setSelectedPinterestPins(picked);
    if (picked.length === 0) {
      toast.push({
        variant: 'warn',
        title: 'No images found',
        message: 'That board did not return pins with usable image URLs.',
      });
    }
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

  async function generateFromPinterestMoodboard() {
    if (pinterestMoodboardItems.length === 0) return;
    setBusy(true);
    try {
      const boardName = selectedPinterestBoard?.name || selectedPinterestBoard?.title || '';
      const boardLine = boardName ? `Board: ${truncate(boardName, 120)}` : 'Pinterest selection';
      const pinLines = pinterestMoodboardItems
        .slice(0, 6)
        .map((p, idx) => {
          const title = truncate(p.title, 120);
          const desc = truncate(p.description, 200);
          const t = title ? `Title: ${title}` : '';
          const d = desc ? `Notes: ${desc}` : '';
          const bits = [t, d].filter(Boolean).join(' — ');
          return bits ? `${idx + 1}) ${bits}` : `${idx + 1}) (no text)`;
        })
        .join('\n');

      const chatContext =
        'Generate a cohesive room concept inspired by this Pinterest moodboard.\n' +
        `${boardLine}\n` +
        (pinLines ? `Pin notes:\n${pinLines}\n` : '') +
        'Focus on style, palette, materials, and layout.';

      const urls = pinterestMoodboardItems.map((p) => p.imageUrl).filter(Boolean).slice(0, 6);
      const { data } = await api.post(
        '/api/media/process-urls',
        {
          urls,
          chatContext,
          useRealisticFurniture: true,
        },
        {
          timeout: 420_000,
        }
      );

      resetDashboardState();
      setDashboardState({
        messages: [
          { role: 'bot', text: 'Loaded inspiration from Pinterest moodboard.' },
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
      toast.push({ variant: 'error', title: 'Generate', message: err?.message || 'Generation failed.' });
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
          Build a moodboard from Google Photos or Pinterest, then generate a room concept for your workspace.
        </p>

        <section className="panel">
          <div className="row-actions compact">
            <button
              type="button"
              className={source === 'google' ? 'btn-primary' : 'btn-outline'}
              onClick={() => setSource('google')}
              disabled={busy}
            >
              Google Photos
            </button>
            <button
              type="button"
              className={source === 'pinterest' ? 'btn-primary' : 'btn-outline'}
              onClick={() => setSource('pinterest')}
              disabled={busy}
              title={!isPinterestConfigured ? 'Pinterest is not configured on this server.' : undefined}
            >
              Pinterest
            </button>
          </div>
          {source === 'pinterest' && !isPinterestConfigured ? (
            <p className="hint small mt-2">{status?.pinterest?.reason || 'Pinterest is not configured.'}</p>
          ) : null}
        </section>

        {source === 'pinterest' ? (
          !isPinterestConfigured ? null : !pinterestConnected ? (
            <EmptyState
              title="Connect Pinterest"
              description="Connect Pinterest in Settings to browse your boards and import pins into a moodboard."
              action={
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => nav('/settings')}
                >
                  Open Settings
                </button>
              }
            />
          ) : (
            <div className="inspo-grid mt-2">
              <section className="panel">
                <div className="row-between">
                  <h2 className="mb-0">Boards</h2>
                  {loadingPinterest ? <div className="spinner" /> : null}
                </div>
                {pinterestBoards.length === 0 ? (
                  <p className="hint small">No boards found.</p>
                ) : (
                  <ul className="project-list">
                    {pinterestBoards.map((b) => (
                      <li key={b.id} className="project-card">
                        <div className="row-between">
                          <div>
                            <div className="strong">{b.name || b.title || 'Untitled board'}</div>
                            <div className="hint small">{b.pin_count ? `${b.pin_count} pins` : ''}</div>
                          </div>
                          <button
                            type="button"
                            className="btn-outline small"
                            onClick={() => openPinterestBoard(b)}
                            disabled={busy || loadingPinterest}
                          >
                            View pins
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="panel">
                <div className="row-between">
                  <h2 className="mb-0">Pins</h2>
                  {loadingPinterest ? <div className="spinner" /> : null}
                </div>
                {selectedPinterestBoard ? (
                  <p className="hint small mb-2">
                    Board: {selectedPinterestBoard.name || selectedPinterestBoard.title || selectedPinterestBoard.id}
                  </p>
                ) : (
                  <p className="hint small mb-2">Select a board to view pins.</p>
                )}

                {selectedPinterestBoard ? (
                  <div className="row-actions compact mb-2">
                    <button
                      type="button"
                      className="btn-outline"
                      onClick={importPinterestBoard}
                      disabled={busy || loadingPinterest || pinterestPins.length === 0}
                    >
                      Import board (up to 6)
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setSelectedPinterestPins([])}
                      disabled={busy || selectedPinterestPins.length === 0}
                    >
                      Clear selection
                    </button>
                  </div>
                ) : null}

                {pinterestPins.length === 0 ? null : (
                  <div className="pin-grid">
                    {pinterestPins.map((p) => {
                      const url = p.imageUrl;
                      const on = selectedPinterestPins.some((s) => s.id === String(p?.id || ''));
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className={`pin-tile ${on ? 'selected' : ''}`}
                          onClick={() => togglePinterestPin(p)}
                          disabled={!url || busy}
                          title={p.title || 'Pinterest pin'}
                        >
                          {url ? <img src={url} alt={p.title || 'Pin'} /> : <span className="hint small">No image</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="panel">
                <div className="row-between">
                  <h2 className="mb-0">Moodboard</h2>
                  <span className="badge">{pinterestMoodboardItems.length}/6</span>
                </div>

                {pinterestMoodboardItems.length === 0 ? (
                  <p className="hint small">Import a board or click pins to add them here.</p>
                ) : (
                  <div className="pin-grid compact">
                    {selectedPinterestPins.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="pin-tile selected"
                        onClick={() => setSelectedPinterestPins((prev) => prev.filter((x) => x.id !== p.id))}
                        disabled={busy}
                        title="Remove"
                      >
                        <img src={p.imageUrl} alt={p.title || 'Selected'} />
                      </button>
                    ))}
                  </div>
                )}

                <div className="row-actions compact mt-2">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={generateFromPinterestMoodboard}
                    disabled={busy || pinterestMoodboardItems.length === 0}
                  >
                    Generate from moodboard
                  </button>
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => setSelectedPinterestPins([])}
                    disabled={busy || pinterestMoodboardItems.length === 0}
                  >
                    Clear
                  </button>
                </div>
              </section>
            </div>
          )
        ) : !googleConnected ? (
          <EmptyState
            title="Connect Google Photos"
            description="Click below to connect your Google account. Roomify will request the Photos Picker scope so you can choose photos in Google's own dialog."
            action={
              <button type="button" className="btn-primary" disabled={busy} onClick={handleConnectGoogle}>
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
                    Roomify will open Google's hosted picker in a new tab. After you choose your photos and click
                    &quot;Done&quot; there, come back to this page — we&apos;ll detect the selection automatically and
                    generate a concept.
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
                  <p className="hint small mt-2">Selection received. Ready to generate a concept from your picked photos.</p>
                  <div className="row-actions compact mt-2">
                    <button type="button" className="btn-primary" onClick={generateFromPicker} disabled={busy}>
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
                    Waiting for you to finish picking in the Google tab. If the tab didn&apos;t open, use the link below.
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
                    Library API access may be limited (Google deprecated it for new apps). Use the Picker above for the
                    supported flow.
                  </p>
                ) : (
                  <ul className="project-list">
                    {albums.map((a) => (
                      <li key={a.id} className="project-card">
                        <div className="row-between">
                          <div>
                            <div className="strong">{a.title || 'Untitled album'}</div>
                            <div className="hint small">{a.mediaItemsCount ? `${a.mediaItemsCount} items` : ''}</div>
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
                          {url ? <img src={url} alt={m.filename || 'Photo'} /> : <span className="hint small">No image</span>}
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
