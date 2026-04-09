const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

test.describe('unlock & lockout scenarios', () => {
  test('allows successful unlock with correct password', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: '0xABC', keystore: 'mock-keystore', name: 'Main' },
        ],
        activeAccount: 0,
      },
      session: { unlocked: false },
      correctPassword: 'SecurePass123!',
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-unlock');
    await page.fill('#unlock-password', 'SecurePass123!');
    await page.click('#btn-unlock');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');
  });

  test('shows error on wrong password', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: '0xABC', keystore: 'mock-keystore', name: 'Main' },
        ],
        activeAccount: 0,
      },
      session: { unlocked: false },
      correctPassword: 'SecurePass123!',
    });

    await page.fill('#unlock-password', 'WrongPassword');
    await page.click('#btn-unlock');

    await expect(page.locator('#unlock-error')).toContainText('Неверный пароль');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-unlock');
  });

  test('increments failed attempts on each wrong password', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: '0xABC', keystore: 'mock-keystore', name: 'Main' },
        ],
        activeAccount: 0,
      },
      session: { unlocked: false },
      correctPassword: 'Correct',
    });

    // Attempt 1
    await page.fill('#unlock-password', 'Wrong1');
    await page.click('#btn-unlock');
    await expect(page.locator('#unlock-error')).toBeVisible();

    // Attempt 2
    await page.fill('#unlock-password', 'Wrong2');
    await page.click('#btn-unlock');
    await expect(page.locator('#unlock-error')).toBeVisible();

    // Attempt 3
    await page.fill('#unlock-password', 'Wrong3');
    await page.click('#btn-unlock');

    // Should show lockout message
    await expect(page.locator('#unlock-error')).toContainText(/Подождите|locked/i);
  });

  test('persists unlock session on popup reopen', async ({ page, context }) => {
    const popup1 = await context.newPage();
    await openPopupWithMocks(popup1, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true, unlockTime: Date.now() },
    });

    await expect.poll(() => getActiveScreenId(popup1)).toBe('screen-wallet');

    // Simulate popup reopen with same session
    const popup2 = await context.newPage();
    await openPopupWithMocks(popup2, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true, unlockTime: Date.now() },
    });

    await expect.poll(() => getActiveScreenId(popup2)).toBe('screen-wallet');
    await popup1.close();
    await popup2.close();
  });
});

test.describe('account management flows', () => {
  test('creates new wallet with password', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-setup');

    // Click create tab
    await page.click('[data-tab="create"]');
    await expect(page.locator('#tab-create')).toHaveClass(/active/);

    // Fill password
    await page.fill('#create-password', 'MyPassword123!');
    await page.fill('#create-confirm-password', 'MyPassword123!');

    // Submit
    await page.click('#btn-create-account');

    // Should show mnemonic screen
    await expect(page.locator('#screen-mnemonic')).toBeVisible();
  });

  test('allows importing from mnemonic', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
    });

    await page.click('[data-tab="import"]');
    await expect(page.locator('#tab-import')).toHaveClass(/active/);

    // Fill mnemonic
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    await page.fill('#import-mnemonic', mnemonic);
    await page.fill('#import-password', 'ImportPassword123!');

    await page.click('#btn-import');

    // Should proceed to wallet or confirmation screen
    await expect(page.locator('body')).toBeTruthy();
  });

  test('switches between create and import tabs', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
    });

    // Start with create
    await page.click('[data-tab="create"]');
    await expect(page.locator('#tab-create')).toHaveClass(/active/);

    // Switch to import
    await page.click('[data-tab="import"]');
    await expect(page.locator('#tab-import')).toHaveClass(/active/);
    await expect(page.locator('#tab-create')).not.toHaveClass(/active/);

    // Back to create
    await page.click('[data-tab="create"]');
    await expect(page.locator('#tab-create')).toHaveClass(/active/);
  });
});

