// ── SOVA Wallet: token-state.js unit tests ──────────────────────────────
// Tests token management logic: scoped storage, logo URLs, validation.

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
        remove: vi.fn((keys, cb) => {
          const keyList = Array.isArray(keys) ? keys : [keys];
          keyList.forEach((k) => delete storageData[k]);
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
    removeLocal: (keys) => new Promise((r) => globalThis.chrome.storage.local.remove(keys, r)),
  };
  globalThis.WolfPopupUiMessages = {
    showError: vi.fn(),
    setStatus: vi.fn(),
    clearMessages: vi.fn(),
    setLoading: vi.fn(),
  };
  globalThis.WolfPopupClipboard = {
    copyText: vi.fn(() => Promise.resolve(true)),
  };
  globalThis.WolfWalletCore = {
    getTokensForNetwork: (map, key) => {
      if (!map || typeof map !== 'object') return [];
      return Array.isArray(map[key]) ? map[key] : [];
    },
    setTokensForNetwork: (map, key, tokens) => ({
      ...(map && typeof map === 'object' ? map : {}),
      [key]: Array.isArray(tokens) ? tokens : [],
    }),
    getTokenLogoUrls: (addr, nk) => [
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${addr}/logo.png`,
    ],
  };
  globalThis.getAccountsCached = () => [{ address: '0x1234567890abcdef1234567890abcdef12345678' }];
  globalThis.formatAmount = (v) => String(v);
  globalThis.getOrCreatePopupProvider = () => ({});
  globalThis.ethers = {
    isAddress: (addr) => /^0x[0-9a-fA-F]{40}$/.test(addr),
    getAddress: (addr) => addr,
    Contract: vi.fn(() => ({
      symbol: vi.fn(() => Promise.resolve('USDT')),
      decimals: vi.fn(() => Promise.resolve(6n)),
      name: vi.fn(() => Promise.resolve('Tether USD')),
      balanceOf: vi.fn(() => Promise.resolve(1000000n)),
    })),
    formatUnits: (raw, dec) => String(Number(raw) / 10 ** Number(dec)),
  };
}

let TokenState;

beforeAll(() => {
  resetMocks();
  stubGlobals();

  document.body.innerHTML = `
    <div id="token-list"></div>
    <input id="add-token-addr" value="" />
    <span id="token-info-symbol"></span>
    <span id="token-info-decimals"></span>
    <span id="token-info-name"></span>
    <p id="token-error" style="display:none"></p>
    <p id="token-status" style="display:none"></p>
    <button id="btn-add-token">Add</button>
    <button id="btn-fetch-token">Fetch</button>
  `;

  let src = fs.readFileSync(
    path.resolve(__dirname, '../../extension/popup/modules/token-state.js'),
    'utf8',
  );
  src = src.replace(/^import\s+.*$/gm, '');
  src = src.replace(/^export\s+/gm, '');
  // eslint-disable-next-line no-new-func -- intentional: load non-module source into Node ctx
  new Function(src)();
  TokenState = globalThis.WolfPopupTokenState;
});

beforeEach(() => {
  resetMocks();
  stubGlobals();
  storageData = {};
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('WolfPopupTokenState', () => {
  it('exports expected API', () => {
    expect(TokenState).toBeDefined();
    expect(typeof TokenState.getTokensForSelectedNetwork).toBe('function');
    expect(typeof TokenState.loadTokenBalances).toBe('function');
    expect(typeof TokenState.fetchTokenInfo).toBe('function');
    expect(typeof TokenState.addToken).toBe('function');
    expect(typeof TokenState.removeToken).toBe('function');
    expect(typeof TokenState.onTokenAddrChange).toBe('function');
    expect(Array.isArray(TokenState.ERC20_ABI)).toBe(true);
  });

  describe('getTokensForSelectedNetwork', () => {
    it('returns empty array when no tokens stored', async () => {
      const tokens = await TokenState.getTokensForSelectedNetwork();
      expect(tokens).toEqual([]);
    });

    it('returns tokens scoped to selected network', async () => {
      const testTokens = [{ address: '0xaaa', symbol: 'TST', decimals: 18 }];
      storageData.tokensByNetwork = { 'eth-sepolia': testTokens };
      const tokens = await TokenState.getTokensForSelectedNetwork();
      expect(tokens).toEqual(testTokens);
    });

    it('does not leak tokens from other networks', async () => {
      storageData.tokensByNetwork = {
        'eth-mainnet': [{ address: '0xbbb', symbol: 'MAIN', decimals: 18 }],
      };
      const tokens = await TokenState.getTokensForSelectedNetwork();
      expect(tokens).toEqual([]);
    });

    it('migrates legacy tokens array', async () => {
      const legacy = [{ address: '0xccc', symbol: 'OLD', decimals: 18 }];
      storageData.tokens = legacy;
      const tokens = await TokenState.getTokensForSelectedNetwork();
      expect(tokens).toEqual(legacy);
      // After migration, tokensByNetwork should be set and tokens removed
      expect(storageData.tokensByNetwork?.['eth-sepolia']).toEqual(legacy);
    });
  });

  describe('getTokenLogoUrls', () => {
    it('returns logo URLs for valid ETH token', () => {
      const urls = TokenState.getTokenLogoUrls(
        '0x1234567890abcdef1234567890abcdef12345678',
        'eth-sepolia',
      );
      expect(urls.length).toBeGreaterThan(0);
      expect(urls[0]).toContain('trustwallet');
    });

    it('returns empty array for empty address', () => {
      const urls = TokenState.getTokenLogoUrls('', 'eth-sepolia');
      expect(urls).toEqual([]);
    });
  });

  describe('onTokenAddrChange', () => {
    it('is a function', () => {
      expect(typeof TokenState.onTokenAddrChange).toBe('function');
    });
  });

  describe('ERC20_ABI', () => {
    it('contains standard ERC-20 methods', () => {
      const abi = TokenState.ERC20_ABI;
      expect(abi.length).toBe(5);
      const joined = abi.join(' ');
      expect(joined).toContain('balanceOf');
      expect(joined).toContain('transfer');
      expect(joined).toContain('symbol');
      expect(joined).toContain('decimals');
    });
  });
});
