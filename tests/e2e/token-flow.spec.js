const { expect, test } = require('@playwright/test');
const { openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';

async function openAddTokenScreen(page) {
  await page.click('.action-row .btn-ghost');
  await expect(page.locator('#screen-add-token')).toHaveClass(/active/);
}

async function addToken(page, { address, symbol, decimals }) {
  await openAddTokenScreen(page);
  await page.fill('#token-address', address);
  await page.fill('#token-symbol', symbol);
  await page.fill('#token-decimals', String(decimals));
  await page.click('#screen-add-token .btn-primary');
  await expect(page.locator('#screen-wallet')).toHaveClass(/active/);
}

async function readTokensByNetwork(page) {
  return page.evaluate(async () => {
    return new Promise((resolve) => {
      chrome.storage.local.get(['tokensByNetwork'], (result) => {
        resolve(result.tokensByNetwork || {});
      });
    });
  });
}

test.describe('token flow', () => {
  test('shows validation error for invalid token contract address', async ({ page }) => {
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

    await openAddTokenScreen(page);
    await page.fill('#token-address', 'invalid-address');
    await page.fill('#token-symbol', 'BAD');
    await page.fill('#token-decimals', '18');
    await page.click('#screen-add-token .btn-primary');

    await expect(page.locator('#add-token-error')).toContainText('Неверный адрес контракта');
    await expect(page.locator('#screen-add-token')).toHaveClass(/active/);
  });

  test('adds token in BSC without affecting Ethereum networks', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'bsc',
        tokensByNetwork: {
          bsc: [],
          'eth-mainnet': [{ address: '0x2222222222222222222222222222222222222222', symbol: 'USDC', decimals: 6 }],
          'eth-sepolia': [{ address: '0x1111111111111111111111111111111111111111', symbol: 'sUSDC', decimals: 6 }],
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

    await addToken(page, {
      address: '0x7777777777777777777777777777777777777777',
      symbol: 'BUSD',
      decimals: 18,
    });

    const tokensByNetwork = await readTokensByNetwork(page);
    expect(tokensByNetwork.bsc).toHaveLength(1);
    expect(tokensByNetwork.bsc[0].symbol).toBe('BUSD');
    expect(tokensByNetwork['eth-mainnet']).toHaveLength(1);
    expect(tokensByNetwork['eth-mainnet'][0].symbol).toBe('USDC');
    expect(tokensByNetwork['eth-sepolia']).toHaveLength(1);
    expect(tokensByNetwork['eth-sepolia'][0].symbol).toBe('sUSDC');
  });

  test('adds token in current network only', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        tokensByNetwork: {
          'eth-mainnet': [{ address: '0x2222222222222222222222222222222222222222', symbol: 'USDC', decimals: 6 }],
          'eth-sepolia': [],
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

    await addToken(page, {
      address: '0x1111111111111111111111111111111111111111',
      symbol: 'sUSDC',
      decimals: 6,
    });

    const tokensByNetwork = await readTokensByNetwork(page);
    expect(tokensByNetwork['eth-sepolia']).toHaveLength(1);
    expect(tokensByNetwork['eth-sepolia'][0].symbol).toBe('SUSDC');
    expect(tokensByNetwork['eth-mainnet']).toHaveLength(1);
    expect(tokensByNetwork['eth-mainnet'][0].symbol).toBe('USDC');
  });

  test('renders token logo or fallback symbol', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        tokensByNetwork: {
          'eth-sepolia': [],
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

    await addToken(page, {
      address: '0x3333333333333333333333333333333333333333',
      symbol: 'ABCD',
      decimals: 18,
    });

    await expect(page.locator('#token-list .token-symbol')).toContainText(['ABCD']);
    await expect(page.locator('#token-list .token-icon-fallback').first()).toHaveText('ABCD');
  });

  test('removes token from current network only', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'eth-sepolia',
        tokensByNetwork: {
          'eth-sepolia': [{ address: '0x4444444444444444444444444444444444444444', symbol: 'SEP', decimals: 18 }],
          'eth-mainnet': [{ address: '0x5555555555555555555555555555555555555555', symbol: 'MAIN', decimals: 18 }],
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

    await expect(page.locator('#token-list .token-symbol')).toContainText(['SEP']);
    await page.click('#token-list .token-remove');
    await expect(page.locator('#token-list .empty')).toContainText('Нет добавленных токенов');

    const tokensByNetwork = await readTokensByNetwork(page);
    expect(tokensByNetwork['eth-sepolia']).toEqual([]);
    expect(tokensByNetwork['eth-mainnet']).toHaveLength(1);
    expect(tokensByNetwork['eth-mainnet'][0].symbol).toBe('MAIN');
  });

  test('removes token in BSC without touching Ethereum networks', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [{ address: TEST_ADDRESS, keystore: 'mock-keystore', name: 'Account 1' }],
        activeAccount: 0,
        selectedNetwork: 'bsc',
        tokensByNetwork: {
          bsc: [{ address: '0x7777777777777777777777777777777777777777', symbol: 'BUSD', decimals: 18 }],
          'eth-mainnet': [{ address: '0x5555555555555555555555555555555555555555', symbol: 'MAIN', decimals: 18 }],
          'eth-sepolia': [{ address: '0x4444444444444444444444444444444444444444', symbol: 'SEP', decimals: 18 }],
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

    await expect(page.locator('#token-list .token-symbol')).toContainText(['BUSD']);
    await page.click('#token-list .token-remove');
    await expect(page.locator('#token-list .empty')).toContainText('Нет добавленных токенов');

    const tokensByNetwork = await readTokensByNetwork(page);
    expect(tokensByNetwork.bsc).toEqual([]);
    expect(tokensByNetwork['eth-mainnet']).toHaveLength(1);
    expect(tokensByNetwork['eth-mainnet'][0].symbol).toBe('MAIN');
    expect(tokensByNetwork['eth-sepolia']).toHaveLength(1);
    expect(tokensByNetwork['eth-sepolia'][0].symbol).toBe('SEP');
  });
});
