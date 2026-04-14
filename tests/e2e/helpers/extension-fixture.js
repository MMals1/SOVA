// ── extension-fixture.js — Playwright fixture for real .crx loading ──────
// Launches Chromium with the unpacked extension directory.
// Provides helpers to open the popup and interact with the real extension.

const path = require('path');
const { chromium } = require('@playwright/test');

const EXTENSION_DIR = path.resolve(__dirname, '../../../extension');

/**
 * Launch Chromium with the SOVA Wallet extension loaded as unpacked.
 * Returns { browser, context, extensionId }.
 */
async function launchWithExtension(options = {}) {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      '--no-first-run',
      '--disable-gpu',
      '--no-sandbox',
    ],
    ...options,
  });

  // Wait for the service worker to register
  let serviceWorker;
  if (context.serviceWorkers().length === 0) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10_000 });
  } else {
    serviceWorker = context.serviceWorkers()[0];
  }

  // Extract extension ID from service worker URL
  const swUrl = serviceWorker.url();
  const extensionId = swUrl.split('/')[2];

  return { context, extensionId, serviceWorker };
}

/**
 * Open the extension popup page in a new tab.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function openExtensionPopup(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/**
 * Get the currently active screen ID.
 * @param {import('@playwright/test').Page} page
 */
async function getActiveScreenId(page) {
  return page.evaluate(() => {
    const node = document.querySelector('.screen.active');
    return node ? node.id : null;
  });
}

module.exports = {
  launchWithExtension,
  openExtensionPopup,
  getActiveScreenId,
  EXTENSION_DIR,
};
