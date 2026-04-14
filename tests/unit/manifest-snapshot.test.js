import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const manifestPath = resolve(__dirname, '../../extension/manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

describe('manifest.json security regression', () => {
  it('permissions should match snapshot', () => {
    expect(manifest.permissions).toMatchInlineSnapshot(`
      [
        "storage",
        "alarms",
        "clipboardWrite",
        "notifications",
        "activeTab",
      ]
    `);
  });

  it('host_permissions should match snapshot', () => {
    expect(manifest.host_permissions).toMatchSnapshot();
  });

  it('content_security_policy should match snapshot', () => {
    expect(manifest.content_security_policy).toMatchSnapshot();
  });

  it('CSP must not contain unsafe-inline or unsafe-eval', () => {
    const csp = JSON.stringify(manifest.content_security_policy || {});
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('web_accessible_resources should match snapshot', () => {
    expect(manifest.web_accessible_resources).toMatchSnapshot();
  });
});
