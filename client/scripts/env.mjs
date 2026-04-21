/**
 * Load + validate the allowlist of client-side env vars that may be baked
 * into the SPA bundle at build time.
 *
 * Sources (merged, later wins):
 *   1. client/.env
 *   2. client/.env.[production|development]
 *   3. client/.env.local
 *   4. client/.env.[production|development].local
 *   5. process.env (e.g. Cloud Run --set-build-env-vars)
 *
 * Only keys listed in ALLOWED_KEYS leave this module — nothing else can
 * sneak into the browser bundle.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { paths } from './paths.mjs';

export const ALLOWED_KEYS = [
  'APP_FIREBASE_API_KEY',
  'APP_FIREBASE_AUTH_DOMAIN',
  'APP_FIREBASE_PROJECT_ID',
  'APP_FIREBASE_STORAGE_BUCKET',
  'APP_FIREBASE_MESSAGING_SENDER_ID',
  'APP_FIREBASE_APP_ID',
  'APP_PUBLIC_URL',
  'APP_API_BASE_URL',
  'APP_PRIVACY_CONTACT_EMAIL',
];

function parseDotenv(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function readDotenv(filePath) {
  try {
    return parseDotenv(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * @param {'production' | 'development'} mode
 * @returns {Promise<Record<string,string>>}
 */
export async function loadClientEnv(mode) {
  const isProd = mode === 'production';
  const envFiles = [
    path.join(paths.clientRoot, '.env'),
    path.join(paths.clientRoot, isProd ? '.env.production' : '.env.development'),
    path.join(paths.clientRoot, '.env.local'),
    path.join(paths.clientRoot, isProd ? '.env.production.local' : '.env.development.local'),
  ];

  const merged = {};
  for (const f of envFiles) {
    Object.assign(merged, await readDotenv(f));
  }

  for (const k of ALLOWED_KEYS) {
    const fromProcess = process.env[k];
    if (fromProcess !== undefined && fromProcess !== '') {
      merged[k] = fromProcess;
    }
  }

  const out = {};
  for (const k of ALLOWED_KEYS) {
    out[k] = merged[k] ?? '';
  }
  return out;
}

/**
 * Build the `define` map for esbuild from a resolved env object.
 * Every allowed key is available as `import.meta.env.<KEY>` in the bundle.
 */
export function toEsbuildDefine(env, mode) {
  const define = {};
  for (const [k, v] of Object.entries(env)) {
    define[`import.meta.env.${k}`] = JSON.stringify(v ?? '');
  }
  define['import.meta.env.MODE'] = JSON.stringify(mode);
  define['import.meta.env.PROD'] = JSON.stringify(mode === 'production');
  define['import.meta.env.DEV'] = JSON.stringify(mode !== 'production');
  define['process.env.NODE_ENV'] = JSON.stringify(mode);
  return define;
}
