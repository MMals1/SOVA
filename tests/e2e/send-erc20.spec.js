const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';
const TO_ADDRESS = '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f';
const TOKEN_ADDRESS = '0x2222222222222222222222222222222222222222';

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

test.describe('ERC20 send flow', () => {
  test('shows confirm screen for ERC20 and submits transfer', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        tokensByNetwork: {
          'eth-sepolia': [{ address: TOKEN_ADDRESS, symbol: 'USDC', decimals: 6 }],
        },
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      rpc: { mode: 'ok' },
      worker: {
        sendErc20Hash: `0x${'e'.repeat(64)}`,
      },
    });

    await unlockToWallet(page);
    await openSendForm(page);

    await page.selectOption('#send-asset', TOKEN_ADDRESS);
    await page.fill('#send-to', TO_ADDRESS);
    await page.fill('#send-amount', '12.5');
    await page.click('#btn-send');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-confirm-tx');
    await expect(page.locator('#confirm-asset')).toHaveText('USDC');
    await expect(page.locator('#confirm-total')).toContainText('USDC');

    await page.click('#btn-confirm-send');
    await expect(page.locator('#confirm-success')).toContainText('Отправлено!');
    await expect.poll(() => getActiveScreenId(page), { timeout: 5000 }).toBe('screen-wallet');
  });

  test('shows insufficient funds error for ERC20 submit failure', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        tokensByNetwork: {
          'eth-sepolia': [{ address: TOKEN_ADDRESS, symbol: 'USDC', decimals: 6 }],
        },
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      rpc: { mode: 'ok' },
      worker: {
        sendErc20Error: 'insufficient funds for gas * price + value',
      },
    });

    await unlockToWallet(page);
    await openSendForm(page);

    await page.selectOption('#send-asset', TOKEN_ADDRESS);
    await page.fill('#send-to', TO_ADDRESS);
    await page.fill('#send-amount', '1000');
    await page.click('#btn-send');

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-confirm-tx');
    await page.click('#btn-confirm-send');

    await expect(page.locator('#confirm-error')).toContainText('Недостаточно средств');
    await expect.poll(() => getActiveScreenId(page)).toBe('screen-confirm-tx');
  });
});
