// ── SOVA Wallet: tx-history.js unit tests ───────────────────────────────
// Tests tx history module: scope keys, explorer URLs, pagination, loading.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let storageData = {};

function resetMocks() {
  storageData = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((keys, cb) => {
          const result = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          keyList.forEach((k) => {
            if (storageData[k] !== undefined) result[k] = storageData[k];
          });
          if (cb) cb(result);
          return Promise.resolve(result);
        }),
        set: vi.fn((data, cb) => {
          Object.assign(storageData, data);
          if (cb) cb();
          return Promise.resolve();
        }),
      },
      session: {
        get: vi.fn((_, cb) => {
          if (cb) cb({});
          return Promise.resolve({});
        }),
      },
    },
    runtime: { sendMessage: vi.fn() },
  };
}

function stubGlobals() {
  globalThis.WolfPopupSharedState = {
    provider: null,
    activeAccountIndex: 0,
    selectedChain: 'ethereum',
    selectedNetwork: 'eth-sepolia',
    rpcByNetwork: {},
  };
  globalThis.WolfPopupStorage = {
    getLocal: (keys) => new Promise((r) => globalThis.chrome.storage.local.get(keys, r)),
    setLocal: (data) => new Promise((r) => globalThis.chrome.storage.local.set(data, r)),
  };
  globalThis.WolfPopupClipboard = {
    copyText: vi.fn(() => Promise.resolve(true)),
  };
  globalThis.WolfPopupTxHistoryProviders = {
    isAlchemyUrl: (url) => url?.includes('alchemy.com'),
    fetchAlchemyTransfers: vi.fn(() => Promise.resolve([])),
    fetchEtherscanV2Transfers: vi.fn(() => Promise.resolve([])),
    isBlockscoutSupported: vi.fn(() => false),
    fetchBlockscoutTransfers: vi.fn(() => Promise.resolve([])),
  };
  globalThis.WolfPopupNetworkState = {
    NETWORKS: {
      'eth-sepolia': { chainId: 11155111, isTestnet: true, label: 'Ethereum Sepolia' },
      'eth-mainnet': { chainId: 1, isTestnet: false, label: 'Ethereum Mainnet' },
      bsc: { chainId: 56, isTestnet: false, label: 'BNB Chain' },
    },
    getNativeAssetSymbol: () => 'ETH',
    getRpcUrlForNetwork: () => 'https://ethereum-sepolia-rpc.publicnode.com',
  };
  globalThis.WolfWalletCore = {
    getTxScopeKey: (addr, nk) => `${nk}:${String(addr).toLowerCase()}`,
    getTxExplorerBaseUrl: (nk) => {
      if (nk === 'eth-mainnet') return 'https://etherscan.io/tx/';
      if (nk === 'bsc') return 'https://bscscan.com/tx/';
      return 'https://sepolia.etherscan.io/tx/';
    },
    paginateItems: (items, page, size) => {
      const list = Array.isArray(items) ? items : [];
      const totalPages = Math.max(1, Math.ceil(list.length / size));
      const p = Math.min(totalPages, Math.max(1, page));
      return { page: p, totalPages, items: list.slice((p - 1) * size, p * size) };
    },
    formatAmount: (v) => String(v),
    shortAddr: (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''),
  };
  globalThis.getAccountsCached = () => [{ address: '0x1234567890abcdef1234567890abcdef12345678' }];
  globalThis.formatAmount = (v) => String(v);
  globalThis.shortAddr = (addr) => (addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '');
  globalThis.ethers = {
    formatEther: (wei) => String(Number(wei) / 1e18),
    formatUnits: (raw, dec) => String(Number(raw) / 10 ** Number(dec)),
  };
}

let TxHistory;

