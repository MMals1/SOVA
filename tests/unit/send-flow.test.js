// ── SOVA Wallet: send-flow.js unit tests ────────────────────────────────
// Tests the pure/testable logic extracted from the send flow module.
// Uses the IIFE/globalThis loading pattern for popup modules.

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Minimal DOM + chrome mocks ──────────────────────────────────────────
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
        set: vi.fn((_, cb) => {
          if (cb) cb();
          return Promise.resolve();
        }),
      },
    },
    runtime: {
      sendMessage: vi.fn((msg, cb) => {
        if (cb) cb({});
        return Promise.resolve({});
      }),
    },
  };
}

// Stub modules that send-flow.js depends on
function stubGlobalModules() {
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
  globalThis.WolfPopupUiMessages = {
    showError: vi.fn(),
    setStatus: vi.fn(),
    showSuccess: vi.fn(),
    clearMessages: vi.fn(),
    setLoading: vi.fn(),
  };
  globalThis.WolfPopupNetworkState = {
    DEFAULT_NETWORK_KEY: 'eth-sepolia',
    getNativeAssetSymbol: () => 'ETH',
    getCurrentNetworkMeta: () => ({ chainId: 11155111, isTestnet: true, label: 'Sepolia' }),
    getRpcUrlForNetwork: () => 'https://ethereum-sepolia-rpc.publicnode.com',
  };
  globalThis.WolfPopupTokenState = {
    getTokensForSelectedNetwork: () => [],
    ERC20_ABI: [],
  };
  globalThis.WolfWalletCore = {
    formatAmount: (v) => String(v),
  };
  globalThis.getAccountsCached = () => [{ address: '0xabc123', keystore: '{}' }];
  globalThis.formatAmount = (v) => String(v);
  globalThis.getOrCreatePopupProvider = () => ({});
  globalThis.sendToSW = vi.fn((msg, cb) => {
    if (cb) cb({ ok: true, txHash: '0x123' });
  });
  globalThis.ethers = {
    parseEther: (val) => BigInt(Math.round(parseFloat(val) * 1e18)),
    isAddress: (addr) => /^0x[0-9a-fA-F]{40}$/.test(addr),
    getAddress: (addr) => addr,
    JsonRpcProvider: vi.fn(() => ({
      estimateGas: vi.fn(() => Promise.resolve(21000n)),
      getBalance: vi.fn(() => Promise.resolve(10n ** 18n)),
    })),
    Contract: vi.fn(() => ({
      balanceOf: vi.fn(() => Promise.resolve(10n ** 18n)),
      transfer: { estimateGas: vi.fn(() => Promise.resolve(60000n)) },
    })),
  };
}

let SendFlow;

beforeAll(() => {
  resetMocks();
  stubGlobalModules();

  // Create minimal DOM for send flow
  document.body.innerHTML = `
    <div id="screen-send" class="hidden">
      <input id="send-to" value="" />
      <input id="send-amount" value="" />
      <input id="send-asset" value="native" />
      <span id="send-asset-label">ETH</span>
      <div id="send-asset-menu"></div>
      <div id="send-asset-picker"></div>
      <span id="send-gas-estimate"></span>
      <span id="send-balance-info"></span>
      <span id="send-max-label"></span>
      <p id="send-error" style="display:none"></p>
      <p id="send-status" style="display:none"></p>
      <p id="send-success" style="display:none"></p>
      <button id="btn-send">Send</button>
    </div>
    <div id="screen-confirm-send" class="hidden">
      <span id="confirm-to"></span>
      <span id="confirm-amount"></span>
      <span id="confirm-gas"></span>
      <span id="confirm-total"></span>
      <span id="confirm-first-time-warning" class="hidden"></span>
      <p id="confirm-error" style="display:none"></p>
      <button id="btn-confirm-send">Confirm</button>
    </div>
    <div id="screen-wallet" class="hidden"></div>
  `;

  // Stub showScreen
  globalThis.showScreen = vi.fn();

  let src = fs.readFileSync(
    path.resolve(__dirname, '../../extension/popup/modules/send-flow.js'),
    'utf8',
  );
  src = src.replace(/^import\s+.*$/gm, '');
  src = src.replace(/^export\s+/gm, '');
  // eslint-disable-next-line no-new-func -- intentional: load non-module source into Node ctx
  new Function(src)();
  SendFlow = globalThis.WolfPopupSendFlow;
});

beforeEach(() => {
  resetMocks();
  stubGlobalModules();
  storageData = {};
});

// ── Tests ───────────────────────────────────────────────────────────────

describe('WolfPopupSendFlow', () => {
  it('exports expected API surface', () => {
    expect(SendFlow).toBeDefined();
    expect(typeof SendFlow.showSendScreen).toBe('function');
    expect(typeof SendFlow.resetSendFlowUI).toBe('function');
    expect(typeof SendFlow.sendTransaction).toBe('function');
    expect(typeof SendFlow.confirmSend).toBe('function');
    expect(typeof SendFlow.cancelSend).toBe('function');
  });

  describe('resetSendFlowUI', () => {
    it('clears input fields when clearInputs=true', () => {
      document.getElementById('send-to').value = '0xabc';
      document.getElementById('send-amount').value = '1.0';
      SendFlow.resetSendFlowUI({ clearInputs: true });
      expect(document.getElementById('send-to').value).toBe('');
      expect(document.getElementById('send-amount').value).toBe('');
    });

    it('preserves input fields by default', () => {
      document.getElementById('send-to').value = '0xabc';
      document.getElementById('send-amount').value = '1.0';
      SendFlow.resetSendFlowUI();
      expect(document.getElementById('send-to').value).toBe('0xabc');
      expect(document.getElementById('send-amount').value).toBe('1.0');
    });
  });
});
