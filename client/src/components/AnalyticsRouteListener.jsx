import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../services/analytics.js';

export default function AnalyticsRouteListener() {
  const loc = useLocation();
  useEffect(() => {
    trackPageView(`${loc.pathname}${loc.search}`);
  }, [loc.pathname, loc.search]);
  return null;
}

