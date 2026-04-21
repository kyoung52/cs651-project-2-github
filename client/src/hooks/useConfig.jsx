/**
 * ConfigProvider — loads /api/config once and exposes boolean flags so pages
 * can hide or disable features that aren't configured on the server (Gemini,
 * Pinterest, Custom Search, etc).
 *
 * Never blocks rendering — defaults are safe (`configured: false`), and we
 * refresh in the background.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fetchConfig } from '../services/api.js';

const DEFAULT_STATUS = {
  firebase: { configured: false },
  gemini: { configured: false },
  pinterest: { configured: false },
  googleSearch: { configured: false },
};

const ConfigContext = createContext({
  status: DEFAULT_STATUS,
  loading: true,
  refresh: async () => {},
});

export function ConfigProvider({ children }) {
  const [status, setStatus] = useState(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const data = await fetchConfig();
    setStatus(data?.status || DEFAULT_STATUS);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const value = useMemo(
    () => ({
      status,
      loading,
      refresh: load,
      isGeminiConfigured: !!status.gemini?.configured,
      isPinterestConfigured: !!status.pinterest?.configured,
      isGoogleSearchConfigured: !!status.googleSearch?.configured,
      isFirebaseAdminConfigured: !!status.firebase?.configured,
    }),
    [status, loading]
  );

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  return useContext(ConfigContext);
}
