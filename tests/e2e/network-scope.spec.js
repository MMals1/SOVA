const { expect, test } = require('@playwright/test');
const { openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';
const LOWER = TEST_ADDRESS.toLowerCase();
const SEPOLIA_SCOPE = `eth-sepolia:${LOWER}`;
const MAINNET_SCOPE = `eth-mainnet:${LOWER}`;
const BSC_SCOPE = `bsc:${LOWER}`;

async function switchWalletNetwork(page, networkKey) {
  await page.evaluate((nextNetwork) => {
    window.selectNetworkOption('wallet', nextNetwork);
  }, networkKey);

  if (networkKey === 'eth-mainnet') {
    await expect(page.locator('#network-badge')).toContainText('Ethereum Mainnet');
  } else if (networkKey === 'eth-sepolia') {
    await expect(page.locator('#network-badge')).toContainText('Sepolia testnet');
  } else if (networkKey === 'bsc') {
    await expect(page.locator('#network-badge')).toContainText('BNB Chain');
  }
}

async function openHistoryTab(page) {
  await page.click('.wallet-tabs [data-tab="history"]');
  await expect(page.locator('#wallet-tab-history')).toHaveClass(/active/);
}

test.describe('network scope', () => {
  test('keeps transaction history isolated by network', async ({ page }) => {
    const sepoliaHash = `0x${'1'.repeat(64)}`;
    const mainnetHash = `0x${'2'.repeat(64)}`;

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        txHistoryCache: {
          [SEPOLIA_SCOPE]: [{
            hash: sepoliaHash,
            from: TEST_ADDRESS,
            to: '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f',
            value: '0.01',
            asset: 'ETH',
            blockNum: '0x10',
          }],
          [MAINNET_SCOPE]: [{
            hash: mainnetHash,
            from: TEST_ADDRESS,
            to: '0xAbDb2D1C02f0A2130bDD5731c9048bB386cD9B61',
            value: '0.02',
            asset: 'ETH',
            blockNum: '0x20',
          }],
        },
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

    await openHistoryTab(page);
    await expect(page.locator('#tx-list .tx')).toHaveCount(1);
    await expect(page.locator('#tx-list .tx-link')).toContainText(`${sepoliaHash.slice(0, 6)}…${sepoliaHash.slice(-4)}`);

    await switchWalletNetwork(page, 'eth-mainnet');
    await expect(page.locator('#tx-list .tx-link')).toContainText(`${mainnetHash.slice(0, 6)}…${mainnetHash.slice(-4)}`);
  });

  test('uses network-specific explorer links for transactions', async ({ page }) => {
    const hash = `0x${'3'.repeat(64)}`;

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        txHistoryCache: {
          [SEPOLIA_SCOPE]: [{
            hash,
            from: TEST_ADDRESS,
            to: '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f',
            value: '0.01',
            asset: 'ETH',
            blockNum: '0x10',
          }],
          [MAINNET_SCOPE]: [{
            hash,
            from: TEST_ADDRESS,
            to: '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f',
            value: '0.01',
            asset: 'ETH',
            blockNum: '0x10',
          }],
          [BSC_SCOPE]: [{
            hash,
            from: TEST_ADDRESS,
            to: '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f',
            value: '0.01',
            asset: 'BNB',
            blockNum: '0x10',
          }],
        },
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

    await openHistoryTab(page);
    await expect(page.locator('#tx-list .tx-link')).toHaveAttribute('href', new RegExp(`^https://sepolia\\.etherscan\\.io/tx/${hash}$`));

    await switchWalletNetwork(page, 'eth-mainnet');
    await expect(page.locator('#tx-list .tx-link')).toHaveAttribute('href', new RegExp(`^https://etherscan\\.io/tx/${hash}$`));

    await switchWalletNetwork(page, 'bsc');
    await expect(page.locator('#tx-list .tx-link')).toHaveAttribute('href', new RegExp(`^https://bscscan\\.com/tx/${hash}$`));
  });

  test('keeps transaction history isolated for BNB network', async ({ page }) => {
    const sepoliaHash = `0x${'4'.repeat(64)}`;
    const bscHash = `0x${'5'.repeat(64)}`;

    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        txHistoryCache: {
          [SEPOLIA_SCOPE]: [{
            hash: sepoliaHash,
            from: TEST_ADDRESS,
            to: '0x52b652DFc350B15e3406f89Dc2eF78823EE3ee2f',
            value: '0.01',
            asset: 'ETH',
            blockNum: '0x10',
          }],
          [BSC_SCOPE]: [{
            hash: bscHash,
            from: TEST_ADDRESS,
            to: '0xAbDb2D1C02f0A2130bDD5731c9048bB386cD9B61',
            value: '0.02',
            asset: 'BNB',
            blockNum: '0x20',
          }],
        },
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

    await openHistoryTab(page);
    await expect(page.locator('#tx-list .tx-link')).toContainText(`${sepoliaHash.slice(0, 6)}…${sepoliaHash.slice(-4)}`);

    await switchWalletNetwork(page, 'bsc');
    await expect(page.locator('#tx-list .tx-link')).toContainText(`${bscHash.slice(0, 6)}…${bscHash.slice(-4)}`);
    await expect(page.locator('#tx-list .tx-amount')).toContainText('−0.02 BNB');
  });

  test('keeps token lists isolated by network', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        tokensByNetwork: {
          'eth-sepolia': [{ address: '0x1111111111111111111111111111111111111111', symbol: 'sUSDC', decimals: 6 }],
          'eth-mainnet': [{ address: '0x2222222222222222222222222222222222222222', symbol: 'USDC', decimals: 6 }],
        },
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

    await expect(page.locator('#token-list .token-symbol')).toHaveText(['sUSDC']);

    await switchWalletNetwork(page, 'eth-mainnet');
    await expect(page.locator('#token-list .token-symbol')).toHaveText(['USDC']);
  });
});
