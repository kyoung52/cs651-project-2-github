import ReactGA from 'react-ga4';

function id() {
  return (import.meta.env.APP_GA_MEASUREMENT_ID || '').trim();
}

let initialized = false;

export function initAnalytics() {
  const measurementId = id();
  if (!measurementId || initialized) return false;
  ReactGA.initialize(measurementId);
  initialized = true;
  return true;
}

export function trackPageView(path) {
  if (!initialized) return;
  ReactGA.send({ hitType: 'pageview', page: path });
}

export function trackEvent(name, params = {}) {
  if (!initialized) return;
  ReactGA.event(name, params);
}

