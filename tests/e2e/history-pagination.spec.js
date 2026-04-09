const { expect, test } = require('@playwright/test');
const { openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';
const LOWER = TEST_ADDRESS.toLowerCase();
const SCOPE = `eth-sepolia:${LOWER}`;

function makeTx(index, direction = 'out') {
  return {
    hash: `0x${index.toString(16).padStart(64, '0')}`,
    from: direction === 'out' ? TEST_ADDRESS : '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f',
    to: direction === 'out' ? '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f' : TEST_ADDRESS,
    value: (index / 100).toFixed(2),
    asset: 'ETH',
    blockNum: `0x${(100 + index).toString(16)}`,
  };
}

test.describe('history rendering and pagination', () => {
  test('renders in/out rows with peer and explorer link', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        txHistoryCache: {
          [SCOPE]: [makeTx(1, 'out'), makeTx(2, 'in')],
        },
      },
      session: { unlocked: true, unlockTime: Date.now() },
      worker: { unlockedAccountIndexes: [0], activeAccountIndex: 0 },
    });

    await page.click('.wallet-tabs [data-tab="history"]');
    await expect(page.locator('#wallet-tab-history')).toHaveClass(/active/);

    await expect(page.locator('#tx-list .tx')).toHaveCount(2);
    await expect(page.locator('#tx-list')).toContainText('↗ out');
    await expect(page.locator('#tx-list')).toContainText('↙ in');
    await expect(page.locator('#tx-list')).toContainText('to:');
    await expect(page.locator('#tx-list')).toContainText('from:');
    await expect(page.locator('#tx-list .tx-link').first()).toHaveAttribute('href', /sepolia\.etherscan\.io\/tx\//);
  });

  test('paginates transaction history with controls', async ({ page }) => {
    const txs = Array.from({ length: 25 }, (_, idx) => makeTx(idx + 1, idx % 2 ? 'in' : 'out'));

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        txHistoryCache: {
          [SCOPE]: txs,
        },
      },
      session: { unlocked: true, unlockTime: Date.now() },
      worker: { unlockedAccountIndexes: [0], activeAccountIndex: 0 },
    });

    await page.click('.wallet-tabs [data-tab="history"]');
    await expect(page.locator('#wallet-tab-history')).toHaveClass(/active/);

    await expect(page.locator('#tx-list .tx')).toHaveCount(10);
    await expect(page.locator('#tx-page-info')).toContainText('Страница 1 / 3');
    await expect(page.locator('#tx-page-prev')).toBeDisabled();
    await expect(page.locator('#tx-page-next')).toBeEnabled();

    await page.click('#tx-page-next');
    await expect(page.locator('#tx-page-info')).toContainText('Страница 2 / 3');

    await page.click('#tx-page-next');
    await expect(page.locator('#tx-page-info')).toContainText('Страница 3 / 3');
    await expect(page.locator('#tx-page-next')).toBeDisabled();
    await expect(page.locator('#tx-list .tx')).toHaveCount(5);
  });

  test('shows newly fetched transfer after successful send', async ({ page }) => {
    const sentHash = `0x${'c'.repeat(64)}`;

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
      },
      session: { unlocked: false },
      correctPassword: 'Passw0rd!',
      worker: { sendEthHash: sentHash },
      rpc: {
        mode: 'ok',
        transfersFrom: [{
          hash: sentHash,
          from: TEST_ADDRESS,
          to: '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f',
          value: '0.03',
          asset: 'ETH',
          blockNum: '0x99',
        }],
        transfersTo: [],
      },
    });

    await page.fill('#unlock-password', 'Passw0rd!');
    await page.click('#btn-unlock');
    await expect(page.locator('#screen-wallet')).toHaveClass(/active/);

    await page.click('.action-row .btn-primary');
    await expect(page.locator('#screen-send')).toHaveClass(/active/);
    await page.fill('#send-to', '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f');
    await page.fill('#send-amount', '0.03');
    await page.click('#btn-send');
    await expect(page.locator('#screen-confirm-tx')).toHaveClass(/active/);
    await page.click('#btn-confirm-send');
    await expect(page.locator('#confirm-success')).toContainText('Отправлено!');
    await expect(page.locator('#screen-wallet')).toHaveClass(/active/);

    await page.click('.wallet-tabs [data-tab="history"]');
    await expect(page.locator('#tx-list .tx-link').first()).toContainText(`${sentHash.slice(0, 6)}…${sentHash.slice(-4)}`);
  });
});
