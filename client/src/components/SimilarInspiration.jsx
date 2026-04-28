import ConfidenceScore from './ConfidenceScore.jsx';

/**
 * Right column: Google Image Search results with confidence.
 */
export default function SimilarInspiration({ results, title = 'Similar inspiration' }) {
  if (!results?.length) {
    return (
      <div className="panel side-panel">
        <h3 className="panel-title">{title}</h3>
        <p className="muted small">Run a generation to see matched images.</p>
      </div>
    );
  }

  return (
    <div className="panel side-panel">
      <h3 className="panel-title">{title}</h3>
      <ul className="inspiration-list">
        {results.map((r, i) => (
          <li key={i} className="inspiration-item">
            <a href={r.link} target="_blank" rel="noopener noreferrer" className="inspiration-thumb-link">
              <img
                src={r.link}
                alt=""
                className="inspiration-thumb"
                loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </a>
            <div className="inspiration-meta">
              <span className="inspiration-title">{r.title || r.displayLink || 'Result'}</span>
              <ConfidenceScore value={r.confidence} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
