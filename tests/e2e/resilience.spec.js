const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';
const TO_ADDRESS = '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f';

test.describe('resilience', () => {
  test('shows graceful message on RPC/history fetch failure', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
      },
      session: {
        unlocked: true,
        unlockTime: Date.now(),
      },
      worker: {
        unlockedAccountIndexes: [0],
        activeAccountIndex: 0,
      },
      rpc: {
        mode: 'http-error',
      },
    });

    await page.click('.wallet-tabs [data-tab="history"]');
    await expect(page.locator('#wallet-tab-history')).toHaveClass(/active/);
    await expect(page.locator('#tx-list .empty')).toContainText('Не удалось загрузить транзакции');
  });

  test('redirects to unlock when SW wallet disappears while popup is open', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
      },
      session: {
        unlocked: true,
        unlockTime: Date.now(),
      },
      worker: {
        unlockedAccountIndexes: [0],
        activeAccountIndex: 0,
      },
      rpc: {
        mode: 'ok',
      },
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');

    await page.evaluate(() => {
      window.__testHooks.dropWorkerWallet();
    });

    await page.click('.action-row .btn-primary');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-send');

    await page.fill('#send-to', TO_ADDRESS);
    await page.fill('#send-amount', '0.01');
    await page.click('#btn-send');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-unlock');
  });
});
