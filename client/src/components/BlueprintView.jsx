/**
 * Blueprint view.
 *
 * If the concept includes structured `blueprint` data, we render a simple SVG
 * floor plan with elements placed proportionally.
 */
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeBlueprint(blueprint) {
  const roomW = Number(blueprint?.room?.width) || 200;
  const roomH = Number(blueprint?.room?.height) || 140;
  const elements = Array.isArray(blueprint?.elements) ? blueprint.elements : [];
  return {
    room: {
      width: clamp(roomW, 50, 2000),
      height: clamp(roomH, 50, 2000),
      unit: blueprint?.room?.unit || 'cm',
    },
    north: blueprint?.north || 'top',
    elements: elements
      .map((e) => ({
        type: String(e?.type || 'other'),
        label: String(e?.label || e?.type || 'Item').slice(0, 24),
        x: Number(e?.x) || 0,
        y: Number(e?.y) || 0,
        w: Math.max(1, Number(e?.w) || 10),
        h: Math.max(1, Number(e?.h) || 10),
        rotation: Number(e?.rotation) || 0,
      }))
      .slice(0, 40),
  };
}

function typeColor(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('sofa')) return 'rgba(124, 156, 255, 0.28)';
  if (t.includes('bed')) return 'rgba(255, 196, 124, 0.25)';
  if (t.includes('table') || t.includes('desk')) return 'rgba(124, 255, 196, 0.18)';
  if (t.includes('door') || t.includes('window')) return 'rgba(255, 255, 255, 0.08)';
  return 'rgba(255, 255, 255, 0.06)';
}

export default function BlueprintView({ notes, blueprint }) {
  const bp = blueprint ? normalizeBlueprint(blueprint) : null;
  const viewW = 240;
  const viewH = 170;
  const pad = 14;

  const scale = bp
    ? Math.min((viewW - pad * 2) / bp.room.width, (viewH - pad * 2) / bp.room.height)
    : 1;

  return (
    <div className="blueprint-panel">
      <h4>Blueprints</h4>
      <p className="blueprint-notes">
        {notes || (bp ? 'Layout generated from your concept.' : 'Floor plan notes will appear after generation.')}
      </p>
      {bp ? (
        <p className="muted small">
          Estimated room size: {Math.round(bp.room.width)}×{Math.round(bp.room.height)} {bp.room.unit}
        </p>
      ) : null}
      <div className="blueprint-placeholder" aria-hidden>
        <svg viewBox={`0 0 ${viewW} ${viewH}`} className="blueprint-svg">
          {bp ? (
            <>
              <rect
                x={pad}
                y={pad}
                width={bp.room.width * scale}
                height={bp.room.height * scale}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              {bp.elements.map((e, idx) => {
                const x = pad + e.x * scale;
                const y = pad + e.y * scale;
                const w = e.w * scale;
                const h = e.h * scale;
                return (
                  <g key={idx} transform={`rotate(${e.rotation} ${x + w / 2} ${y + h / 2})`}>
                    <rect
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      fill={typeColor(e.type)}
                      stroke="currentColor"
                      strokeWidth="1"
                      opacity="0.9"
                    />
                    {w > 28 && h > 16 ? (
                      <>
                        <text x={x + 4} y={y + 12} fontSize="10" fill="currentColor" opacity="0.9">
                          {e.label}
                        </text>
                        <text x={x + 4} y={y + 24} fontSize="9" fill="currentColor" opacity="0.75">
                          {Math.round(e.w)}×{Math.round(e.h)} {bp.room.unit}
                        </text>
                      </>
                    ) : null}
                  </g>
                );
              })}
            </>
          ) : (
            <>
              <rect
                x="10"
                y="10"
                width="220"
                height="150"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
              <rect
                x="30"
                y="30"
                width="70"
                height="44"
                fill="none"
                stroke="currentColor"
                strokeDasharray="4"
              />
              <text x="38" y="57" fontSize="10" fill="currentColor">
                Sofa
              </text>
              <circle cx="168" cy="58" r="16" fill="none" stroke="currentColor" />
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
