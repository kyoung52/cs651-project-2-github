/**
 * Auth context: Firebase email/password + Google; exposes user and idToken for API.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
} from 'firebase/auth';
import { getFirebaseAuth, getGoogleProvider, isFirebaseConfigured } from '../services/firebase.js';
import { setAuthToken, api } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [idToken, setIdToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return undefined;
    }

    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const token = await u.getIdToken();
        setIdToken(token);
        setAuthToken(token);
      } else {
        setIdToken(null);
        setAuthToken(null);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const refreshToken = async () => {
    if (!user) return null;
    const token = await user.getIdToken(true);
    setIdToken(token);
    setAuthToken(token);
    return token;
  };

  const signInEmail = async (email, password) => {
    setError(null);
    const auth = getFirebaseAuth();
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signUpEmail = async (email, password) => {
    setError(null);
    const auth = getFirebaseAuth();
    await createUserWithEmailAndPassword(auth, email, password);
  };

  /**
   * Google sign-in and push OAuth access token to server for Photos/YouTube.
   */
  const signInGoogle = async () => {
    setError(null);
    const auth = getFirebaseAuth();
    // Minimal scopes at login. Media scopes are requested later when connecting services.
    const provider = getGoogleProvider({ withMediaScopes: false });
    const result = await signInWithPopup(auth, provider);
    const cred = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = cred?.accessToken;
    if (accessToken) {
      const token = await result.user.getIdToken();
      setAuthToken(token);
      await api.post('/api/auth/google-token', { accessToken });
    }
    return result;
  };

  /**
   * Request Google Photos / YouTube scopes and store the access token server-side.
   * Uses a popup re-consent flow for the currently signed-in user.
   */
  const connectGoogleMedia = async () => {
    setError(null);
    const auth = getFirebaseAuth();
    const provider = getGoogleProvider({ withMediaScopes: true });
    const result = await signInWithPopup(auth, provider);
    const cred = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = cred?.accessToken || result?._tokenResponse?.oauthAccessToken || null;
    if (accessToken) {
      const token = await result.user.getIdToken();
      setAuthToken(token);
      const { data } = await api.post('/api/auth/google-token', { accessToken });
      return Boolean(data?.hasPhotosScope);
    }
    return false;
  };

  const logout = async () => {
    setError(null);
    const auth = getFirebaseAuth();
    await signOut(auth);
  };

  const value = useMemo(
    () => ({
      user,
      idToken,
      loading,
      error,
      setError,
      signInEmail,
      signUpEmail,
      signInGoogle,
      connectGoogleMedia,
      logout,
      refreshToken,
      firebaseReady: isFirebaseConfigured(),
    }),
    [user, idToken, loading, error]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
