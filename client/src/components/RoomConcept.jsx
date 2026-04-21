/**
 * Center column: featured image + concept text + keyword chips.
 */
export default function RoomConcept({ concept, loading }) {
  if (loading) {
    return (
      <div className="panel main-panel center-placeholder">
        <div className="spinner large" />
        <p>Generating your room concept…</p>
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
