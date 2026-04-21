/**
 * Roomify server entrypoint.
 *
 * Responsibilities:
 *   - load env (`.env` at repo root, then optional server/.env override)
 *   - initialize Firebase Admin (no-throw; graceful when unconfigured)
 *   - build the Express app (`./app.js`) and listen on $PORT
 *
 * Graceful degradation: when optional services (Gemini, Pinterest, Custom
 * Search, Google Photos, YouTube) are not configured, endpoints return a
 * friendly 503 and the SPA shows a "not configured" notice. The app stays up.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initFirebase } from './config/firebase.js';
import { createApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root .env is canonical. server/.env is an optional override for local dev.
dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config({ path: path.join(__dirname, '.env'), override: false });

const PORT = parseInt(process.env.PORT || '8080', 10);
const isProd = process.env.NODE_ENV === 'production';

async function main() {
  initFirebase();
  const app = createApp({ isProd });
  app.listen(PORT, () => {
    console.log(`[roomify] API + SPA listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('[roomify] fatal startup error:', err);
  process.exit(1);
});
