#!/usr/bin/env node
'use strict';

// ── 5.3: Verify reproducible build ─────────────────────────────────────
// Compares current files against build-hashes.json to detect tampering.
//
// Usage:
//   node scripts/verify-build.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const hashPath = path.join(ROOT, 'build-hashes.json');

if (!fs.existsSync(hashPath)) {
  console.error('[verify] build-hashes.json not found. Run `npm run build` first.');
  process.exit(1);
}

const expected = JSON.parse(fs.readFileSync(hashPath, 'utf-8'));
let failed = 0;

for (const [relPath, expectedHash] of Object.entries(expected)) {
  const fullPath = path.join(EXT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`[verify] MISSING: ${relPath}`);
    failed++;
    continue;
  }
  const content = fs.readFileSync(fullPath);
  const actual = crypto.createHash('sha256').update(content).digest('hex');
  if (actual !== expectedHash) {
    console.error(`[verify] MISMATCH: ${relPath}`);
    console.error(`  expected: ${expectedHash}`);
    console.error(`  actual:   ${actual}`);
    failed++;
  } else {
    console.log(`[verify] OK: ${relPath}`);
  }
}

if (failed) {
  console.error(`\n[verify] ${failed} file(s) failed verification.`);
  process.exit(1);
} else {
  console.log(`\n[verify] All ${Object.keys(expected).length} files verified.`);
}