beforeAll(() => {
  resetMocks();
  stubGlobals();

  document.body.innerHTML = `
    <div id="tx-list"></div>
    <div id="tx-pagination"></div>
    <span id="tx-refresh-indicator"></span>
    <span id="tx-count-badge"></span>
  `;

  // Load tx-cache.js and tx-render.js first (dependencies of tx-history.js)
  const modulesToLoad = ['tx-cache.js', 'tx-render.js', 'tx-history.js'];
  for (const mod of modulesToLoad) {
    let src = fs.readFileSync(
      path.resolve(__dirname, '../../extension/popup/modules/' + mod),
      'utf8',
    );
    src = src.replace(/^import\s+.*$/gm, '');
    src = src.replace(/^export\s+/gm, '');
    // eslint-disable-next-line no-new-func -- intentional: load non-module source into Node ctx
    new Function(src)();
  }
  TxHistory = globalThis.WolfPopupTxHistory;
});

beforeEach(() => {
  resetMocks();
  stubGlobals();
  storageData = {};
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('WolfPopupTxHistory', () => {
  it('exports expected API', () => {
    expect(TxHistory).toBeDefined();
    expect(typeof TxHistory.getTxScopeKey).toBe('function');
    expect(typeof TxHistory.getTxExplorerBaseUrl).toBe('function');
    expect(typeof TxHistory.loadTransactions).toBe('function');
    expect(typeof TxHistory.changeTxPage).toBe('function');
    expect(typeof TxHistory.copyTxHash).toBe('function');
    expect(typeof TxHistory.renderTransactions).toBe('function');
    expect(TxHistory.TX_PAGE_SIZE).toBe(10);
  });

  describe('getTxScopeKey', () => {
    it('builds scope key from address and network', () => {
      const key = TxHistory.getTxScopeKey('0xABC123', 'eth-sepolia');
      expect(key).toBe('eth-sepolia:0xabc123');
    });

    it('uses selected network as default', () => {
      const key = TxHistory.getTxScopeKey('0xDEF456');
      expect(key).toContain('eth-sepolia');
      expect(key).toContain('0xdef456');
    });
  });

  describe('getTxExplorerBaseUrl', () => {
    it('returns Sepolia etherscan for testnet', () => {
      expect(TxHistory.getTxExplorerBaseUrl('eth-sepolia')).toContain('sepolia.etherscan.io');
    });

    it('returns mainnet etherscan', () => {
      expect(TxHistory.getTxExplorerBaseUrl('eth-mainnet')).toBe('https://etherscan.io/tx/');
    });

    it('returns bscscan for BSC', () => {
      expect(TxHistory.getTxExplorerBaseUrl('bsc')).toContain('bscscan.com');
    });
  });

  describe('setTxRefreshIndicator', () => {
    it('toggles active class on indicator element', () => {
      const el = document.getElementById('tx-refresh-indicator');
      TxHistory.setTxRefreshIndicator(true);
      expect(el.classList.contains('active')).toBe(true);
      TxHistory.setTxRefreshIndicator(false);
      expect(el.classList.contains('active')).toBe(false);
    });
  });

  describe('renderTransactions', () => {
    it('renders "no transactions" for empty list', () => {
      const el = document.getElementById('tx-list');
      TxHistory.renderTransactions(el, '0xabc', [], 'eth-sepolia');
      expect(el.textContent).toContain('ранзакц'); // "транзакций" substring
    });

    it('renders transaction items', () => {
      const el = document.getElementById('tx-list');
      const txs = [
        {
          hash: '0x111',
          from: '0xabc',
          to: '0xdef',
          value: '1000000000000000000',
          blockNum: 100,
          asset: 'ETH',
        },
        {
          hash: '0x222',
          from: '0xdef',
          to: '0xabc',
          value: '500000000000000000',
          blockNum: 99,
          asset: 'ETH',
        },
      ];
      TxHistory.renderTransactions(el, '0xabc', txs, 'eth-sepolia');
      expect(el.children.length).toBeGreaterThan(0);
    });
  });

  describe('copyTxHash', () => {
    it('is callable without errors', async () => {
      const btn = document.createElement('button');
      btn.textContent = 'Copy';
      // copyTxHash uses the closure-bound clipboard ref from module init
      await expect(TxHistory.copyTxHash('0xdeadbeef', btn)).resolves.not.toThrow();
    });
  });
});
