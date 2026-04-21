import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';

export default function HomePage() {
  return (
    <div className="page home">
      <Navbar />
      <section className="hero">
        <h1>Roomify</h1>
        <p className="lead">AI-powered room design ideas from your images, audio, and inspiration.</p>
        <div className="hero-actions">
          <Link to="/signin" className="btn-primary">
            Get started
          </Link>
          <Link to="/dashboard" className="btn-outline">
            Dashboard
          </Link>
        </div>
        <footer className="site-footer">
          <Link to="/privacy">Privacy Policy</Link>
        </footer>
      </section>
    </div>
  );
}
