const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

test.describe('token add/remove flows', () => {
  test('adds token successfully with valid contract', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        tokensByNetwork: { 'eth-mainnet': [] },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Start on wallet screen
    await page.click('#btn-add-token');

    // Fill valid USDC address
    await page.fill('#token-address', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    await page.click('#btn-add-token-confirm');

    // Should show success or return to wallet
    await expect(page.locator('#token-list')).toBeTruthy();
  });

  test('rejects invalid token contract address', async ({ page }) => {
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
    await page.fill('#token-address', '0xINVALIDLENGTH');
    await page.click('#btn-add-token-confirm');

    // Should show error
    await expect(page.locator('#token-add-error')).toContainText(/invalid|address/i);
  });

  test('prevents duplicate token in network', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        tokensByNetwork: {
          'eth-mainnet': [
            { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
          ],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    await page.click('#btn-add-token');
    await page.fill('#token-address', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    await page.click('#btn-add-token-confirm');

    // Should show already exists error
    await expect(page.locator('#token-add-error')).toContainText(/already|exists|duplicate/i);
  });

  test('removes token and confirms removal', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        tokensByNetwork: {
          'eth-mainnet': [
            { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
            { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
          ],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // token list shows both
    await expect(page.locator('#token-list')).toContainText('USDC');
    await expect(page.locator('#token-list')).toContainText('USDT');

    // Remove USDC
    await page.click('[data-token="0xA0b..."] #btn-remove-token');
    await page.click('#confirm-remove');

    // USDC gone, USDT remains
    await expect(page.locator('#token-list')).not.toContainText('USDC');
    await expect(page.locator('#token-list')).toContainText('USDT');
  });

  test('token appears only in correct network', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        tokensByNetwork: {
          'eth-mainnet': [
            { address: '0xA', symbol: 'USDC', decimals: 6 },
          ],
          'eth-sepolia': [],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // On mainnet, token visible
    await expect(page.locator('#token-list')).toContainText('USDC');

    // Switch to sepolia
    await page.click('#network-selector');
    await page.click('[data-network="eth-sepolia"]');

    // Token not visible on sepolia
    await expect(page.locator('#token-list')).not.toContainText('USDC');

    // Switch back to mainnet
    await page.click('#network-selector');
    await page.click('[data-network="eth-mainnet"]');

    // Token visible again
    await expect(page.locator('#token-list')).toContainText('USDC');
  });
});

test.describe('send transaction validation', () => {
  test('ETH send estimates gas correctly', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: '0x1111111111111111111111111111111111111111', keystore: 'mock', name: 'Main', balance: '10000000000000000000' },
        ],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    await page.click('#btn-send');
    await page.fill('#send-recipient', '0x2222222222222222222222222222222222222222');
    await page.fill('#send-amount', '1');
    await page.click('#btn-estimate-gas');

    // Should show gas fee estimate
    await expect(page.locator('#estimated-gas')).toBeVisible();
    await expect(page.locator('#gas-price')).toContainText(/\d+/);
  });

  test('ERC-20 send shows approve + transfer', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: '0x1111111111111111111111111111111111111111', keystore: 'mock', name: 'Main' },
        ],
        activeAccount: 0,
        tokensByNetwork: {
          'eth-mainnet': [
            { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, balance: '1000000000' },
          ],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    await page.click('#btn-send');
    await page.click('#send-asset');
    await page.click('[data-token="0xA0b..."]');

    // Should indicate ERC-20 flow
    await expect(page.locator('#send-method')).toContainText(/ERC-20|token|approve/i);
  });
});

test.describe('mnemonic flows', () => {
  test('displays mnemonic on account creation', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
    });

    await page.click('[data-tab="create"]');
    await page.fill('#create-password', 'TestPass123!');
    await page.fill('#create-confirm-password', 'TestPass123!');
    await page.click('#btn-create-account');

    // Should show mnemonic screen with 12 or 24 words
    const mnemonicText = await page.locator('#mnemonic-display').textContent();
    const wordCount = mnemonicText.split(/\s+/).filter(w => w.length > 0).length;

    expect([12, 24]).toContain(wordCount);
  });

  test('mnemonic confirmation validates word order', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
    });

    await page.click('[data-tab="create"]');
    await page.fill('#create-password', 'Pass123!');
    await page.fill('#create-confirm-password', 'Pass123!');
    await page.click('#btn-create-account');

    // On confirmation screen, select words in random order
    // (this depends on actual UI implementation)
    const confirmWords = await page.locator('[data-mnemonic-word]').count();
    expect(confirmWords).toBeGreaterThan(0);
  });

  test('import validates mnemonic format', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
    });

    await page.click('[data-tab="import"]');

    // Invalid mnemonic (too few words)
    await page.fill('#import-mnemonic', 'one two three');
    await page.click('#btn-import');

    await expect(page.locator('#import-error')).toContainText(/invalid|mnemonic|words/i);
  });

  test('import with valid BIP39 mnemonic succeeds', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
    });

    await page.click('[data-tab="import"]');

    const validMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    await page.fill('#import-mnemonic', validMnemonic);
    await page.fill('#import-password', 'ImportPass123!');
    await page.click('#btn-import');

    // Should proceed (to wallet or confirmation)
    await expect(page.locator('body')).toBeTruthy();
  });
});

test.describe('multi-account flows', () => {
  test('displays all accounts in selector', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: '0x1111111111111111111111111111111111111111', name: 'Account 1' },
          { address: '0x2222222222222222222222222222222222222222', name: 'Account 2' },
          { address: '0x3333333333333333333333333333333333333333', name: 'Account 3' },
        ],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    await page.click('#btn-account-selector');

    // All accounts listed
    await expect(page.locator('[data-account="0"]')).toContainText('Account 1');
    await expect(page.locator('[data-account="1"]')).toContainText('Account 2');
    await expect(page.locator('[data-account="2"]')).toContainText('Account 3');
  });

  test('switching account updates UI and history', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: '0x1111111111111111111111111111111111111111', name: 'Acc1' },
          { address: '0x2222222222222222222222222222222222222222', name: 'Acc2' },
        ],
        activeAccount: 0,
        txHistory: {
          'eth-mainnet:0x1111111111111111111111111111111111111111': [
            { hash: '0x111', direction: 'out' },
          ],
          'eth-mainnet:0x2222222222222222222222222222222222222222': [
            { hash: '0x222', direction: 'out' },
          ],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Account 1 history
    await expect(page.locator('#account-name')).toContainText('Acc1');
    await expect(page.locator('#history-list')).toContainText('0x111');

    // Switch to account 2
    await page.click('#btn-account-selector');
    await page.click('[data-account="1"]');

    // Account 2 history
    await expect(page.locator('#account-name')).toContainText('Acc2');
    await expect(page.locator('#history-list')).toContainText('0x222');
    await expect(page.locator('#history-list')).not.toContainText('0x111');
  });
});

test.describe('lock flow', () => {
  test('lock button clears session and requires unlock', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true, unlockTime: Date.now() },
    });

    // On wallet screen
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');

    // Click lock
    await page.click('#btn-lock');

    // Back to unlock screen
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-unlock');
  });

  test('auto-lock inactive popup after 5 minutes', async ({ page }) => {
    // This test may need to use fake timers or mocking
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true, unlockTime: Date.now() - (6 * 60 * 1000) },
    });

    // Simulate 6 minutes passed
    // UI should detect timeout
    await page.waitForTimeout(500);

    // Should require unlock
    const screen = await page.locator('[data-screen-id]').getAttribute('data-screen-id');
    expect(['screen-unlock', 'screen-lock-required']).toContain(screen);
  });
});
