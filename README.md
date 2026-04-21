# Roomify — CS651 Group 2, Project 2

ERN single-page app for AI-assisted room design. Users sign in with Firebase,
upload photos or audio (or connect Pinterest / Google Photos / YouTube), and
Roomify uses **Google Gemini** to generate a cohesive room concept plus similar
inspiration from **Google Custom Search**.

Everything ships in a **single container** that is ready for **Google Cloud Run**:
Express hosts the built SPA on `/` and the JSON API under `/api/*`.

## Highlights

- No Vite: minimal `esbuild` pipeline bakes the React SPA directly into
  `server/public/`.
- Graceful degradation: missing Gemini / Pinterest / Search keys show
  friendly "Not configured" notices instead of 500s.
- Unified `{ error, code }` response shape on every API failure.
- Deep input sanitization + SSRF-hardened URL validation.
- Toast notifications, accessible modals, empty-state components.
- Firestore access wrapped in `safeDb()` helpers — the SPA stays responsive
  even when Firestore isn't configured.

## Repository layout

| Path | Purpose |
|------|---------|
| [`client/`](client/) | React SPA + `esbuild` build (see `client/build.mjs`) |
| [`client/scripts/`](client/scripts/) | Env loader + path helpers for the build |
| [`server/`](server/) | Express API + static SPA hosting in production |
| [`server/app.js`](server/app.js) | Express app factory (no `listen`) |
| [`server/server.js`](server/server.js) | Entrypoint that loads env + starts listening |
| [`Dockerfile`](Dockerfile) | Multi-stage build for Cloud Run |
| [`.env.example`](.env.example) | Server-side env template |
| [`client/.env.example`](client/.env.example) | Client-side env template |

## Prerequisites

- Node.js 20+
- A Firebase project (Auth + Firestore) — free tier is fine
- Optional: Google AI Studio key (`GEMINI_API_KEY`), Pinterest app, Google
  Custom Search engine.

## Local development

```bash
# 1. Install everything
npm run install:all

# 2. Fill in env values
cp .env.example .env                        # server-side secrets
cp client/.env.example client/.env          # public Firebase keys

# 3. Build the client into server/public/
npm run build

# 4. Start the combined server at http://localhost:8080
npm start
```

### Watch mode (faster iteration)

Run two terminals:

```bash
# Terminal A — rebuild SPA on every change
npm run dev:client

# Terminal B — start API + SPA (auto-restarts on server file changes)
npm run dev:server
```

Both share port `8080`.

For UI-only work without Firebase Admin, set `DEV_SKIP_AUTH=true` in `.env`
to bypass ID-token verification **in dev only**.

## Deploy to Google Cloud Run

```bash
gcloud run deploy roomify \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,FIREBASE_PROJECT_ID=YOUR_FB_PROJECT,FIREBASE_CLIENT_EMAIL=service-account@YOUR_FB_PROJECT.iam.gserviceaccount.com,PUBLIC_APP_URL=https://YOUR-SERVICE.run.app,ALLOWED_ORIGINS=" \
  --set-secrets "FIREBASE_PRIVATE_KEY=firebase-private-key:latest,GEMINI_API_KEY=gemini-api-key:latest"
```

Cloud Run builds the multi-stage `Dockerfile`, listens on `$PORT`, and
exposes `/api/health` as the readiness probe.

Client build env (`APP_*`) is read from `client/.env.production` during the
Docker build. If you prefer to pass them on the deploy command, add
`--set-build-env-vars "APP_FIREBASE_API_KEY=...,APP_FIREBASE_PROJECT_ID=...,..."`.

### Post-deploy checklist

1. Firebase Console → **Authentication → Settings → Authorized domains**:
   add the Cloud Run URL.
2. Optional: set `PUBLIC_APP_URL` on the service to that URL so Pinterest
   OAuth redirects back correctly.
3. Optional: if the SPA lives on a different domain, put it in
   `ALLOWED_ORIGINS`. Leave empty for same-origin Cloud Run deploys.

