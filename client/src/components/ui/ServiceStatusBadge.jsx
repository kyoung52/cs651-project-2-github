/**
 * Tiny pill indicating whether an optional service is configured / connected.
 *
 * - `configured: false` → "Not configured" (amber)
 * - `configured: true, connected: false` → "Not connected" (muted)
 * - `configured: true, connected: true` → "Connected" (accent)
 */
export default function ServiceStatusBadge({
  configured,
  connected,
  label,
}) {
  let tone = 'muted';
  let text = label || 'Not connected';

  if (!configured) {
    tone = 'warn';
    text = 'Not configured';
  } else if (connected) {
    tone = 'ok';
    text = 'Connected';
  } else {
    tone = 'muted';
    text = label || 'Ready to connect';
  }

  return <span className={`status-badge badge-${tone}`}>{text}</span>;
}
