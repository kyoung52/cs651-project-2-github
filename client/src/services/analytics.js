import ReactGA from 'react-ga4';

function id() {
  return (import.meta.env.APP_GA_MEASUREMENT_ID || '').trim();
}

let initialized = false;

export function initAnalytics() {
  if (initialized) return false;

  // If the site uses the manually-installed gtag snippet, avoid double-init.
  // We still allow `trackPageView` / `trackEvent` to emit via `window.gtag`.
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    initialized = true;
    return true;
  }

  const measurementId = id();
  if (!measurementId) return false;
  ReactGA.initialize(measurementId);
  initialized = true;
  return true;
}

export function trackPageView(path) {
  if (!initialized) return;
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', 'page_view', { page_path: path });
    return;
  }
  ReactGA.send({ hitType: 'pageview', page: path });
}

export function trackEvent(name, params = {}) {
  if (!initialized) return;
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', name, params);
    return;
  }
  ReactGA.event(name, params);
}

