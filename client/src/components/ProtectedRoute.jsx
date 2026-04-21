import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

/**
 * Redirects unauthenticated users to /signin; preserves return URL.
 */
export default function ProtectedRoute({ children }) {
  const { user, loading, firebaseReady } = useAuth();
  const location = useLocation();

  if (!firebaseReady) {
    return (
      <div className="page-center">
        <p className="muted">Configure Firebase (APP_FIREBASE_*) in client/.env to use authentication.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page-center">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/signin" state={{ from: location }} replace />;
  }

  return children;
}
