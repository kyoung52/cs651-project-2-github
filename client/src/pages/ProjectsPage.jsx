import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import Modal from '../components/ui/Modal.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useWorkspace } from '../hooks/useWorkspace.jsx';
import { api } from '../services/api.js';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();
  const { setDashboardState } = useWorkspace();

  const loadProjects = async (signal) => {
    const { data } = await api.get('/api/gemini/projects', { signal });
    setProjects(data.projects || []);
  };

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        await loadProjects(controller.signal);
      } catch (err) {
        if (!cancelled) {
          toast.push({ variant: 'error', title: 'Projects', message: err.message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDetails = async (projectId) => {
    setBusyId(projectId);
    try {
      const { data } = await api.get(`/api/gemini/projects/${encodeURIComponent(projectId)}`);
      setDetails(data.project || null);
      setSelected(projectId);
      setDetailsOpen(true);
    } catch (err) {
      toast.push({ variant: 'error', title: 'Project', message: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const onContinue = (project) => {
    const payload = project?.payload || {};
    const concept = payload.concept || null;
    const similar = payload.similar || [];
    const regen = payload.regen || null;

    setDashboardState({
      messages: [
        {
          role: 'bot',
          text: `Loaded project \"${project?.name || 'Project'}\". You can refine or regenerate from here.`,
        },
      ],
      chatContext: regen?.conceptGenInput?.chatContext || '',
      files: [],
      audioNames: [],
      realistic: regen?.conceptGenInput?.useRealisticFurniture ?? true,
      concept,
      similar,
      searchWasConfigured: null,
      analysisKeywords: concept?.analysisKeywords || [],
      tab: 'renders',
      regen,
    });

    setDetailsOpen(false);
    navigate('/dashboard');
  };

  const onDelete = async (projectId) => {
    if (!window.confirm('Delete this project? This cannot be undone.')) return;
    setBusyId(projectId);
    try {
      await api.delete(`/api/gemini/projects/${encodeURIComponent(projectId)}`);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      if (selected === projectId) {
        setSelected(null);
        setDetails(null);
        setDetailsOpen(false);
      }
      toast.push({ variant: 'success', title: 'Project deleted' });
    } catch (err) {
      toast.push({ variant: 'error', title: 'Delete failed', message: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const detailsSummary = useMemo(() => {
    if (!details) return null;
    const concept = details?.payload?.concept || {};
    return {
      createdAt: details.createdAt ? new Date(details.createdAt).toLocaleString() : '',
      title: concept.title || '',
      styleLabel: concept.styleLabel || '',
      desc: concept.conceptDescription || '',
      keywords: Array.isArray(concept.searchKeywords) ? concept.searchKeywords.slice(0, 8) : [],
      hasRegen: Boolean(details?.payload?.regen),
      regenSeed: details?.payload?.regen?.regenSeed || '',
    };
  }, [details]);

  return (
    <div className="page">
      <Navbar />
      <main className="content narrow">
        <h1>Your projects</h1>
        {loading ? (
          <div className="page-center">
            <div className="spinner" aria-label="Loading" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            title="No saved projects yet"
            description="Generate a concept on the dashboard and save it to see it here."
          />
        ) : (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id} className="project-card">
                <div className="row-between">
                  <div>
                    <h3>{p.name}</h3>
                    <p className="muted small">
                      {p.createdAt ? new Date(p.createdAt).toLocaleString() : ''}
                    </p>
                  </div>
                  <div className="row-actions compact">
                    <button
                      type="button"
                      className="btn-outline small"
                      onClick={() => openDetails(p.id)}
                      disabled={busyId === p.id}
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      className="btn-outline small"
                      onClick={async () => {
                        setBusyId(p.id);
                        try {
                          const next = !(p.published === true);
                          await api.post(`/api/gemini/projects/${encodeURIComponent(p.id)}/publish`, {
                            published: next,
                          });
                          setProjects((prev) =>
                            prev.map((x) => (x.id === p.id ? { ...x, published: next } : x))
                          );
                          toast.push({
                            variant: 'success',
                            title: next ? 'Published' : 'Unpublished',
                            message: next ? 'Visible in Explore.' : 'Hidden from Explore.',
                          });
                        } catch (err) {
                          toast.push({ variant: 'error', title: 'Publish', message: err.message });
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      disabled={busyId === p.id}
                    >
                      {p.published ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      type="button"
                      className="btn-outline small"
                      onClick={() => onDelete(p.id)}
                      disabled={busyId === p.id}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      <Modal
        open={detailsOpen}
        title={details?.name || 'Project'}
        onClose={() => setDetailsOpen(false)}
        size="sm"
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => setDetailsOpen(false)}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onContinue(details)}
              disabled={!details}
            >
              Continue in Dashboard
            </button>
          </>
        }
      >
        {details ? (
          <>
            <p className="muted small">{detailsSummary?.createdAt}</p>
            {detailsSummary?.styleLabel ? <p><strong>Style:</strong> {detailsSummary.styleLabel}</p> : null}
            {detailsSummary?.title ? <p><strong>Concept:</strong> {detailsSummary.title}</p> : null}
            {detailsSummary?.desc ? <p className="muted">{detailsSummary.desc}</p> : null}
            {detailsSummary?.keywords?.length ? (
              <div className="chips mt-2">
                {detailsSummary.keywords.map((k, i) => (
                  <span key={i} className="chip">{k}</span>
                ))}
              </div>
            ) : null}
            <p className="muted small mt-2">
              Regen context saved: {detailsSummary?.hasRegen ? 'yes' : 'no'}
              {detailsSummary?.regenSeed ? ` (seed: ${detailsSummary.regenSeed})` : ''}
            </p>
          </>
        ) : (
          <div className="spinner" aria-label="Loading" />
        )}
      </Modal>
    </div>
  );
}
