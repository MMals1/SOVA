const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

const TEST_ADDRESS = '0x2465ce1FAe8451893c84aeD8b3f0405C19BCD94c';

// Utility functions for statistics
function calculateMean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function calculateMedian(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregateMetrics(metricsArray) {
  const result = {
    popupOpenMs: metricsArray.map(m => m.popupOpenMs),
    walletRenderMs: metricsArray.map(m => m.walletRenderMs),
    storageOps: [],
    rpcCalls: [],
  };

  // Aggregate storage metrics
  result.storageOps = metricsArray.map(m => m.metrics.storage.local.get + m.metrics.storage.local.set);
  result.rpcCalls = metricsArray.map(m => m.metrics.rpc.totalCalls);

  return result;
}

test.describe('perf baseline', () => {
  test('collects 5-iteration baseline with mean/median stats', async ({ context }) => {
    const iterations = 5;
    const collectedMetrics = [];

    for (let iter = 1; iter <= iterations; iter++) {
      console.log(`\n[iteration ${iter}/${iterations}]`);
      
      const page = await context.newPage();
      const startedAt = Date.now();

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
        rpc: {
          mode: 'ok',
        },
      });

      await expect.poll(() => getActiveScreenId(page)).toBe('screen-wallet');
      const popupOpenMs = Date.now() - startedAt;

      await page.evaluate(() => {
        window.__testHooks.resetMetrics();
      });

      const walletRenderStartedAt = Date.now();
      await page.click('.refresh-btn');
      await expect(page.locator('#wallet-balance')).not.toHaveText('—');
      await expect(page.locator('#wallet-balance')).not.toHaveText('…');
      const walletRenderMs = Date.now() - walletRenderStartedAt;

      await page.click('.wallet-tabs [data-tab="history"]');
      await expect(page.locator('#wallet-tab-history')).toHaveClass(/active/);

      const metrics = await page.evaluate(() => window.__testHooks.getMetrics());

      collectedMetrics.push({
        popupOpenMs,
        walletRenderMs,
        metrics,
      });

      console.log(`  popupOpenMs: ${popupOpenMs}ms`);
      console.log(`  walletRenderMs: ${walletRenderMs}ms`);
      console.log(`  storage.local: get=${metrics.storage.local.get}, set=${metrics.storage.local.set}`);
      console.log(`  rpc.totalCalls: ${metrics.rpc.totalCalls}`);

      // Close this iteration's page
      await page.close();
    }

    // Calculate statistics
    const aggregated = aggregateMetrics(collectedMetrics);
    
    console.log('\n=== BASELINE STATISTICS (5 iterations) ===');
    
    console.log('\npopupOpenMs:');
    console.log(`  Mean: ${calculateMean(aggregated.popupOpenMs).toFixed(1)}ms`);
    console.log(`  Median: ${calculateMedian(aggregated.popupOpenMs).toFixed(1)}ms`);
    console.log(`  Min: ${Math.min(...aggregated.popupOpenMs)}ms`);
    console.log(`  Max: ${Math.max(...aggregated.popupOpenMs)}ms`);
    console.log(`  All: [${aggregated.popupOpenMs.join(', ')}]`);

    console.log('\nwalletRenderMs:');
    console.log(`  Mean: ${calculateMean(aggregated.walletRenderMs).toFixed(1)}ms`);
    console.log(`  Median: ${calculateMedian(aggregated.walletRenderMs).toFixed(1)}ms`);
    console.log(`  Min: ${Math.min(...aggregated.walletRenderMs)}ms`);
    console.log(`  Max: ${Math.max(...aggregated.walletRenderMs)}ms`);
    console.log(`  All: [${aggregated.walletRenderMs.join(', ')}]`);

    console.log('\nstorage.local operations (get + set):');
    console.log(`  Mean: ${calculateMean(aggregated.storageOps).toFixed(1)}`);
    console.log(`  Median: ${calculateMedian(aggregated.storageOps).toFixed(1)}`);
    console.log(`  All: [${aggregated.storageOps.join(', ')}]`);

    console.log('\nrpc.totalCalls:');
    console.log(`  Mean: ${calculateMean(aggregated.rpcCalls).toFixed(1)}`);
    console.log(`  Median: ${calculateMedian(aggregated.rpcCalls).toFixed(1)}`);
    console.log(`  All: [${aggregated.rpcCalls.join(', ')}]`);
    console.log('=====================================\n');

    // Basic assertions
    expect(calculateMean(aggregated.popupOpenMs)).toBeGreaterThan(0);
    expect(calculateMean(aggregated.walletRenderMs)).toBeGreaterThan(0);
  });
});
