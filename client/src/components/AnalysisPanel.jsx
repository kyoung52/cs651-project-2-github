/**
 * Shows Gemini analysis keywords from latest generation.
 */
export default function AnalysisPanel({ keywords = [], title = 'Analysis' }) {
  if (!keywords.length) return null;
  return (
    <div className="analysis-block">
      <span className="label">{title}</span>
      <div className="tag-row">
        {keywords.map((t, i) => (
          <span key={i} className="tag">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
