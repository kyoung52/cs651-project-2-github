import Navbar from '../components/Navbar.jsx';

/**
 * Placeholder browse experience — extend with public Firestore query later.
 */
export default function ExplorePage() {
  return (
    <div className="page">
      <Navbar />
      <main className="content narrow">
        <h1>Explore</h1>
        <p className="muted">
          Discover public room concepts and trends. Connect your data sources in Settings to personalize Explore.
        </p>
      </main>
    </div>
  );
}
