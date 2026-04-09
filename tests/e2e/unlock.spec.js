const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';

test.describe('unlock flow', () => {
  test('unlocks an existing account with the correct password', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' },
        ],
        activeAccount: 0,
      },
      session: {
        unlocked: false,
      },
      correctPassword: 'Passw0rd!',
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-unlock');
    await page.fill('#unlock-password', 'Passw0rd!');
    await page.click('#btn-unlock');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');
    await expect(page.locator('#header-acct-name')).toHaveText('Account 1');
    await expect(page.locator('#unlock-error')).toBeHidden();
  });

  test('shows an error for wrong password', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [
          { address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' },
        ],
        activeAccount: 0,
      },
      session: {
        unlocked: false,
      },
      correctPassword: 'Passw0rd!',
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-unlock');
    await page.fill('#unlock-password', 'wrong-pass');
    await page.click('#btn-unlock');

    await expect(page.locator('#unlock-error')).toContainText('Неверный пароль');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-unlock');
  });
});
