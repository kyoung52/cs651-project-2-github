/**
 * Path helpers for the Roomify client build.
 * Single source of truth for repo/client/server locations.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const clientRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(clientRoot, '..');
const serverPublic = path.join(repoRoot, 'server', 'public');

export const paths = {
  repoRoot,
  clientRoot,
  clientSrc: path.join(clientRoot, 'src'),
  clientPublic: path.join(clientRoot, 'public'),
  htmlTemplate: path.join(clientRoot, 'index.html'),
  entry: path.join(clientRoot, 'src', 'main.jsx'),
  outDir: serverPublic,
  outAssets: path.join(serverPublic, 'assets'),
};
