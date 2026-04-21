/**
 * Simple blueprint placeholder — text notes from Gemini (no CAD in MVP).
 */
export default function BlueprintView({ notes }) {
  return (
    <div className="blueprint-panel">
      <h4>Blueprints</h4>
      <p className="blueprint-notes">{notes || 'Floor plan notes will appear after generation.'}</p>
      <div className="blueprint-placeholder" aria-hidden>
        <svg viewBox="0 0 200 120" className="blueprint-svg">
          <rect x="10" y="10" width="180" height="100" fill="none" stroke="currentColor" strokeWidth="2" />
          <rect x="30" y="30" width="60" height="40" fill="none" stroke="currentColor" strokeDasharray="4" />
          <text x="40" y="55" fontSize="10" fill="currentColor">
            Sofa
          </text>
          <circle cx="140" cy="50" r="15" fill="none" stroke="currentColor" />
        </svg>
      </div>
    </div>
  );
}
