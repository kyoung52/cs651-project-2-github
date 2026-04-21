/**
 * Renders color swatches from hex or named colors.
 */
export default function ColorPalette({ colors = [] }) {
  if (!colors.length) return null;
  return (
    <div className="palette">
      {colors.map((c, i) => (
        <div
          key={i}
          className="swatch"
          style={{ background: c.startsWith('#') ? c : '#444' }}
          title={c}
        />
      ))}
    </div>
  );
}
