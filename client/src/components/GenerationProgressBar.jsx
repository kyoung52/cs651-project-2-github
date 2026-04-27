/**
 * Linear progress for long-running AI requests (upload + server work).
 */
export default function GenerationProgressBar({ value, label }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <div className="generation-progress" aria-busy="true">
      {label ? <p className="generation-progress-label">{label}</p> : null}
      <div
        className="generation-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="generation-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
