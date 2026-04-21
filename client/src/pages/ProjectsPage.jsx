import { useEffect, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { api } from '../services/api.js';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/gemini/projects');
        if (!cancelled) setProjects(data.projects || []);
      } catch (err) {
        if (!cancelled) {
          toast.push({ variant: 'error', title: 'Projects', message: err.message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <Navbar />
      <main className="content narrow">
        <h1>Your projects</h1>
        {loading ? (
          <div className="page-center">
            <div className="spinner" aria-label="Loading" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            title="No saved projects yet"
            description="Generate a concept on the dashboard and save it to see it here."
          />
        ) : (
          <ul className="project-list">
            {projects.map((p) => (
              <li key={p.id} className="project-card">
                <h3>{p.name}</h3>
                <p className="muted small">
                  {p.createdAt ? new Date(p.createdAt).toLocaleString() : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
