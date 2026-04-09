const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';
const TO_ADDRESS = '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f';

test.describe('session, ui and security checks', () => {
  test('lock clears session and requires re-unlock', async ({ page }) => {
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
      correctPassword: 'Passw0rd!',
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');
    await page.click('.lock-btn');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-unlock');

    const swAddress = await page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'get-wallet-address' }, (res) => resolve(res?.address || null));
    }));
    expect(swAddress).toBeNull();

    const sessionState = await page.evaluate(() => new Promise((resolve) => {
      chrome.storage.session.get(['unlocked'], (result) => resolve(result));
    }));
    expect(sessionState.unlocked).toBeUndefined();

    await page.fill('#unlock-password', 'Passw0rd!');
    await page.click('#btn-unlock');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');
  });

  test('uses IBM Plex Mono and keeps global logo across key screens', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      rpc: { mode: 'ok' },
    });

    await expect(page.locator('.global-avatar img')).toBeVisible();

    const fontBody = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    const fontInput = await page.evaluate(() => getComputedStyle(document.querySelector('input')).fontFamily);
    const fontButton = await page.evaluate(() => getComputedStyle(document.querySelector('button')).fontFamily);
    expect(fontBody).toContain('IBM Plex Mono');
    expect(fontInput).toContain('IBM Plex Mono');
    expect(fontButton).toContain('IBM Plex Mono');

    await page.fill('#unlock-password', 'Passw0rd!');
    await page.click('#btn-unlock');
    await expect(page.locator('#screen-wallet')).toHaveClass(/active/);
    await expect(page.locator('.global-avatar img')).toBeVisible();

    await page.click('.action-row .btn-primary');
    await expect(page.locator('#screen-send')).toHaveClass(/active/);
    await page.fill('#send-to', TO_ADDRESS);
    await page.fill('#send-amount', '0.01');
    await page.click('#btn-send');
    await expect(page.locator('#screen-confirm-tx')).toHaveClass(/active/);
    await expect(page.locator('.global-avatar img')).toBeVisible();
  });

  test('does not expose private key in popup storage', async ({ page }) => {
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
    });

    const dump = await page.evaluate(() => Promise.all([
      new Promise((resolve) => chrome.storage.local.get(null, (r) => resolve(r))),
      new Promise((resolve) => chrome.storage.session.get(null, (r) => resolve(r))),
    ]));

    const merged = JSON.stringify({ local: dump[0], session: dump[1] }).toLowerCase();
    expect(merged.includes('privatekey')).toBe(false);
    expect(merged.includes('"pk"')).toBe(false);
  });
});
