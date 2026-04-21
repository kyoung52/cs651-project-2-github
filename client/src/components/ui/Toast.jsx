/**
 * Toast system — a `ToastProvider` exposes `useToast()` with push/dismiss,
 * and renders the stack in the bottom-right corner.
 *
 * Styling is in `index.css` under `.toast-*`.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext({ push: () => {}, dismiss: () => {} });

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    ({ title, message, variant = 'info', duration = 4500 }) => {
      const id = ++nextId;
      setToasts((list) => [...list, { id, title, message, variant }]);
      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
      return id;
    },
    [dismiss]
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.variant}`}>
            <div className="toast-content">
              {t.title ? <strong className="toast-title">{t.title}</strong> : null}
              {t.message ? <span className="toast-message">{t.message}</span> : null}
            </div>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
