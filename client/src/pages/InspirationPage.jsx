import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { useWorkspace } from '../hooks/useWorkspace.jsx';
import { api } from '../services/api.js';

function getBaseUrl(media) {
  return typeof media?.baseUrl === 'string' ? media.baseUrl : '';
}

export default function InspirationPage() {
  const { connectGoogleMedia } = useAuth();
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
        toast.push({ variant: 'error', title: 'Google Photos', message: err.message });
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    loadAlbums();
    return () => {
      cancelled = true;
    };
  }, [toast]);

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

  return (
    <div className="page">
      <Navbar />
      <main className="content">
        <h1>Inspiration</h1>
        <p className="muted">
          Google Photos MVP: pick an album, select up to 6 photos, then generate a concept in one shot.
        </p>

        {!googleConnected ? (
          <EmptyState
            title="Connect Google Photos"
            description="Click below to connect your Google account and authorize Google Photos read access."
            action={
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const ok = await connectGoogleMedia();
                    if (ok) {
                      setGoogleConnected(true);
                      const { data } = await api.get('/api/social/google-photos/albums');
                      setAlbums(Array.isArray(data?.albums) ? data.albums : []);
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
                }}
              >
                {busy ? 'Connecting…' : 'Connect Google Photos'}
              </button>
            }
          />
        ) : (
          <div className="inspo-grid">
            <section className="panel">
              <div className="row-between">
                <h2 className="mb-0">Albums</h2>
                {busy ? <div className="spinner" /> : null}
              </div>
              {!googleConnected ? (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const ok = await connectGoogleMedia();
                      if (ok) {
                        setGoogleConnected(true);
                        const { data } = await api.get('/api/social/google-photos/albums');
                        setAlbums(Array.isArray(data?.albums) ? data.albums : []);
                      } else {
                        toast.push({
                          variant: 'warn',
                          title: 'Google',
                          message: 'Unable to retrieve an access token. Try again.',
                        });
                      }
                    } catch (err) {
                      toast.push({ variant: 'error', title: 'Google', message: err.message });
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                >
                  {busy ? 'Connecting…' : 'Connect Google Photos'}
                </button>
              ) : albums.length === 0 ? (
                <p className="hint small">No albums found (or access wasn’t granted).</p>
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
              <p className="hint small mt-2">
                Tip: if you get an empty list, reconnect and ensure you grant Google Photos permission.
              </p>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
