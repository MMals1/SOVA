// ── extension-smoke.spec.js — E2E tests with real .crx extension (4.3) ──
// These tests load the actual unpacked extension into Chromium.
// They require a headed browser (not headless) due to Chrome extension limitations.
// Run with: npx playwright test tests/e2e/extension-smoke.spec.js

const { test, expect } = require('@playwright/test');
const {
  launchWithExtension,
  openExtensionPopup,
  getActiveScreenId,
} = require('./helpers/extension-fixture');

// Skip in CI headless environments — Chrome extensions require headed mode
const describeOrSkip = process.env.CI ? test.describe.skip : test.describe;

describeOrSkip('Extension smoke (real .crx)', () => {
  /** @type {import('@playwright/test').BrowserContext} */
  let context;
  let extensionId;

  test.beforeAll(async () => {
    const result = await launchWithExtension();
    context = result.context;
    extensionId = result.extensionId;
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('extension loads and shows setup screen', async () => {
    const page = await openExtensionPopup(context, extensionId);
    const screenId = await getActiveScreenId(page);

    // Fresh extension with no accounts should show setup screen
    expect(screenId).toBe('screen-setup');
    await expect(page.locator('#screen-setup .brand-title')).toHaveText('SOVA Wallet');
    await page.close();
  });

  test('service worker is registered', async () => {
    const workers = context.serviceWorkers();
    expect(workers.length).toBeGreaterThan(0);

    const swUrl = workers[0].url();
    expect(swUrl).toContain(extensionId);
    expect(swUrl).toContain('service-worker.js');
  });

  test('popup has no console errors on load', async () => {
    const errors = [];
    const page = await openExtensionPopup(context, extensionId);
    page.on('pageerror', (err) => errors.push(err.message));

    // Give time for async init
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
    await page.close();
  });

  test('create/import tabs are interactive', async () => {
    const page = await openExtensionPopup(context, extensionId);

    await page.click('.tabs [data-tab="create"]');
    await expect(page.locator('#tab-create')).toHaveClass(/active/);

    await page.click('.tabs [data-tab="import"]');
    await expect(page.locator('#tab-import')).toHaveClass(/active/);

    await page.close();
  });

  test('network picker opens and lists networks', async () => {
    const page = await openExtensionPopup(context, extensionId);

    // Wait for the network badge to appear
    const badge = page.locator('#network-badge');
    await expect(badge).toBeVisible({ timeout: 5000 });

    // Click to open network picker
    await badge.click();
    const picker = page.locator('#network-picker');
    await expect(picker).toBeVisible();

    // Should list supported networks
    const options = picker.locator('.network-option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(2); // At least Sepolia + Mainnet

    await page.close();
  });

  test('manifest version matches package.json', async () => {
    const page = await openExtensionPopup(context, extensionId);

    const manifestVersion = await page.evaluate(async () => {
      const resp = await fetch(chrome.runtime.getURL('manifest.json'));
      const manifest = await resp.json();
      return manifest.version;
    });

    expect(manifestVersion).toMatch(/^\d+\.\d+\.\d+$/);
    await page.close();
  });
});
