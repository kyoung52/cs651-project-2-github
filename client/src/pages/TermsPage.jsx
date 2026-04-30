import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';

const LAST_UPDATED = 'April 28, 2026';

export default function TermsPage() {
  return (
    <div className="page legal-page">
      <Navbar />
      <main className="legal-content">
        <h1>Terms of Service</h1>
        <p className="legal-meta">Last updated: {LAST_UPDATED}</p>

        <section>
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using Roomify, you agree to these Terms of Service. If you do not agree,
            please stop using the service.
          </p>
        </section>

        <section>
          <h2>2. Service Overview</h2>
          <p>
            Roomify is an AI-assisted interior design application. It analyzes user-provided text,
            images, and audio to generate room concepts, style suggestions, and render previews.
          </p>
        </section>

        <section>
          <h2>3. Accounts and Access</h2>
          <p>
            You are responsible for maintaining the security of your account and for activity under
            your account. You must provide accurate information and use the service lawfully.
          </p>
        </section>

        <section>
          <h2>4. User Content</h2>
          <p>
            You retain ownership of content you upload. You grant Roomify a limited license to process
            that content only to provide app functionality.
          </p>
          <p>
            You must not upload content that is unlawful, infringing, harmful, or abusive.
          </p>
        </section>

        <section>
          <h2>5. AI-Generated Results</h2>
          <p>
            Generated concepts and renders are provided for inspiration. AI output may be incomplete,
            inaccurate, or similar to output generated for other users.
          </p>
        </section>

        <section>
          <h2>6. Third-Party Integrations</h2>
          <p>
            Roomify may integrate with third-party services (for example Google and Pinterest). Your
            use of those integrations may be subject to separate terms and policies from those
            providers.
          </p>
        </section>

        <section>
          <h2>7. Privacy</h2>
          <p>
            Your use of Roomify is also governed by our Privacy Policy.
          </p>
        </section>

        <section>
          <h2>8. Prohibited Use</h2>
          <ul>
            <li>Attempting unauthorized access to accounts, APIs, or systems</li>
            <li>Interfering with service operation, security, or availability</li>
            <li>Using the app to generate unlawful or deceptive content</li>
            <li>Violating applicable law or third-party rights</li>
          </ul>
        </section>

        <section>
          <h2>9. Service Availability</h2>
          <p>
            The service is provided “as is” and “as available.” Features may change, be suspended, or
            be removed at any time.
          </p>
        </section>

        <section>
          <h2>10. Limitation of Liability</h2>
          <p>
            To the extent permitted by law, Roomify and its contributors are not liable for indirect,
            incidental, special, consequential, or punitive damages resulting from use of the service.
          </p>
        </section>

        <section>
          <h2>11. Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. Continued use of Roomify after updates means
            you accept the revised Terms.
          </p>
        </section>

        <p className="legal-back">
          <Link to="/">← Back to home</Link>
        </p>
      </main>
    </div>
  );
}
