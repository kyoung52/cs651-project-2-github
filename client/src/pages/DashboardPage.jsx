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
import { api } from '../services/api.js';
import { sanitizeChatInput } from '../utils/validators.js';

const WELCOME_MESSAGE = {
  role: 'bot',
  text: "Hi — describe your space, upload images or audio, and I'll suggest a cohesive style direction.",
};

export default function DashboardPage() {
  const { isGeminiConfigured, isGoogleSearchConfigured, loading: configLoading } = useConfig();
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
  const [tab, setTab] = useState('renders');

  const [refineOpen, setRefineOpen] = useState(false);
  const [refineText, setRefineText] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const appendMessage = useCallback((role, text) => {
    setMessages((m) => [...m, { role, text }]);
  }, []);

  useEffect(() => {
    if (!configLoading && !isGeminiConfigured) {
      toast.push({
        variant: 'warn',
        title: 'AI generation unavailable',
        message:
          'GEMINI_API_KEY is not set on the server. You can still explore the UI, but concept generation is disabled.',
        duration: 7000,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoading, isGeminiConfigured]);

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
        message: 'Set GEMINI_API_KEY on the server to enable concept generation.',
      });
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('chatContext', chatContext);
      fd.append('useRealisticFurniture', realistic ? 'true' : 'false');

      const { data } = await api.post('/api/media/process', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setConcept(data.concept);
      setSimilar(data.similarInspiration || []);
      setSearchWasConfigured(Boolean(data.searchConfigured));
      setAnalysisKeywords(data.concept?.analysisKeywords || []);
      appendMessage(
        'bot',
        `Suggested style: ${data.concept?.styleLabel || 'Your mix'}. ${data.concept?.conceptDescription || ''}`
      );
      toast.push({
        variant: 'success',
        title: 'Concept ready',
        message: data.concept?.title || 'Your room concept was generated.',
      });
    } catch (err) {
      toast.push({ variant: 'error', title: 'Generation failed', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const submitRefine = async () => {
    const clean = sanitizeChatInput(refineText);
    if (!clean) return;
    setRefineOpen(false);
    setLoading(true);
    try {
      const { data } = await api.post('/api/gemini/refine', {
        previousConcept: concept,
        feedback: clean,
      });
      setConcept((prev) => ({ ...prev, ...data.concept }));
      appendMessage('user', clean);
      appendMessage('bot', 'Updated the concept based on your feedback.');
      toast.push({ variant: 'success', title: 'Concept refined' });
    } catch (err) {
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
        payload: { concept, similar },
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
        <RoomConcept concept={concept} loading={loading} />
      ) : (
        <BlueprintView notes={concept?.blueprintNotes} />
      );
    }

    if (!isGeminiConfigured && !configLoading) {
      return (
        <EmptyState
          tone="warn"
          title="Concept generation is disabled"
          description="Set GEMINI_API_KEY on the server to enable AI-powered room design. The app keeps running in read-only mode."
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
  }, [loading, concept, tab, isGeminiConfigured, configLoading, files.length]);

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
              title={!isGeminiConfigured && !configLoading ? 'GEMINI_API_KEY is not set on the server.' : undefined}
            >
              {generateLabel}
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
