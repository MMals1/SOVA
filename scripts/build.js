#!/usr/bin/env node
'use strict';

// ── SOVA Wallet — esbuild bundler ───────────────────────────────────────
// Bundles popup ES modules into a single popup.bundle.js for CSP compliance.
// ethers.umd.min.js stays external (loaded via separate <script> tag).
//
// Usage:
//   node scripts/build.js           — one-shot build
//   node scripts/build.js --watch   — watch mode for development

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const isWatch = process.argv.includes('--watch');

// ── Popup bundle ────────────────────────────────────────────────────────
// Entry point: popup-entry.js imports all ES modules in correct order.
const POPUP_ENTRY = path.join(EXT, 'popup', 'popup-entry.js');

async function build() {
  console.log('[build] Entry: popup-entry.js (ES module imports)');

  // ── Step 1: Compile shared/*.ts → shared/*.js for SW & content-script ─
  const SHARED = path.join(EXT, 'shared');
  const tsFiles = fs.readdirSync(SHARED).filter((f) => f.endsWith('.ts'));
  if (tsFiles.length) {
    for (const tsFile of tsFiles) {
      await esbuild.build({
        entryPoints: [path.join(SHARED, tsFile)],
        outfile: path.join(SHARED, tsFile.replace('.ts', '.js')),
        format: 'iife',
        target: 'es2020',
        minify: false, // SW files stay readable for debugging
        bundle: false, // no bundling — single file compilation
        logLevel: 'warning',
        logOverride: { 'commonjs-variable-in-esm': 'silent' },
      });
    }
    console.log(`[build] Compiled ${tsFiles.length} shared/*.ts → *.js`);
  }

  // ── Step 1b: Compile background/*.ts → background/*.js for SW ─────────
  const BG = path.join(EXT, 'background');
  const bgTsFiles = fs.readdirSync(BG).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  if (bgTsFiles.length) {
    for (const tsFile of bgTsFiles) {
      await esbuild.build({
        entryPoints: [path.join(BG, tsFile)],
        outfile: path.join(BG, tsFile.replace('.ts', '.js')),
        format: 'iife',
        target: 'es2020',
        minify: false,
        bundle: false,
        logLevel: 'warning',
        logOverride: { 'commonjs-variable-in-esm': 'silent' },
      });
    }
    console.log(`[build] Compiled ${bgTsFiles.length} background/*.ts → *.js`);
  }

  // ── Step 2: Bundle popup ──────────────────────────────────────────────
  const commonOptions = {
    bundle: true,
    format: 'iife',
    target: 'es2020',
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
    logLevel: 'info',
    logOverride: { 'commonjs-variable-in-esm': 'silent' },
  };

  // Popup bundle
  const popupCtx = await esbuild.context({
    ...commonOptions,
    entryPoints: [POPUP_ENTRY],
    outfile: path.join(EXT, 'popup', 'popup.bundle.js'),
    // ethers is loaded via <script> tag, available as global
    external: [],
    // ethers is already global — we just need the modules that use it
    define: {},
  });

  if (isWatch) {
    console.log('[build] Watching for changes...');
    await popupCtx.watch();
  } else {
    await popupCtx.rebuild();
    await popupCtx.dispose();

    // Report sizes
    const bundlePath = path.join(EXT, 'popup', 'popup.bundle.js');
    const stats = fs.statSync(bundlePath);
    const kb = (stats.size / 1024).toFixed(1);
    console.log(`[build] popup.bundle.js: ${kb} KB`);

    // ── 5.3: Reproducible build hashes ────────────────────────────────
    const hashFiles = [
      path.join(EXT, 'popup', 'popup.bundle.js'),
      path.join(EXT, 'libs', 'ethers.umd.min.js'),
      path.join(EXT, 'manifest.json'),
    ];
    const hashes = {};
    for (const f of hashFiles) {
      if (!fs.existsSync(f)) continue;
      const content = fs.readFileSync(f);
      const sha = crypto.createHash('sha256').update(content).digest('hex');
      const name = path.relative(EXT, f);
      hashes[name] = sha;
      console.log(`[build] SHA-256 ${name}: ${sha.slice(0, 16)}…`);
    }
    // Write build-hashes.json for reproducible build verification
    const hashPath = path.join(ROOT, 'build-hashes.json');
    fs.writeFileSync(hashPath, JSON.stringify(hashes, null, 2) + '\n');
    console.log(`[build] Hashes written to build-hashes.json`);
  }
}

build().catch((err) => {
  console.error('[build] FAILED:', err.message);
  process.exit(1);
});
