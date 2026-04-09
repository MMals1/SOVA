const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';
const TO_ADDRESS = '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f';

async function unlockToWallet(page) {
  await expect.poll(() => getActiveScreenId(page)).toBe('screen-unlock');
  await page.fill('#unlock-password', 'Passw0rd!');
  await page.click('#btn-unlock');
  await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');
}

async function openSendForm(page) {
  await page.click('.action-row .btn-primary');
  await expect.poll(() => getActiveScreenId(page)).toBe('screen-send');
}

test.describe('ETH send flow', () => {
  test('shows validation error for invalid recipient address', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      rpc: { mode: 'ok' },
    });

    await unlockToWallet(page);
    await openSendForm(page);

    await page.fill('#send-to', 'not-an-address');
    await page.fill('#send-amount', '0.01');
    await page.click('#btn-send');

    await expect(page.locator('#send-error')).toContainText('Неверный адрес получателя');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-send');
  });

  test('shows BNB asset labels when active network is BNB', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'bsc',
        'mainnetSendGuardAccepted:bsc': true,
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      rpc: { mode: 'ok' },
    });

    await unlockToWallet(page);
    await openSendForm(page);

    await page.fill('#send-to', TO_ADDRESS);
    await page.fill('#send-amount', '0.01');
    await page.click('#btn-send');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-confirm-tx');
    await expect(page.locator('#confirm-asset')).toHaveText('BNB');
    await expect(page.locator('#confirm-gas-estimate')).toContainText('BNB');
    await expect(page.locator('#confirm-total')).toContainText('BNB');
  });

  test('shows confirm screen before send', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      rpc: { mode: 'ok' },
    });

    await unlockToWallet(page);
    await openSendForm(page);

    await page.fill('#send-to', TO_ADDRESS);
    await page.fill('#send-amount', '0.01');
    await page.click('#btn-send');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-confirm-tx');
    await expect(page.locator('#confirm-to')).toHaveText(TO_ADDRESS);
    await expect(page.locator('#confirm-asset')).toHaveText('ETH');
    await expect(page.locator('#confirm-total')).toContainText('ETH');
  });

  test('shows insufficient funds when signer balance is not enough', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      rpc: { mode: 'ok' },
      worker: {
        sendEthError: 'insufficient funds for gas * price + value',
      },
    });

    await unlockToWallet(page);
    await openSendForm(page);

    await page.fill('#send-to', TO_ADDRESS);
    await page.fill('#send-amount', '1000');
    await page.click('#btn-send');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-confirm-tx');
    await page.click('#btn-confirm-send');

    await expect(page.locator('#confirm-error')).toContainText('Недостаточно средств');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-confirm-tx');
  });

  test('submits ETH transfer from the selected unlocked account', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      rpc: { mode: 'ok' },
      worker: {
        sendEthHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
    });

    await unlockToWallet(page);
    await openSendForm(page);

    await page.fill('#send-to', TO_ADDRESS);
    await page.fill('#send-amount', '0.02');
    await page.click('#btn-send');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-confirm-tx');
    await page.click('#btn-confirm-send');

    await expect(page.locator('#confirm-success')).toContainText('Отправлено!');
    await expect.poll(() => getActiveScreenId(page), { timeout: 5000 }).toBe('screen-wallet');
  });
});
