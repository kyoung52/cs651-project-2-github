/**
 * Blueprint view.
 *
 * Renders a structured floor plan from `concept.blueprint`. The model
 * outputs room.width/height and elements[].x,y,w,h all in the same unit
 * (default cm). We:
 *   - Clamp every element to the room bounds (the model occasionally
 *     emits coords that extend past a wall).
 *   - Scale the room into a generous viewBox with margin for perimeter
 *     dimension labels, a compass, and a legend.
 *   - Use per-type shapes (circles for lamps/plants, dashed outlines for
 *     rugs, thicker bars for windows/doors against the nearest wall).
 */

const TYPE_STYLES = {
  // Furniture (large)
  bed:          { fill: 'rgba(255, 196, 124, 0.32)', label: 'Bed' },
  sofa:         { fill: 'rgba(124, 156, 255, 0.32)', label: 'Sofa' },
  loveseat:     { fill: 'rgba(124, 156, 255, 0.28)', label: 'Loveseat' },
  // Furniture (medium)
  chair:        { fill: 'rgba(124, 220, 200, 0.30)', label: 'Chair' },
  armchair:     { fill: 'rgba(124, 220, 200, 0.30)', label: 'Armchair' },
  desk:         { fill: 'rgba(170, 230, 150, 0.26)', label: 'Desk' },
  table:        { fill: 'rgba(170, 230, 150, 0.26)', label: 'Table' },
  diningtable:  { fill: 'rgba(170, 230, 150, 0.30)', label: 'Dining table' },
  coffeetable:  { fill: 'rgba(170, 230, 150, 0.22)', label: 'Coffee table' },
  sidetable:    { fill: 'rgba(170, 230, 150, 0.20)', label: 'Side table' },
  nightstand:   { fill: 'rgba(220, 190, 140, 0.30)', label: 'Nightstand' },
  dresser:      { fill: 'rgba(220, 190, 140, 0.32)', label: 'Dresser' },
  shelf:        { fill: 'rgba(220, 190, 140, 0.26)', label: 'Shelving' },
  bookshelf:    { fill: 'rgba(220, 190, 140, 0.26)', label: 'Bookshelf' },
  wardrobe:     { fill: 'rgba(220, 190, 140, 0.34)', label: 'Wardrobe' },
  // Decor / accents
  rug:          { fill: 'none',                       label: 'Rug', shape: 'rug' },
  lamp:         { fill: 'rgba(255, 230, 140, 0.55)',  label: 'Lamp', shape: 'circle' },
  plant:        { fill: 'rgba(140, 220, 150, 0.55)',  label: 'Plant', shape: 'circle' },
  tv:           { fill: 'rgba(40, 40, 50, 0.85)',     label: 'TV', shape: 'tv' },
  art:          { fill: 'rgba(255, 196, 124, 0.18)',  label: 'Art' },
  // Architectural
  window:       { fill: 'rgba(120, 200, 255, 0.55)',  label: 'Window', shape: 'aperture' },
  door:         { fill: 'rgba(220, 190, 140, 0.55)',  label: 'Door', shape: 'door' },
  // Catch-all
  other:        { fill: 'rgba(255, 255, 255, 0.10)', label: 'Item' },
};