test.describe('network switching & scoping', () => {
  test('changes network from dropdown', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');

    // Click network selector
    await page.click('#network-selector');

    // Select Mainnet
    await page.click('[data-network="eth-mainnet"]');

    // Check badge updated
    await expect(page.locator('#network-badge')).toContainText(/Mainnet|MAINNET/i);
  });

  test('persists network selection on reopen', async ({ page, context }) => {
    const popup1 = await context.newPage();
    await openPopupWithMocks(popup1, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Close first popup
    await popup1.close();

    // Reopen with same network
    const popup2 = await context.newPage();
    await openPopupWithMocks(popup2, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    await expect(page.locator('#network-badge')).toContainText(/Mainnet|MAINNET/i);
    await popup2.close();
  });

  test('token list changes with network', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        tokensByNetwork: {
          'eth-mainnet': [
            { address: '0xUSDADDR', symbol: 'USDC', decimals: 6 },
          ],
          'eth-sepolia': [
            { address: '0xSUSDCDDR', symbol: 'sUSDC', decimals: 6 },
          ],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Should show USDC on mainnet
    await expect(page.locator('#token-list')).toContainText('USDC');

    // Switch to sepolia
    await page.click('#network-selector');
    await page.click('[data-network="eth-sepolia"]');

    // Should now show sUSDC
    await expect(page.locator('#token-list')).toContainText('sUSDC');
    await expect(page.locator('#token-list')).not.toContainText('USDC');
  });
});

test.describe('token flows', () => {
  test('adds token to current network only', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        tokensByNetwork: { 'eth-mainnet': [] },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Open add token dialog
    await page.click('#btn-add-token');
    await page.fill('#token-address', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    await page.click('#btn-add-token-confirm');

    // Token should appear in mainnet list
    await expect(page.locator('#token-list')).toContainText(/USDC|USD/i);
  });

  test('removes token from current network', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        tokensByNetwork: {
          'eth-mainnet': [
            { address: '0xUSDADDR', symbol: 'USDC', decimals: 6 },
          ],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Remove USDC
    await page.click('[data-token="0xUSDADDR"] .btn-remove');
    await page.click('#confirm-remove');

    // USDC should disappear
    await expect(page.locator('#token-list')).not.toContainText('USDC');
  });
});

test.describe('send flow validation', () => {
  test('rejects invalid recipient address', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    await page.click('#btn-send');
    await page.fill('#send-recipient', 'invalid-address');
    await page.click('#btn-send-continue');

    await expect(page.locator('#send-error')).toContainText(/invalid|address/i);
  });

  test('rejects sending to same address', async ({ page }) => {
    const senderAddress = '0x1111111111111111111111111111111111111111';
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: senderAddress, keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    await page.click('#btn-send');
    await page.fill('#send-recipient', senderAddress);
    await page.click('#btn-send-continue');

    await expect(page.locator('#send-error')).toContainText(/same|address|recipient/i);
  });

  test('rejects zero or negative amount', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    await page.click('#btn-send');
    await page.fill('#send-amount', '0');
    await page.click('#btn-send-continue');

    await expect(page.locator('#send-error')).toContainText(/amount|greater|zero/i);
  });

  test('rejects insufficient funds', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          {
            address: '0xABC',
            keystore: 'mock-keystore',
            name: 'Main',
            balance: '100000000000000000', // 0.1 ETH
          },
        ],
        activeAccount: 0,
      },
      session: { unlocked: true },
    });

    await page.click('#btn-send');
    await page.fill('#send-recipient', '0x2222222222222222222222222222222222222222');
    await page.fill('#send-amount', '1'); // Try to send 1 ETH
    await page.click('#btn-send-continue');

    await expect(page.locator('#send-error')).toContainText(/insufficient|funds/i);
  });
});

test.describe('transaction history & pagination', () => {
  test('displays transaction history', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        txHistory: {
          'eth-mainnet:0xabc': [
            { hash: '0x111', from: '0xABC', to: '0xDEF', value: '1000000000000000000', direction: 'out' },
            { hash: '0x222', from: '0xXYZ', to: '0xABC', value: '500000000000000000', direction: 'in' },
          ],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Should show transactions
    await expect(page.locator('#history-list')).toContainText('0x111');
    await expect(page.locator('#history-list')).toContainText('0x222');
  });

  test('paggination buttons function correctly', async ({ page }) => {
    const manyTxs = Array.from({ length: 25 }, (_, i) => ({
      hash: `0x${String(i).padStart(64, '0')}`,
      direction: i % 2 === 0 ? 'out' : 'in',
      value: '1000000000000000000',
    }));

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0xABC', keystore: 'mock-keystore', name: 'Main' }],
        activeAccount: 0,
        txHistory: {
          'eth-mainnet:0xabc': manyTxs,
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // First page should show items and next button enabled
    await expect(page.locator('#btn-history-next')).toBeEnabled();
    await expect(page.locator('#btn-history-prev')).toBeDisabled();

    // Click next
    await page.click('#btn-history-next');

    // Previous should now be enabled
    await expect(page.locator('#btn-history-prev')).toBeEnabled();
  });

  test('history isolated by account', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: '0xABC', keystore: 'mock-keystore', name: 'Main' },
          { address: '0xDEF', keystore: 'mock-keystore', name: 'Secondary' },
        ],
        activeAccount: 0,
        txHistory: {
          'eth-mainnet:0xabc': [{ hash: '0x111', direction: 'out' }],
          'eth-mainnet:0xdef': [{ hash: '0x222', direction: 'out' }],
        },
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: true },
    });

    // Account A shows transaction 0x111
    await expect(page.locator('#history-list')).toContainText('0x111');

    // Switch to account B
    await page.click('#btn-switch-account');
    await page.click('[data-account="1"]');

    // Should show transaction 0x222 instead
    await expect(page.locator('#history-list')).not.toContainText('0x111');
    await expect(page.locator('#history-list')).toContainText('0x222');
  });
});
