/**
 * Dashboard — the core Roomify workspace.
 *
 * Three columns: chat + uploads (left), featured concept / blueprints
 * (center), similar inspiration (right). Uses modals for refine/save,
 * toasts for non-blocking errors, and empty-state copy that reflects the
 * current service configuration.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import ChatBot from '../components/ChatBot.jsx';
import RoomConcept from '../components/RoomConcept.jsx';
import SimilarInspiration from '../components/SimilarInspiration.jsx';
import AnalysisPanel from '../components/AnalysisPanel.jsx';
import ColorPalette from '../components/ColorPalette.jsx';
import MediaUpload from '../components/MediaUpload.jsx';
import BlueprintView from '../components/BlueprintView.jsx';
import Navbar from '../components/Navbar.jsx';
import Modal from '../components/ui/Modal.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useConfig } from '../hooks/useConfig.jsx';
import { useWorkspace } from '../hooks/useWorkspace.jsx';
import { api } from '../services/api.js';
import { sanitizeChatInput } from '../utils/validators.js';

const WELCOME_MESSAGE = {
  role: 'bot',
  text: "Hi — describe your space, upload images or audio, and I'll suggest a cohesive style direction.",
};

export default function DashboardPage() {
  const { isGeminiConfigured, isGoogleSearchConfigured, loading: configLoading } = useConfig();
  const { dashboardState, setDashboardState, resetDashboardState } = useWorkspace();
  const toast = useToast();

  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [chatContext, setChatContext] = useState('');
  const [files, setFiles] = useState([]);
  const [audioNames, setAudioNames] = useState([]);
  const [realistic, setRealistic] = useState(true);
  const [concept, setConcept] = useState(null);
  const [similar, setSimilar] = useState([]);
  const [searchWasConfigured, setSearchWasConfigured] = useState(null);
  const [analysisKeywords, setAnalysisKeywords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [tab, setTab] = useState('renders');
  const [regen, setRegen] = useState(null);

  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [rerenderingHero, setRerenderingHero] = useState(false);

  // Restore workspace state when returning to the Dashboard route.
  useEffect(() => {
    if (!dashboardState) return;
    setMessages(dashboardState.messages || [WELCOME_MESSAGE]);
    setChatContext(dashboardState.chatContext || '');
    // Files are not restored across navigation: File objects can lose their
    // underlying blob (notably on iOS Safari), and refine still works using
    // the cached server-side analyses in `regen.conceptGenInput.imageAnalyses`.
    setFiles([]);
    setAudioNames(dashboardState.audioNames || []);
    setRealistic(dashboardState.realistic ?? true);
    setConcept(dashboardState.concept || null);
    setSimilar(dashboardState.similar || []);
    setSearchWasConfigured(dashboardState.searchWasConfigured ?? null);
    setAnalysisKeywords(dashboardState.analysisKeywords || []);
    setTab(dashboardState.tab || 'renders');
    setRegen(dashboardState.regen || null);
    setLoading(false);
    setGenerationProgress(0);

    // Saved-project hero re-render: the original data URI was stripped at save
    // time, so when Continue lands here with no featuredImage, fire a render
    // and swap it in. Failures (Vertex disabled, rate-limited) are ignored.
    const projectId = dashboardState.loadedProjectId;
    const savedConcept = dashboardState.concept;
    if (projectId && savedConcept && !savedConcept.featuredImage) {
      setRerenderingHero(true);
      api
        .post(`/api/gemini/projects/${encodeURIComponent(projectId)}/render`)
        .then(({ data }) => {
          if (data?.image) {
            setConcept((c) => (c ? { ...c, featuredImage: data.image } : c));
          }
        })
        .catch(() => {})
        .finally(() => setRerenderingHero(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the workspace state when navigating away.
  useEffect(() => {
    return () => {
      setDashboardState((prev) => ({
        messages,
        chatContext,
        files: [], // see restore effect — File objects are not safe to persist
        audioNames,
        realistic,
        concept,
        similar,
        searchWasConfigured,
        analysisKeywords,
        tab,
        regen,
        // Preserve loadedProjectId so a hero re-render that didn't complete
        // before navigation can retry on remount (skipped once concept has an image).
        loadedProjectId: prev?.loadedProjectId || null,
      }));
    };
  }, [
    setDashboardState,
    messages,
    chatContext,
    files,
    audioNames,
    realistic,
    concept,
    similar,
    searchWasConfigured,
    analysisKeywords,
    tab,
    regen,
  ]);

  const resetWorkspace = () => {
    resetDashboardState();
    setMessages([WELCOME_MESSAGE]);
    setChatContext('');
    setFiles([]);
    setAudioNames([]);
    setRealistic(true);
    setConcept(null);
    setSimilar([]);
    setSearchWasConfigured(null);
    setAnalysisKeywords([]);
    setTab('renders');
    setRegen(null);
    setLoading(false);
    setGenerationProgress(0);
    setRefineOpen(false);
    setRefineText('');
    setSaveOpen(false);
    setSaveName('');
  };

  const appendMessage = useCallback((role, text) => {
    setMessages((m) => [...m, { role, text }]);
  }, []);

  useEffect(() => {
    if (!configLoading && !isGeminiConfigured) {
      toast.push({
        variant: 'warn',
        title: 'AI generation unavailable',
        message:
          'AI is not configured on the server (Vertex project + location). You can still explore the UI, but concept generation is disabled.',
        duration: 7000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoading, isGeminiConfigured]);

  useEffect(() => {
    if (!loading) return undefined;
    const id = setInterval(() => {
      setGenerationProgress((p) => {
        if (p >= 92) return p;
        return p + 1 + Math.random() * 2.2;
      });
    }, 360);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (loading || generationProgress !== 100) return undefined;
    const t = setTimeout(() => setGenerationProgress(0), 450);
    return () => clearTimeout(t);
  }, [loading, generationProgress]);

  const onSend = (text) => {
    const clean = sanitizeChatInput(text);
    if (!clean) return;
    appendMessage('user', clean);
    setChatContext((c) => `${c}\n${clean}`.trim());
  };

  const onFiles = (newFiles) => {
    setFiles((prev) => [...prev, ...newFiles]);
    const audio = newFiles.filter((f) => f.type.startsWith('audio/')).map((f) => f.name);
    if (audio.length) {
      setAudioNames((a) => [...a, ...audio]);
    }
    appendMessage('user', `Added ${newFiles.length} file${newFiles.length === 1 ? '' : 's'} for processing.`);
  };

  const removeFile = (index) => {
    setFiles((list) => list.filter((_, i) => i !== index));
  };

  const generate = async () => {
    if (!files.length) {
      toast.push({
        variant: 'warn',
        title: 'Add media first',
        message: 'Upload at least one image or audio file to generate a concept.',
      });
      return;
    }
    if (!isGeminiConfigured) {
      toast.push({
        variant: 'warn',
        title: 'AI generation unavailable',
        message: 'Configure Vertex AI (project + location) on the server to enable concept generation.',
      });
      return;
    }

    setGenerationProgress(6);
    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('chatContext', chatContext);
      fd.append('useRealisticFurniture', realistic ? 'true' : 'false');

      const { data } = await api.post('/api/media/process', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
        onUploadProgress(ev) {
          if (!ev.total) return;
          const u = Math.round((ev.loaded / ev.total) * 34);
          setGenerationProgress((p) => Math.max(p, Math.min(34, u)));
        },
      });

      setConcept(data.concept);
      setSimilar(data.similarInspiration || []);
      setSearchWasConfigured(Boolean(data.searchConfigured));
      setAnalysisKeywords(data.concept?.analysisKeywords || []);
      setRegen(data.regen || null);
      appendMessage(
        'bot',
        `Suggested style: ${data.concept?.styleLabel || 'Your mix'}. ${data.concept?.conceptDescription || ''}`
      );
      toast.push({
        variant: 'success',
        title: 'Concept ready',
        message: data.concept?.title || 'Your room concept was generated.',
      });
      setGenerationProgress(100);
    } catch (err) {
      setGenerationProgress(0);
      toast.push({ variant: 'error', title: 'Generation failed', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const submitRefine = async () => {
    const clean = sanitizeChatInput(refineText);
    if (!clean) return;
    setRefineOpen(false);
    setGenerationProgress(10);
    setLoading(true);
    try {
      const fd = new FormData();
      // Allow refining with any current uploads (and any newly added files).
      files.forEach((f) => fd.append('files', f));

      // Strip featuredImage before stringifying. A 1-2 MB data: URI inside a
      // multipart text field would blow past multer's per-field size limit
      // and silently break refines. Send the prior render separately as a
      // file part so the server uses it as a visual reference for continuity.
      const conceptForJson = concept ? { ...concept, featuredImage: null } : {};
      fd.append('previousConcept', JSON.stringify(conceptForJson));
      const prior = concept?.featuredImage;
      if (typeof prior === 'string' && prior.startsWith('data:image/')) {
        try {
          const blob = await (await fetch(prior)).blob();
          if (blob.size > 0 && blob.size <= 10 * 1024 * 1024) {
            fd.append('previousRender', blob, 'previous-render.png');
          }
        } catch (e) {
          // Non-fatal — refine still works without the visual reference.
          console.warn('[refine] could not attach previous render:', e?.message || e);
        }
      }

      fd.append('feedback', clean);
      fd.append('chatContext', chatContext);
      if (regen) fd.append('regen', JSON.stringify(regen));

      const { data } = await api.post('/api/media/refine', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
      });

      setConcept(data.concept || null);
      setSimilar(data.similarInspiration || []);
      setSearchWasConfigured(Boolean(data.searchConfigured));
      setAnalysisKeywords(data.concept?.analysisKeywords || []);
      setRegen(data.regen || null);
      appendMessage('user', clean);
      appendMessage('bot', 'Updated the concept and re-rendered the room image.');
      toast.push({ variant: 'success', title: 'Concept refined' });
      setGenerationProgress(100);
    } catch (err) {
      setGenerationProgress(0);
      toast.push({ variant: 'error', title: 'Refine failed', message: err.message });
    } finally {
      setLoading(false);
      setRefineText('');
    }
  };

  const submitSave = async () => {
    const name = sanitizeChatInput(saveName).slice(0, 120);
    if (!name) return;
    setSaveOpen(false);
    try {
      await api.post('/api/gemini/save-project', {
        name,
        payload: { concept, similar, regen },
      });
      appendMessage('bot', `Saved project "${name}".`);
      toast.push({ variant: 'success', title: 'Project saved', message: name });
    } catch (err) {
      toast.push({ variant: 'error', title: 'Save failed', message: err.message });
    } finally {
      setSaveName('');
    }
  };

  const centerBody = useMemo(() => {
    if (loading || concept) {
      return tab === 'renders' ? (
        <RoomConcept
          concept={concept}
          loading={loading}
          generationProgress={generationProgress}
          rerenderingHero={rerenderingHero}
        />
      ) : (
        <BlueprintView notes={concept?.blueprintNotes} blueprint={concept?.blueprint} />
      );
    }

    if (!isGeminiConfigured && !configLoading) {
      return (
        <EmptyState
          tone="warn"
          title="Concept generation is disabled"
          description="Configure Vertex AI (project + location) on the server to enable AI-powered room design. The app keeps running in read-only mode."
        />
      );
    }
    if (!files.length) {
      return (
        <EmptyState
          title="Upload media to begin"
          description="Drop images (JPEG / PNG / WebP) or audio (MP3 / WAV) in the left panel, then press Generate."
        />
      );
    }
    return (
      <EmptyState
        title="Ready when you are"
        description={`${files.length} file${files.length === 1 ? '' : 's'} queued. Click Generate to create your concept.`}
      />
    );
  }, [loading, concept, tab, isGeminiConfigured, configLoading, files.length, generationProgress, rerenderingHero]);

  const rightBody = useMemo(() => {
    if (loading) {
      return (
        <div className="panel side-panel">
          <h3 className="panel-title">Similar inspiration</h3>
          <div className="spinner" aria-label="Loading" />
        </div>
      );
    }
    if (!concept) {
      return (
        <div className="panel side-panel">
          <h3 className="panel-title">Similar inspiration</h3>
          <p className="muted small">Matched images appear here after generation.</p>
        </div>
      );
    }
    if (searchWasConfigured === false || (!isGoogleSearchConfigured && similar.length === 0)) {
      return (
        <div className="panel side-panel">
          <h3 className="panel-title">Similar inspiration</h3>
          <EmptyState
            tone="warn"
            title="Image search is off"
            description="Add GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID on the server to see similar inspiration with confidence scores."
          />
        </div>
      );
    }
    return <SimilarInspiration results={similar} />;
  }, [loading, concept, similar, searchWasConfigured, isGoogleSearchConfigured]);

  const generateDisabled = loading || !files.length || (!configLoading && !isGeminiConfigured);
  const generateLabel = loading
    ? 'Working…'
    : !isGeminiConfigured && !configLoading
      ? 'AI not configured'
      : 'Generate room concept';

  return (
    <div className="page dashboard">
      <Navbar />
      <div className="dashboard-bg" />
      <main className="dashboard-grid">
        <section className="col-left">
          <ChatBot
            messages={messages}
            onSend={onSend}
            disabled={loading}
            audioFiles={audioNames}
          />
          <div className="panel">
            <h3 className="panel-title">Media</h3>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={realistic}
                onChange={(e) => setRealistic(e.target.checked)}
              />
              Use realistic furniture
            </label>
            <MediaUpload onFiles={onFiles} disabled={loading} />
            {files.length > 0 && (
              <ul className="file-list small">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <span>{f.name}</span>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => removeFile(i)}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="btn-primary full mt-2"
              onClick={generate}
              disabled={generateDisabled}
              title={
                !isGeminiConfigured && !configLoading
                  ? 'AI is not configured on the server (Vertex project + location).'
                  : undefined
              }
            >
              {generateLabel}
            </button>
            <button
              type="button"
              className="btn-outline full mt-2"
              onClick={resetWorkspace}
              disabled={loading}
              title={loading ? 'Please wait for generation to finish.' : 'Clear current chat, uploads, and concept.'}
            >
              Reset workspace
            </button>
            <AnalysisPanel keywords={analysisKeywords} title="Analysis" />
            {concept?.colorPalette ? <ColorPalette colors={concept.colorPalette} /> : null}
          </div>
        </section>

        <section className="col-center">
          <div className="tabs">
            <button
              type="button"
              className={tab === 'renders' ? 'active' : ''}
              onClick={() => setTab('renders')}
            >
              Renders
            </button>
            <button
              type="button"
              className={tab === 'blueprints' ? 'active' : ''}
              onClick={() => setTab('blueprints')}
            >
              Blueprints
            </button>
          </div>
          {centerBody}
          <div className="row-actions">
            <button
              type="button"
              className="btn-outline"
              onClick={() => setRefineOpen(true)}
              disabled={!concept || loading || !isGeminiConfigured}
            >
              Refine generation
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setSaveName(concept?.title || 'My room');
                setSaveOpen(true);
              }}
              disabled={!concept || loading}
            >
              Save as project
            </button>
            <button
              type="button"
              className="btn-outline"
              disabled={!concept?.searchKeywords?.length}
              onClick={() => {
                const q = encodeURIComponent(concept.searchKeywords[0]);
                window.open(
                  `https://www.google.com/search?tbm=shop&q=${q}`,
                  '_blank',
                  'noopener,noreferrer'
                );
              }}
            >
              Search real items
            </button>
          </div>
        </section>

        <section className="col-right">{rightBody}</section>
      </main>

      <Modal
        open={refineOpen}
        title="Refine concept"
        onClose={() => setRefineOpen(false)}
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRefineOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submitRefine}
              disabled={!sanitizeChatInput(refineText)}
            >
              Apply
            </button>
          </>
        }
      >
        <label htmlFor="refine-text" className="label">
          Tell Roomify what to change
        </label>
        <textarea
          id="refine-text"
          className="modal-textarea"
          rows={4}
          maxLength={2000}
          placeholder="e.g. warmer tones, more natural wood, remove the bold accent wall"
          value={refineText}
          onChange={(e) => setRefineText(e.target.value)}
          autoFocus
        />
      </Modal>

      <Modal
        open={saveOpen}
        title="Save project"
        onClose={() => setSaveOpen(false)}
        actions={
          <>
            <button type="button" className="btn-ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submitSave}
              disabled={!sanitizeChatInput(saveName)}
            >
              Save
            </button>
          </>
        }
      >
        <label htmlFor="save-name" className="label">
          Project name
        </label>
        <input
          id="save-name"
          type="text"
          className="modal-input"
          maxLength={120}
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          autoFocus
        />
      </Modal>
    </div>
  );
}