function styleForType(type) {
  const t = String(type || '').toLowerCase().replace(/[\s_-]/g, '');
  if (TYPE_STYLES[t]) return TYPE_STYLES[t];
  // Loose match for compound / variant types.
  for (const key of Object.keys(TYPE_STYLES)) {
    if (key !== 'other' && t.includes(key)) return TYPE_STYLES[key];
  }
  return TYPE_STYLES.other;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeBlueprint(blueprint) {
  const roomW = clamp(Number(blueprint?.room?.width) || 200, 60, 4000);
  const roomH = clamp(Number(blueprint?.room?.height) || 140, 60, 4000);
  const unit = blueprint?.room?.unit || 'cm';
  const north = blueprint?.north || 'top';

  const raw = Array.isArray(blueprint?.elements) ? blueprint.elements : [];
  const elements = raw
    .map((e) => {
      // Clamp every element so it can't extend past the walls. The model
      // occasionally emits x + w > roomW or negative coords.
      const x0 = clamp(Number(e?.x) || 0, 0, roomW);
      const y0 = clamp(Number(e?.y) || 0, 0, roomH);
      const wRaw = Math.max(1, Number(e?.w) || 10);
      const hRaw = Math.max(1, Number(e?.h) || 10);
      const w = Math.max(1, Math.min(wRaw, roomW - x0));
      const h = Math.max(1, Math.min(hRaw, roomH - y0));
      return {
        type: String(e?.type || 'other'),
        label: String(e?.label || e?.type || 'Item').slice(0, 32),
        x: x0,
        y: y0,
        w,
        h,
        rotation: Number(e?.rotation) || 0,
      };
    })
    .slice(0, 40);

  return {
    room: { width: roomW, height: roomH, unit },
    north,
    elements,
  };
}

function compassRotation(north) {
  switch (String(north || '').toLowerCase()) {
    case 'right': return 90;
    case 'bottom': return 180;
    case 'left': return -90;
    case 'top':
    default: return 0;
  }
}

function ElementShape({ el, scale, originX, originY, unit }) {
  const style = styleForType(el.type);
  const x = originX + el.x * scale;
  const y = originY + el.y * scale;
  const w = el.w * scale;
  const h = el.h * scale;
  const cx = x + w / 2;
  const cy = y + h / 2;

  let shape;
  if (style.shape === 'circle') {
    const r = Math.min(w, h) / 2;
    shape = (
      <>
        <circle cx={cx} cy={cy} r={r} fill={style.fill} stroke="currentColor" strokeWidth={1.2} />
        {style.label === 'Lamp' ? (
          <circle cx={cx} cy={cy} r={r * 0.45} fill="rgba(255, 230, 140, 0.85)" stroke="none" />
        ) : null}
      </>
    );
  } else if (style.shape === 'rug') {
    shape = (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        ry={4}
        fill="rgba(255, 255, 255, 0.04)"
        stroke="currentColor"
        strokeDasharray="6 4"
        strokeWidth={1.2}
        opacity={0.85}
      />
    );
  } else if (style.shape === 'tv') {
    shape = (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={2}
        ry={2}
        fill={style.fill}
        stroke="currentColor"
        strokeWidth={1.2}
      />
    );
  } else if (style.shape === 'aperture') {
    // Window: light blue bar, slightly thicker stroke to read like glass.
    shape = (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill={style.fill}
        stroke="rgba(180, 220, 255, 0.95)"
        strokeWidth={1.6}
      />
    );
  } else if (style.shape === 'door') {
    // Door: rectangle for the leaf, plus an arc indicating swing.
    const radius = Math.max(w, h);
    shape = (
      <>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={style.fill}
          stroke="currentColor"
          strokeWidth={1.2}
        />
        <path
          d={`M ${x} ${y + h} A ${radius} ${radius} 0 0 1 ${x + radius} ${y + h}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          opacity={0.5}
        />
      </>
    );
  } else {
    shape = (
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4}
        ry={4}
        fill={style.fill}
        stroke="currentColor"
        strokeWidth={1.2}
        opacity={0.95}
      />
    );
  }

  const showLabel = w > 44 && h > 24;
  const showDims = w > 60 && h > 36;

  return (
    <g>
      <g transform={`rotate(${el.rotation} ${cx} ${cy})`}>{shape}</g>
      {showLabel ? (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          fontSize={12}
          fill="currentColor"
          pointerEvents="none"
        >
          <tspan x={cx} dy={showDims ? '-0.2em' : '0.35em'} fontWeight="600">
            {el.label}
          </tspan>
          {showDims ? (
            <tspan x={cx} dy="1.25em" opacity="0.7" fontSize={10}>
              {Math.round(el.w)}×{Math.round(el.h)} {unit}
            </tspan>
          ) : null}
        </text>
      ) : null}
    </g>
  );
}

function Compass({ x, y, north }) {
  const rot = compassRotation(north);
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="18" fill="rgba(255,255,255,0.04)" stroke="currentColor" strokeWidth={1} />
      <g transform={`rotate(${rot})`}>
        <line x1={0} y1={-14} x2={0} y2={6} stroke="currentColor" strokeWidth={1.4} />
        <polygon points="0,-16 -3,-9 3,-9" fill="currentColor" />
      </g>
      <text textAnchor="middle" dy="0.35em" fontSize={11} fontWeight="700" fill="currentColor" y={-22}>
        N
      </text>
    </g>
  );
}

function PerimeterDimensions({ originX, originY, scale, room }) {
  const w = room.width * scale;
  const h = room.height * scale;
  const tickColor = 'currentColor';
  const tickOffset = 22;
  const tickLen = 6;
  return (
    <g opacity={0.75}>
      {/* Top — width */}
      <line
        x1={originX}
        y1={originY - tickOffset}
        x2={originX + w}
        y2={originY - tickOffset}
        stroke={tickColor}
        strokeWidth={1}
      />
      <line x1={originX} y1={originY - tickOffset - tickLen / 2} x2={originX} y2={originY - tickOffset + tickLen / 2} stroke={tickColor} strokeWidth={1} />
      <line x1={originX + w} y1={originY - tickOffset - tickLen / 2} x2={originX + w} y2={originY - tickOffset + tickLen / 2} stroke={tickColor} strokeWidth={1} />
      <text
        x={originX + w / 2}
        y={originY - tickOffset - 6}
        textAnchor="middle"
        fontSize={11}
        fill={tickColor}
        fontWeight="600"
      >
        {Math.round(room.width)} {room.unit}
      </text>

      {/* Left — height (rotated 90° about its midpoint) */}
      <line
        x1={originX - tickOffset}
        y1={originY}
        x2={originX - tickOffset}
        y2={originY + h}
        stroke={tickColor}
        strokeWidth={1}
      />
      <line x1={originX - tickOffset - tickLen / 2} y1={originY} x2={originX - tickOffset + tickLen / 2} y2={originY} stroke={tickColor} strokeWidth={1} />
      <line x1={originX - tickOffset - tickLen / 2} y1={originY + h} x2={originX - tickOffset + tickLen / 2} y2={originY + h} stroke={tickColor} strokeWidth={1} />
      <text
        x={originX - tickOffset - 8}
        y={originY + h / 2}
        textAnchor="middle"
        fontSize={11}
        fill={tickColor}
        fontWeight="600"
        transform={`rotate(-90 ${originX - tickOffset - 8} ${originY + h / 2})`}
      >
        {Math.round(room.height)} {room.unit}
      </text>
    </g>
  );
}

export default function BlueprintView({ notes, blueprint }) {
  const bp = blueprint ? normalizeBlueprint(blueprint) : null;

  // Generous viewBox so the SVG can scale up gracefully. The drawing area
  // is the room rect; perimeter labels + compass + padding live in the
  // surrounding margin.
  const VB_W = 880;
  const VB_H = 560;
  const MARGIN_LEFT = 70;
  const MARGIN_TOP = 60;
  const MARGIN_RIGHT = 30;
  const MARGIN_BOTTOM = 30;

  let originX = MARGIN_LEFT;
  let originY = MARGIN_TOP;
  let scale = 1;
  let drawW = 0;
  let drawH = 0;

  if (bp) {
    const availW = VB_W - MARGIN_LEFT - MARGIN_RIGHT;
    const availH = VB_H - MARGIN_TOP - MARGIN_BOTTOM;
    scale = Math.min(availW / bp.room.width, availH / bp.room.height);
    drawW = bp.room.width * scale;
    drawH = bp.room.height * scale;
    // Center the room horizontally if there's slack so wide-but-short
    // floor plans don't hug the left wall.
    originX = MARGIN_LEFT + (availW - drawW) / 2;
    originY = MARGIN_TOP + (availH - drawH) / 2;
  }

  // Distinct types used → legend chips.
  const legend = bp
    ? Array.from(
        bp.elements
          .reduce((acc, el) => {
            const s = styleForType(el.type);
            const key = s.label;
            if (!acc.has(key)) acc.set(key, { ...s, count: 0 });
            acc.get(key).count += 1;
            return acc;
          }, new Map())
          .values()
      )
    : [];

  return (
    <div className="blueprint-panel">
      <h4>Blueprints</h4>
      <p className="blueprint-notes">
        {notes || (bp ? 'Layout generated from your concept.' : 'Floor plan notes will appear after generation.')}
      </p>
      {bp ? (
        <p className="muted small">
          Estimated room size: {Math.round(bp.room.width)}×{Math.round(bp.room.height)} {bp.room.unit}
          {bp.elements.length ? ` · ${bp.elements.length} elements placed` : ''}
        </p>
      ) : null}

      <div className="blueprint-canvas">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="blueprint-svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={
            bp
              ? `Floor plan: ${Math.round(bp.room.width)} by ${Math.round(bp.room.height)} ${bp.room.unit}, ${bp.elements.length} elements`
              : 'Floor plan placeholder'
          }
        >
          <defs>
            <pattern id="bp-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.4" opacity="0.18" />
            </pattern>
          </defs>

          {bp ? (
            <>
              {/* Faint grid behind the room rectangle for scale. */}
              <rect
                x={originX}
                y={originY}
                width={drawW}
                height={drawH}
                fill="url(#bp-grid)"
              />
              {/* Room walls */}
              <rect
                x={originX}
                y={originY}
                width={drawW}
                height={drawH}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
              />

              <PerimeterDimensions originX={originX} originY={originY} scale={scale} room={bp.room} />

              <Compass x={originX + drawW - 26} y={originY + 30} north={bp.north} />

              {bp.elements.map((e, idx) => (
                <ElementShape
                  key={idx}
                  el={e}
                  scale={scale}
                  originX={originX}
                  originY={originY}
                  unit={bp.room.unit}
                />
              ))}
            </>
          ) : (
            <>
              <rect
                x={MARGIN_LEFT}
                y={MARGIN_TOP}
                width={VB_W - MARGIN_LEFT - MARGIN_RIGHT}
                height={VB_H - MARGIN_TOP - MARGIN_BOTTOM}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                opacity="0.4"
              />
              <text
                x={VB_W / 2}
                y={VB_H / 2}
                textAnchor="middle"
                fontSize={14}
                fill="currentColor"
                opacity="0.5"
              >
                Floor plan will appear here after generation.
              </text>
            </>
          )}
        </svg>
      </div>

      {legend.length ? (
        <ul className="blueprint-legend">
          {legend.map((l) => (
            <li key={l.label}>
              <span
                className="blueprint-legend-swatch"
                style={{
                  background: l.fill === 'none' ? 'transparent' : l.fill,
                  borderStyle: l.shape === 'rug' ? 'dashed' : 'solid',
                  borderRadius: l.shape === 'circle' ? '50%' : '3px',
                }}
              />
              <span className="blueprint-legend-label">{l.label}</span>
              {l.count > 1 ? <span className="blueprint-legend-count">×{l.count}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
