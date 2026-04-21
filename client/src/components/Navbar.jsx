import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';

const linkClass = ({ isActive }) =>
  `nav-link ${isActive ? 'active' : ''}`;

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <header className="top-nav">
      <div className="nav-inner">
        <Link to="/" className="brand">
          ROOMIFY
        </Link>
        <nav className="nav-links">
          <NavLink to="/dashboard" className={linkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/projects" className={linkClass}>
            Projects
          </NavLink>
          <NavLink to="/explore" className={linkClass}>
            Explore
          </NavLink>
          <NavLink to="/inspiration" className={linkClass}>
            Inspiration
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            Settings
          </NavLink>
        </nav>
        <div className="nav-actions">
          <Link to="/privacy" className="nav-privacy">
            Privacy
          </Link>
          {user ? (
            <button type="button" className="btn-ghost" onClick={() => logout()}>
              Sign out
            </button>
          ) : (
            <Link to="/signin" className="btn-primary small">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
