import GenerationProgressBar from './GenerationProgressBar.jsx';

function safeFilename(input) {
  const base = String(input || 'roomify-render')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 64);
  return base || 'roomify-render';
}

async function downloadImage(src, filenameBase) {
  if (!src) return;
  const filename = `${safeFilename(filenameBase)}.png`;

  // data: URL (Flash Image) — download directly
  if (String(src).startsWith('data:')) {
    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  // Remote URL — try fetch->blob to force download
  try {
    const res = await fetch(src, { method: 'GET', mode: 'cors' });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    // Fallback: open in new tab if CORS blocks fetch
    window.open(src, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Center column: featured image + concept text + keyword chips.
 */
export default function RoomConcept({ concept, loading, generationProgress = 0 }) {
  if (loading) {
    return (
      <div className="panel main-panel center-placeholder">
        <div className="spinner large" />
        <p>Generating your room concept…</p>
        <GenerationProgressBar value={generationProgress} label="AI progress" />
      </div>
    );
  }

  if (!concept) {
    return (
      <div className="panel main-panel center-placeholder">
        <p className="muted">Awaiting chat & media</p>
        <p className="hint">Upload images or audio, then generate.</p>
      </div>
    );
  }

  const img = concept.featuredImage;
  const keywords = concept.searchKeywords || [];

  return (
    <div className="panel main-panel">
      <div className="concept-header">
        <span className="badge">{concept.styleLabel || 'Concept'}</span>
        <h2>{concept.title || 'Your project'}</h2>
      </div>
      {img && (
        <div className="concept-image-wrap">
          <img src={img} alt={concept.title || 'Room concept'} className="concept-image" />
        </div>
      )}
      {img ? (
        <div className="row-actions compact no-mt mb-2">
          <button
            type="button"
            className="btn-outline small"
            onClick={() => downloadImage(img, concept.title)}
          >
            Download render
          </button>
        </div>
      ) : null}
      <p className="concept-desc">{concept.conceptDescription}</p>
      <div className="keyword-box">
        <span className="label">Keywords for search</span>
        <div className="chips">
          {keywords.map((k, i) => (
            <span key={i} className="chip">
              {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
