import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const ETHERS_PATH = resolve(__dirname, '../../extension/libs/ethers.umd.min.js');
const POPUP_HTML_PATH = resolve(__dirname, '../../extension/popup/popup.html');

function computeSRI(filePath) {
  const content = readFileSync(filePath);
  const hash = createHash('sha384').update(content).digest('base64');
  return `sha384-${hash}`;
}

describe('Subresource Integrity for ethers.js', () => {
  it('popup.html ethers script tag must have correct integrity hash', () => {
    const html = readFileSync(POPUP_HTML_PATH, 'utf-8');
    const match = html.match(/ethers\.umd\.min\.js[^>]*integrity="([^"]+)"/);
    expect(match).not.toBeNull();

    const expectedSRI = computeSRI(ETHERS_PATH);
    expect(match[1]).toBe(expectedSRI);
  });

  it('ethers.js file hash must not change unexpectedly', () => {
    const sri = computeSRI(ETHERS_PATH);
    expect(sri).toMatchInlineSnapshot(
      `"sha384-eoEZatO/ymJi+LdBilp3xt/M9N9Lla2JlMVPZuk48Fg1YGl2Mc+vmsky+nkOtlSi"`,
    );
  });
});
