import Navbar from '../components/Navbar.jsx';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EmptyState from '../components/ui/EmptyState.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useWorkspace } from '../hooks/useWorkspace.jsx';
import { api } from '../services/api.js';

/**
 * Placeholder browse experience — extend with public Firestore query later.
 */
export default function ExplorePage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();
  const { exploreState, setExploreState, setDashboardState } = useWorkspace();

  useEffect(() => {
    // Restore Explore state (SPA-only) so rendered previews persist.
    if (exploreState?.projects?.length) {
      setProjects(exploreState.projects);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/explore/feed');
        if (!cancelled) setProjects(data.projects || []);
      } catch (err) {
        if (!cancelled) toast.push({ variant: 'error', title: 'Explore', message: err.message });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      setExploreState({ projects });
    };
  }, [projects, setExploreState]);

  const continueFrom = (p) => {
    setDashboardState({
      messages: [
        {
          role: 'bot',
          text: `Started from a published concept: \"${p?.name || 'Project'}\". Make it your own.`,
        },
      ],
      chatContext: p?.regen?.conceptGenInput?.chatContext || '',
      files: [],
      audioNames: [],
      realistic: p?.regen?.conceptGenInput?.useRealisticFurniture ?? true,
      concept: p?.concept || null,
      similar: [],
      searchWasConfigured: null,
      analysisKeywords: p?.concept?.analysisKeywords || [],
      tab: 'renders',
      regen: p?.regen || null,
    });
    navigate('/dashboard');
  };

  const renderPreview = async (p) => {
    const key = `${p.ownerUid}/${p.id}`;
    setBusyKey(key);
    try {
      const { data } = await api.post('/api/explore/render', {
        ownerUid: p.ownerUid,
        projectId: p.id,
      });
      setProjects((prev) =>
        prev.map((x) => (x.id === p.id && x.ownerUid === p.ownerUid ? { ...x, previewImage: data.image } : x))
      );
    } catch (err) {
      toast.push({ variant: 'error', title: 'Preview', message: err.message });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="page">
      <Navbar />
      <main className="content narrow">
        <h1>Explore</h1>
        <p className="muted">
          Discover public room concepts and trends. Connect your data sources in Settings to personalize Explore.
        </p>
        {loading ? (
          <div className="page-center">
            <div className="spinner" aria-label="Loading" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState title="No published projects yet" description="Publish a project from the Projects tab to see it here." />
        ) : (
          <ul className="project-list">
            {projects.map((p) => {
              const key = `${p.ownerUid}/${p.id}`;
              return (
                <li key={key} className="project-card">
                  <div className="row-between">
                    <div>
                      <h3>{p.name}</h3>
                      <p className="muted small">
                        {p.publishedAt ? new Date(p.publishedAt).toLocaleString() : ''}
                      </p>
                      {p.concept?.styleLabel ? <p className="muted small">{p.concept.styleLabel}</p> : null}
                    </div>
                    <div className="row-actions compact">
                      <button
                        type="button"
                        className="btn-outline small"
                        onClick={() => renderPreview(p)}
                        disabled={busyKey === key}
                      >
                        {busyKey === key
                          ? 'Rendering…'
                          : p.previewImage
                            ? 'Re-render preview'
                            : 'Render preview'}
                      </button>
                      <button type="button" className="btn-primary small" onClick={() => continueFrom(p)}>
                        Continue
                      </button>
                    </div>
                  </div>

                  {busyKey === key ? (
                    <div className="concept-image-wrap mt-2 center-grid">
                      <div className="spinner" aria-label="Rendering preview" />
                    </div>
                  ) : p.previewImage ? (
                    <div className="concept-image-wrap mt-2">
                      <img src={p.previewImage} alt={p.name} className="concept-image" />
                    </div>
                  ) : null}

                  {p.concept?.conceptDescription ? (
                    <p className="muted small mt-2">{p.concept.conceptDescription}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