### Setting up secrets once

```bash
# Upload secrets
printf '%s' "$FIREBASE_PRIVATE_KEY" | gcloud secrets create firebase-private-key --data-file=-
printf '%s' "$GEMINI_API_KEY"       | gcloud secrets create gemini-api-key       --data-file=-

# Grant the Cloud Run runtime service account access to read them
PROJECT_NUMBER=$(gcloud projects describe "$(gcloud config get-value project)" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
for s in firebase-private-key gemini-api-key; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${SA}" --role=roles/secretmanager.secretAccessor
done
```

## Environment variables

See [`.env.example`](.env.example) (server) and
[`client/.env.example`](client/.env.example) (client). No variable is strictly
required at boot — the app detects missing keys and disables just the
affected features via `GET /api/config`.

Server-side (root `.env`):

- **Firebase Admin** — `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
  `FIREBASE_PRIVATE_KEY` (or `GOOGLE_APPLICATION_CREDENTIALS`).
- **Gemini** — `GEMINI_API_KEY` (+ optional `GEMINI_MODEL_*`).
- **Pinterest** — `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET`.
- **Google Custom Search** — `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`.
- **Server** — `PORT`, `NODE_ENV`, `ALLOWED_ORIGINS`, `PUBLIC_APP_URL`,
  `DEV_SKIP_AUTH`.

Client-side (`client/.env`, baked at build time):

- `APP_FIREBASE_API_KEY`, `APP_FIREBASE_AUTH_DOMAIN`, `APP_FIREBASE_PROJECT_ID`,
  `APP_FIREBASE_STORAGE_BUCKET`, `APP_FIREBASE_MESSAGING_SENDER_ID`,
  `APP_FIREBASE_APP_ID`
- `APP_PUBLIC_URL`, `APP_API_BASE_URL`, `APP_PRIVACY_CONTACT_EMAIL`

The allowlist lives in [`client/scripts/env.mjs`](client/scripts/env.mjs); no
other env vars can sneak into the browser bundle.

## API overview

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness probe |
| GET | `/api/config` | Public service status (what's configured) |
| POST | `/api/auth/google-token` | Store Google OAuth access token |
| GET | `/api/auth/pinterest/url` | Start Pinterest OAuth |
| GET | `/api/auth/pinterest/callback` | OAuth callback |
| POST | `/api/media/process` | Multipart upload → analyze + generate concept |
| POST | `/api/media/process-url` | Analyze a remote https image |
| GET | `/api/social/google-photos/albums` | Google Photos albums |
| GET | `/api/social/google-photos/albums/:albumId/media` | Album media |
| GET | `/api/social/pinterest/boards` | Pinterest boards |
| GET | `/api/social/pinterest/boards/:boardId/pins` | Board pins |
| GET | `/api/social/youtube/videos` | Your YouTube videos |
| GET | `/api/search?q=` | Proxied Google Image Search |
| POST | `/api/gemini/refine` | Refine a generated concept |
| POST | `/api/gemini/save-project` | Persist concept to Firestore |
| GET | `/api/gemini/projects` | List saved projects |
| POST | `/api/gemini/log-generation` | Optional analytics log |

All `/api/*` failures return `{ "error": string, "code": string }`.

## Security posture

- Firebase ID-token verification (`Authorization: Bearer <token>`).
- Helmet, CORS allow-list (friendly 403 on mismatch), rate limiting.
- Deep `req.body` sanitization via `sanitize-html`; prototype pollution
  vectors stripped.
- Uploads: size + MIME restrictions (10 MB, JPEG/PNG/WebP + MP3/WAV) and
  in-memory storage (no disk writes).
- `/api/media/process-url` rejects non-https and private/link-local hosts
  to prevent SSRF.
- No secrets ship to the browser — only `APP_FIREBASE_*` public config is
  baked in at build time.

## License / course use

CS651 course project — Group 2.
