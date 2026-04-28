/**
 * RelatedItems — grounded furniture/decor suggestions for the current concept.
 *
 * On mount (and whenever the concept changes), POSTs the concept to
 * /api/related. Server validates server-side and may return an empty list
 * with `reason: 'grounding_unavailable'` when the GCP region doesn't
 * support the grounding tool — we render a friendly notice instead.
 *
 * Citation links open in a new tab with rel="noopener noreferrer". A
 * disclaimer makes clear that prices are model-generated estimates, not
 * live retailer quotes.
 */
import { useEffect, useState } from 'react';
import { api } from '../services/api.js';

function formatPrice(low, high, currency) {
  const c = currency || 'USD';
  const fmt = (n) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: c,
        maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `${c} ${Math.round(n)}`;
    }
  };
  if (low === high) return fmt(low);
  return `${fmt(low)} – ${fmt(high)}`;
}

function ConfidenceBadge({ value }) {
  const tone = value === 'high' ? 'badge-pos' : value === 'low' ? 'badge-warn' : 'badge-neutral';
  return <span className={`related-badge ${tone}`}>{value}</span>;
}

export default function RelatedItems({ concept, enabled = true }) {
  const [state, setState] = useState({ status: 'idle', items: [], citations: [], reason: null });

  useEffect(() => {
    if (!enabled || !concept) {
      setState({ status: 'idle', items: [], citations: [], reason: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));
    api
      .post('/api/related', { concept })
      .then(({ data }) => {
        if (cancelled) return;
        setState({
          status: 'ready',
          items: Array.isArray(data?.items) ? data.items : [],
          citations: Array.isArray(data?.citations) ? data.citations : [],
          reason: data?.reason || null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // 503 = grounding not configured; treat as a soft empty state.
        if (err?.status === 503) {
          setState({ status: 'unavailable', items: [], citations: [], reason: 'not_configured' });
        } else {
          setState({ status: 'error', items: [], citations: [], reason: err?.message || 'error' });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, concept?.title, concept?.styleLabel]);

  if (!concept) return null;
  if (!enabled || state.status === 'unavailable') {
    return null; // Don't take up space when not configured.
  }

  return (
    <div className="panel related-panel">
      <h3 className="panel-title">Related items & price estimates</h3>

      {state.status === 'loading' ? (
        <div className="related-loading">
          <div className="spinner" aria-label="Loading suggestions" />
          <p className="muted small">Searching real-world prices…</p>
        </div>
      ) : null}

      {state.status === 'ready' && state.reason === 'grounding_unavailable' ? (
        <p className="muted small">
          Grounded suggestions aren't available in this project's region right now.
        </p>
      ) : null}

      {state.status === 'ready' && state.items.length === 0 && !state.reason ? (
        <p className="muted small">No grounded suggestions for this concept.</p>
      ) : null}

      {state.status === 'error' ? (
        <p className="muted small">Couldn't load related items right now.</p>
      ) : null}

      {state.items.length > 0 ? (
        <ul className="related-grid">
          {state.items.map((it, i) => (
            <li key={`${it.name}-${i}`} className="related-card">
              <div className="related-card-head">
                <span className="related-name">{it.name}</span>
                <ConfidenceBadge value={it.confidence} />
              </div>
              <div className="related-meta">
                <span className="related-cat">{it.category}</span>
                <span className="related-price">
                  {formatPrice(it.priceLow, it.priceHigh, it.currency)}
                </span>
              </div>
              {it.note ? <p className="related-note">{it.note}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {state.citations.length > 0 ? (
        <div className="related-citations">
          <span className="label">Sources</span>
          <ul>
            {state.citations.slice(0, 6).map((c, i) => (
              <li key={`${c.uri}-${i}`}>
                <a href={c.uri} target="_blank" rel="noopener noreferrer">
                  {c.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {state.items.length > 0 ? (
        <p className="related-disclaimer muted small">
          Prices are AI-generated estimates from web sources at search time.
          Actual prices vary. Always confirm with the retailer.
        </p>
      ) : null}
    </div>
  );
}
