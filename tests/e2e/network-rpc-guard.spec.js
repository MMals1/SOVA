const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';
const TO_ADDRESS = '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f';

async function readStorageSnapshot(page) {
  const [localState, sessionState] = await Promise.all([
    page.evaluate(() => new Promise((resolve) => chrome.storage.local.get(null, (r) => resolve(r)))),
    page.evaluate(() => new Promise((resolve) => chrome.storage.session.get(null, (r) => resolve(r)))),
  ]);
  return { localState, sessionState };
}

test.describe('network rpc and mainnet guard', () => {
  test('shows error for unsupported custom RPC provider', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-setup');
    await page.click('.tabs [data-tab="create"]');
    await page.uncheck('#use-default-key');
    await page.fill('#custom-rpc-url', 'https://example.com/rpc');
    await page.fill('#create-password', 'Passw0rd!');
    await page.click('#btn-create');

    await expect(page.locator('#create-error')).toContainText('Провайдер не поддерживается');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-setup');
  });

  test('persists selected network across popup reopen', async ({ context, page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
      },
      session: {
        unlocked: true,
        unlockTime: Date.now(),
      },
      worker: {
        unlockedAccountIndexes: [0],
        activeAccountIndex: 0,
      },
    });

    await expect(page.locator('#screen-wallet')).toHaveClass(/active/);
    await page.evaluate(() => window.selectNetworkOption('wallet', 'eth-mainnet'));
    await expect(page.locator('#network-badge')).toContainText('Ethereum Mainnet');

    const snapshot = await readStorageSnapshot(page);
    await page.close();

    const page2 = await context.newPage();
    await openPopupWithMocks(page2, {
      local: snapshot.localState,
      session: snapshot.sessionState,
      worker: {
        unlockedAccountIndexes: [0],
        activeAccountIndex: 0,
      },
    });

    await expect(page2.locator('#screen-wallet')).toHaveClass(/active/);
    await expect(page2.locator('#network-badge')).toContainText('Ethereum Mainnet');
    await page2.close();
  });

  test('requires confirmation on first mainnet send and remembers acceptance', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-mainnet',
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      rpc: { mode: 'ok' },
    });

    await page.fill('#unlock-password', 'Passw0rd!');
    await page.click('#btn-unlock');
    await expect(page.locator('#screen-wallet')).toHaveClass(/active/);

    await page.click('.action-row .btn-primary');
    await expect(page.locator('#screen-send')).toHaveClass(/active/);
    await page.fill('#send-to', TO_ADDRESS);
    await page.fill('#send-amount', '0.01');

    let dialogs = 0;
    page.on('dialog', async (dialog) => {
      dialogs += 1;
      if (dialogs === 1) await dialog.dismiss();
      else await dialog.accept();
    });

    await page.click('#btn-send');
    await expect(page.locator('#screen-send')).toHaveClass(/active/);

    await page.click('#btn-send');
    await expect(page.locator('#screen-confirm-tx')).toHaveClass(/active/);

    await page.click('#screen-confirm-tx .back-btn');
    await expect(page.locator('#screen-send')).toHaveClass(/active/);

    await page.click('#btn-send');
    await expect(page.locator('#screen-confirm-tx')).toHaveClass(/active/);
    expect(dialogs).toBe(2);
  });
});
