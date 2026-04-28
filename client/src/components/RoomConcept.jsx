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

  // Remote URL — third-party hosts almost never send CORS headers for image
  // requests, so fetch->blob silently fails and falls back to a tab. Skip the
  // attempt and open in a new tab honestly.
  window.open(src, '_blank', 'noopener,noreferrer');
}

/**
 * Center column: featured image + concept text + keyword chips.
 *
 * `phaseLabel` and `phaseHistory` come from the SSE phase stream in
 * DashboardPage. Each visited phase becomes a checked row so users can see
 * the pipeline progress beyond a single bar.
 */
export default function RoomConcept({
  concept,
  loading,
  generationProgress = 0,
  rerenderingHero = false,
  phaseLabel = '',
  phaseHistory = [],
  phaseCopy = (s) => s,
}) {
  if (loading) {
    return (
      <div className="panel main-panel center-placeholder">
        <div className="spinner large" />
        <p>{phaseLabel || 'Generating your room concept…'}</p>
        <GenerationProgressBar value={generationProgress} label="AI progress" />
        {phaseHistory.length > 0 ? (
          <ul className="phase-list">
            {phaseHistory.map((p, i) => {
              const isLast = i === phaseHistory.length - 1;
              return (
                <li key={`${p}-${i}`} className={isLast ? 'phase-row current' : 'phase-row done'}>
                  <span className="phase-icon" aria-hidden="true">
                    {isLast ? '…' : '✓'}
                  </span>
                  <span className="phase-text">{phaseCopy(p)}</span>
                </li>
              );
            })}
          </ul>
        ) : null}
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
      {img ? (
        <div className="concept-image-wrap">
          <img src={img} alt={concept.title || 'Room concept'} className="concept-image" />
        </div>
      ) : rerenderingHero ? (
        <div className="concept-image-wrap center-grid">
          <div className="spinner" aria-label="Re-rendering preview" />
          <p className="hint small">Re-rendering preview…</p>
        </div>
      ) : null}
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
