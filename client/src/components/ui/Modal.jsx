/**
 * Simple accessible modal dialog.
 *
 * Renders a backdrop + centered card. Closes on Escape and backdrop click.
 * Keep markup small — heavy lifting lives in CSS (`.modal-*`).
 */
import { useEffect } from 'react';

export default function Modal({
  open,
  title,
  onClose,
  children,
  actions,
  size = 'sm',
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={`modal-card modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {title ? (
          <header className="modal-header">
            <h2 id="modal-title">{title}</h2>
            <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </header>
        ) : null}
        <div className="modal-body">{children}</div>
        {actions ? <footer className="modal-actions">{actions}</footer> : null}
      </div>
    </div>
  );
}
