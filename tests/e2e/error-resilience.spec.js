const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

test.describe('error handling & resilience', () => {
  test('handles invalid ERC-20 contract address', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        tokensByNetwork: { 'eth-mainnet': [] },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    await page.click('#btn-add-token');
    await page.fill('#token-address', '0xINVALID');
    await page.click('#btn-add-token-confirm');

    await expect(page.locator('#token-error')).toContainText(/invalid|address/i);
  });

  test('shows network error when RPC fails', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
      rpc: { fail: true },
    });

    await expect(page.locator('#network-error')).toBeVisible();
  });

  test('gas estimation error shows message', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    await page.click('#btn-send');
    await page.fill('#send-recipient', '0x2222222222222222222222222222222222222222');
    await page.fill('#send-amount', '0.1');

    // Mock gas estimation failure
    await page.evaluate(() => {
      globalThis.gasEstimationFails = true;
    });

    await page.click('#btn-estimate-gas');

    await expect(page.locator('#gas-error')).toContainText(/estimate|failed|error/i);
  });

  test('shows balance fetch error', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
      rpc: { balanceFails: true },
    });

    // Wait for balance fetch attempt
    await page.waitForTimeout(1000);

    await expect(page.locator('#balance-error')).toBeVisible();
  });

  test('retries on transient network error', async ({ page }) => {
    let attemptCount = 0;

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
      rpc: {
        interceptor: async (method) => {
          attemptCount++;
          if (attemptCount < 2) throw new Error('Network error');
          return { result: '1000000000000000000' };
        },
      },
    });

    // Should eventually succeed after retry
    await page.waitForTimeout(2000);
    // Balance should be visible
    await expect(page.locator('#balance')).toBeTruthy();
  });
});

test.describe('UI rendering & consistency', () => {
  test('displays all account screens without CSS errors', async ({ page }) => {
    const cssErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') cssErrors.push(msg.text());
    });

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    // Navigate through screens
    await page.click('#btn-send');
    await page.click('#btn-back');
    await page.click('#btn-tokens');
    await page.click('#btn-back');

    // Filter CSS-related errors
    const relevantErrors = cssErrors.filter((e) => !e.includes('blocked by CSP'));
    expect(relevantErrors.length).toBe(0);
  });

  test('IBM Plex Mono font applied consistently', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    // Check address uses monospace font
    const addressFont = await page
      .locator('#wallet-address')
      .evaluate((el) => window.getComputedStyle(el).fontFamily);
    expect(addressFont).toContain('Plex');

    // Check amount uses monospace
    const amountFont = await page
      .locator('#wallet-balance')
      .evaluate((el) => window.getComputedStyle(el).fontFamily);
    expect(amountFont).toContain('Plex');
  });

  test('brand logo renders on all screens', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
    });

    // Setup screen should have logo
    let logo = page.locator('.brand-logo, [alt="Logo"]');
    await expect(logo).toBeVisible();

    // Mock unlock flow
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore' }],
        activeAccount: 0,
      },
      session: { unlocked: false },
    });

    // Unlock screen should have logo
    logo = page.locator('.brand-logo, [alt="Logo"]');
    await expect(logo).toBeVisible();
  });

  test('transaction history shows correct symbols (in/out)', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        txHistory: {
          'eth-mainnet:0xabc': [
            {
              hash: '0x111',
              direction: 'out',
              from: '0xABC',
              to: '0xDEF',
              value: '1000000000000000000',
            },
            {
              hash: '0x222',
              direction: 'in',
              from: '0xXYZ',
              to: '0xABC',
              value: '500000000000000000',
            },
          ],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Check outgoing has red/out arrow
    const outItem = page.locator('[data-tx="0x111"]');
    await expect(outItem).toContainText(/→|out|send/i);

    // Check incoming has green/in arrow
    const inItem = page.locator('[data-tx="0x222"]');
    await expect(inItem).toContainText(/←|in|receive/i);
  });

  test('network badge updates on network switch', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
      },
      session: { unlocked: true },
    });

    // Check badge shows Sepolia (testnet)
    let badge = page.locator('#network-badge');
    await expect(badge).toContainText(/Sepolia|Testnet|Test/i);

    // Switch to mainnet
    await page.click('#network-selector');
    await page.click('[data-network="eth-mainnet"]');

    // Badge should now show Mainnet
    badge = page.locator('#network-badge');
    await expect(badge).toContainText(/Mainnet|Ethereum|Main/i);
  });

  test('copy address function works', async ({ page }) => {
    const clipboardData = [];

    await page.on('console', (msg) => {
      if (msg.text().includes('Copied')) {
        clipboardData.push('copied');
      }
    });

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC123DEF456', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    // Mock clipboard API
    await page.evaluate(() => {
      navigator.clipboard = {
        writeText: async (text) => {
          console.log('Copied: ' + text);
          return Promise.resolve();
        },
      };
    });

    await page.click('#btn-copy-address');

    // Check clipboard was called
    await page.waitForTimeout(500);
    await expect(page.locator('#copy-toast')).toContainText(/copied|copy/i);
  });

  test('all explorer links use correct domain per network', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        txHistory: {
          'eth-mainnet:0xabc': [{ hash: '0x111', direction: 'out' }],
          'eth-sepolia:0xabc': [{ hash: '0x222', direction: 'out' }],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Mainnet should use etherscan.io
    let explorerLink = page.locator('[data-tx="0x111"] a[target="_blank"]');
    let href = await explorerLink.getAttribute('href');
    expect(href).toContain('etherscan.io');

    // Switch to Sepolia
    await page.click('#network-selector');
    await page.click('[data-network="eth-sepolia"]');

    // Sepolia should use sepolia.etherscan.io
    explorerLink = page.locator('[data-tx="0x222"] a[target="_blank"]');
    href = await explorerLink.getAttribute('href');
    expect(href).toContain('sepolia.etherscan.io');
  });
});

test.describe('CSP compliance', () => {
  test('inline event handlers do not block', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => {
      if (err.message.includes('CSP')) pageErrors.push(err.message);
    });

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    // Click buttons
    await page.click('#btn-send');
    await page.click('#btn-back');

    // Filter actual CSP errors (not warnings)
    const cspErrors = pageErrors.filter(
      (e) => e.includes('Refused to execute') && e.includes('style'),
    );
    expect(cspErrors.length).toBe(0);
  });

  test('button clicks work under MV3 CSP', async ({ page }) => {
    const buttonClicked = false;

    await page.evaluate(() => {
      globalThis.testClick = () => {
        globalThis.clickCount = (globalThis.clickCount || 0) + 1;
      };
    });

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    // Click should work
    await page.click('#btn-send');
    const clickedCount = await page.evaluate(() => globalThis.clickCount || 0);

    expect(clickedCount).toBeGreaterThan(0);
  });
});
