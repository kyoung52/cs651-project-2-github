#!/usr/bin/env node
/**
 * Roomify client build (esbuild).
 *
 * Produces a static SPA bundle into `server/public/` so the Express server
 * in `server/server.js` can serve everything from a single container.
 *
 * Usage:
 *   node build.mjs            # one-shot production build
 *   node build.mjs --dev      # one-shot development build (non-minified)
 *   node build.mjs --watch    # watch + incremental rebuilds (dev)
 */
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paths } from './scripts/paths.mjs';
import { loadClientEnv, toEsbuildDefine } from './scripts/env.mjs';

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const mode = args.has('--dev') || watch ? 'development' : 'production';
const isProd = mode === 'production';

async function prepareOutputDir() {
  await rm(paths.outDir, { recursive: true, force: true });
  await mkdir(paths.outAssets, { recursive: true });
  try {
    await cp(paths.clientPublic, paths.outDir, { recursive: true });
  } catch {
    // client/public/ is optional
  }
}

/** Locate the hashed entry outputs that esbuild emitted. */
async function findEntryOutputs() {
  const files = await readdir(paths.outAssets);
  const js = files.find((f) => /^main.*\.js$/.test(f));
  const css = files.find((f) => /^main.*\.css$/.test(f));
  return { js, css };
}

async function renderIndexHtml() {
  const tmpl = await readFile(paths.htmlTemplate, 'utf8');
  const { js, css } = await findEntryOutputs();
  if (!js) throw new Error('esbuild did not emit a main.js entry output');

  const scriptTag = `<script type="module" src="/assets/${js}"></script>`;
  const cssTag = css ? `<link rel="stylesheet" href="/assets/${css}" />` : '';

  const html = tmpl
    .replace(
      /<script[^>]*src=["']\/src\/main\.jsx["'][^>]*>\s*<\/script>/,
      scriptTag
    )
    .replace('</head>', `  ${cssTag}\n  </head>`);

  await writeFile(path.join(paths.outDir, 'index.html'), html, 'utf8');
}

async function makeOptions() {
  const env = await loadClientEnv(mode);
  const define = toEsbuildDefine(env, mode);
  return {
    entryPoints: [paths.entry],
    bundle: true,
    outdir: paths.outAssets,
    entryNames: isProd ? '[name]-[hash]' : '[name]',
    assetNames: isProd ? '[name]-[hash]' : '[name]',
    chunkNames: isProd ? 'chunks/[name]-[hash]' : 'chunks/[name]',
    format: 'esm',
    splitting: true,
    target: ['es2020', 'chrome100', 'firefox100', 'safari15', 'edge100'],
    loader: {
      '.js': 'jsx',
      '.jsx': 'jsx',
      '.svg': 'file',
      '.png': 'file',
      '.jpg': 'file',
      '.jpeg': 'file',
      '.gif': 'file',
      '.webp': 'file',
      '.woff': 'file',
      '.woff2': 'file',
    },
    jsx: 'automatic',
    jsxDev: !isProd,
    sourcemap: !isProd,
    minify: isProd,
    metafile: true,
    define,
    logLevel: 'info',
    legalComments: 'none',
  };
}

async function runOnce() {
  await prepareOutputDir();
  const options = await makeOptions();
  await build(options);
  await renderIndexHtml();
  console.log(`[roomify] ${mode} build -> ${paths.outDir}`);
}

async function runWatch() {
  await prepareOutputDir();
  const options = await makeOptions();
  const ctx = await context({
    ...options,
    plugins: [
      {
        name: 'roomify-html',
        setup(b) {
          b.onEnd(async (result) => {
            if (result.errors.length > 0) return;
            try {
              await renderIndexHtml();
              console.log('[roomify] rebuild complete');
            } catch (e) {
              console.error('[roomify] html rewrite failed:', e.message);
            }
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log('[roomify] watching client/src for changes...');
}

async function main() {
  if (watch) {
    await runWatch();
  } else {
    await runOnce();
  }
}

main().catch((err) => {
  console.error('[roomify] build failed:', err);
  process.exit(1);
});
