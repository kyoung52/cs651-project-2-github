import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';

/**
 * Public privacy policy — required for third-party OAuth (e.g. Pinterest).
 * Set APP_PRIVACY_CONTACT_EMAIL in `client/.env` to your real support address.
 */
const CONTACT_EMAIL =
  import.meta.env.APP_PRIVACY_CONTACT_EMAIL || 'privacy@example.com';
const LAST_UPDATED = 'April 15, 2026';

export default function PrivacyPolicyPage() {
  return (
    <div className="page legal-page">
      <Navbar />
      <main className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">
          Last updated: {LAST_UPDATED}
        </p>

        <section>
          <h2>1. Introduction</h2>
          <p>
            Roomify (“we,” “us,” or “our”) operates this website and application (the “Service”). This Privacy Policy
            describes how we collect, use, store, and share information when you use the Service, including when you
            connect third-party accounts such as Pinterest, Google, or YouTube. By using the Service, you agree to this
            policy. If you do not agree, please do not use the Service.
          </p>
        </section>

        <section>
          <h2>2. Information we collect</h2>
          <h3>2.1 Account and authentication</h3>
          <p>We may collect:</p>
          <ul>
            <li>Email address and authentication credentials when you create an account or sign in (including through Google).</li>
            <li>Technical identifiers associated with your session (for example, tokens issued by our authentication provider).</li>
          </ul>

          <h3>2.2 Content you provide</h3>
          <p>We process content you choose to upload or connect, such as:</p>
          <ul>
            <li>Images and audio files you upload for room-design analysis.</li>
            <li>Text you enter in chat or forms (for example, design preferences).</li>
            <li>Metadata associated with uploaded or linked media where applicable.</li>
          </ul>

          <h3>2.3 Third-party connections (OAuth)</h3>
          <p>
            If you choose to connect optional services, we may receive and store access tokens or similar credentials
            needed to access those services on your behalf, subject to your authorization and the permissions you grant.
            For example:
          </p>
          <ul>
            <li>
              <strong>Pinterest:</strong> With your consent, we may access information permitted by Pinterest’s API
              (such as boards and pins you authorize) to help you select inspiration for your projects.
            </li>
            <li>
              <strong>Google (including Google Photos and YouTube):</strong> With your consent and the scopes you
              approve, we may access media or metadata you authorize (for example, photos or video information) to
              analyze style and mood for design suggestions.
            </li>
          </ul>
          <p>
            We only use these connections for the features you request. You can disconnect or revoke access through your
            Google or Pinterest account settings and by removing the connection in our application where available.
          </p>

          <h3>2.4 Automatically collected information</h3>
          <p>
            Like most web applications, we may collect limited technical data such as IP address, browser type, device
            type, and general usage information to operate, secure, and improve the Service.
          </p>
        </section>

        <section>
          <h2>3. How we use information</h2>
          <p>We use the information above to:</p>
          <ul>
            <li>Provide, maintain, and improve the Service (including AI-assisted room concept and keyword generation).</li>
            <li>Authenticate you and protect accounts and systems.</li>
            <li>Process your media with our AI providers to produce analysis, summaries, and inspiration results.</li>
            <li>Retrieve similar images or related content when you use search or inspiration features.</li>
            <li>Comply with law, enforce our terms, and respond to lawful requests.</li>
          </ul>
        </section>

        <section>
          <h2>4. AI processing</h2>
          <p>
            We use Google Gemini (or similar services) to analyze images and audio and to generate text descriptions,
            keywords, and related outputs. Content you submit may be transmitted to Google’s systems for processing
            according to Google’s terms and policies applicable to those APIs. Do not submit highly sensitive personal
            data in uploads or chat unless you accept that risk.
          </p>
        </section>

        <section>
          <h2>5. Where data is stored and subprocessors</h2>
          <p>
            We use service providers that may process or store data on our behalf, including but not limited to:
          </p>
          <ul>
            <li>
              <strong>Google Firebase</strong> (authentication and database services), as described in Google’s privacy
              documentation.
            </li>
            <li>
              <strong>Google Cloud / Google APIs</strong> for AI (Gemini), and optionally for image search or media APIs
              you enable.
            </li>
            <li>
              <strong>Pinterest</strong> when you connect a Pinterest account, subject to Pinterest’s policies.
            </li>
          </ul>
          <p>
            These providers may process data in the United States or other countries where they operate facilities. By
            using the Service, you understand your information may be transferred to and processed in those locations.
          </p>
        </section>

        <section>
          <h2>6. Retention</h2>
          <p>
            We retain information only as long as needed to provide the Service, comply with legal obligations, resolve
            disputes, and enforce agreements. Cached analysis or project data may be stored to improve performance and
            user experience; you may request deletion of your account data where applicable (see Contact).
          </p>
        </section>

        <section>
          <h2>7. Security</h2>
          <p>
            We implement reasonable administrative, technical, and organizational measures designed to protect
            information against unauthorized access, loss, or misuse. No method of transmission over the Internet is 100%
            secure; we cannot guarantee absolute security.
          </p>
        </section>

        <section>
          <h2>8. Your choices and rights</h2>
          <p>Depending on where you live, you may have rights to access, correct, delete, or restrict certain processing
            of your personal information. To exercise these rights, contact us at the email below. You may also revoke
            third-party app permissions directly in your Google or Pinterest account settings.
          </p>
        </section>

        <section>
          <h2>9. Children’s privacy</h2>
          <p>
            The Service is not directed to children under 13 (or the minimum age required in your jurisdiction). We do not
            knowingly collect personal information from children. If you believe we have collected information from a
            child, please contact us and we will take steps to delete it.
          </p>
        </section>

        <section>
          <h2>10. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will post the updated policy on this page and update
            the “Last updated” date. Continued use of the Service after changes means you accept the revised policy.
          </p>
        </section>

        <section>
          <h2>11. Contact</h2>
          <p>
            For privacy questions or requests regarding this policy, contact us at:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </p>
          <p className="muted small">
            Replace the placeholder email above with a real address before submitting your app to Pinterest or
            deploying publicly.
          </p>
        </section>

        <p className="legal-back">
          <Link to="/">← Back to home</Link>
        </p>
      </main>
    </div>
  );
}
