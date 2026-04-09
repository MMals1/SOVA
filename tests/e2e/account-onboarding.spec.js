const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';

async function readLocalStorage(page, keys) {
  return page.evaluate((storageKeys) => new Promise((resolve) => {
    chrome.storage.local.get(storageKeys, (result) => resolve(result));
  }), keys);
}

test.describe('account onboarding', () => {
  test('creates first wallet and passes mnemonic confirmation quiz', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
      correctPassword: 'Passw0rd!',
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-setup');
    await page.click('.tabs [data-tab="create"]');
    await page.fill('#create-password', 'Passw0rd!');
    await page.click('#btn-create');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-mnemonic');
    const mnemonic = await page.locator('#mnemonic-display').textContent();
    const words = String(mnemonic || '').trim().split(/\s+/);
    expect(words).toHaveLength(12);

    await page.click('#screen-mnemonic .btn-primary');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-quiz');

    for (let i = 0; i < 3; i += 1) {
      const label = await page.locator(`#quiz-inputs .field:nth-child(${i + 1}) label`).textContent();
      const match = String(label || '').match(/#(\d+)/);
      expect(match).not.toBeNull();
      const index = Number(match[1]) - 1;
      await page.fill(`#quiz-inp-${i}`, words[index]);
    }

    await page.click('#btn-verify-quiz');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');

    const storage = await readLocalStorage(page, ['accounts', 'activeAccount']);
    expect(Array.isArray(storage.accounts)).toBe(true);
    expect(storage.accounts).toHaveLength(1);
    expect(storage.activeAccount).toBe(0);
  });

  test('imports wallet and rejects invalid mnemonic', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: { accounts: [] },
      session: {},
      correctPassword: 'Passw0rd!',
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-setup');

    await page.fill('#import-mnemonic', 'foo bar baz');
    await page.fill('#import-password', 'Passw0rd!');
    await page.click('#btn-import');
    await expect(page.locator('#import-error')).toContainText('Неверная мнемоническая фраза');

    await page.fill('#import-mnemonic', TEST_MNEMONIC);
    await page.click('#btn-import');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');
    const storage = await readLocalStorage(page, ['accounts']);
    expect(storage.accounts).toHaveLength(1);
  });

  test('adds subaccount and allows switching between accounts', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c', keystore: 'mock-keystore', name: 'Account 1' }],
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
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');

    await page.click('#wallet-avatar');
    await page.click('#acct-menu .acct-menu-btn');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-add-account');

    await page.fill('#add-account-password', 'Passw0rd!');
    await page.click('#btn-add-account');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');
    await expect(page.locator('#header-acct-name')).toHaveText('Account 2');

    await page.click('#wallet-avatar');
    await page.locator('#acct-list .acct-item').first().click();
    await expect(page.locator('#header-acct-name')).toHaveText('Account 1');
  });
});
