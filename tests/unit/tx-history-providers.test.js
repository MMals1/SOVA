// ── SOVA Wallet: tx-history-providers.js unit tests ─────────────────────
// Тестирует multi-provider резолвер и нормализацию raw responses в unified
// Transfer формат. Исходный модуль загружается через fs + Function()
// потому что он IIFE + globalThis (не CommonJS/ESM).

import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let Providers;

beforeAll(() => {
  // Мок ethers глобально — модуль использует ethers.formatEther / formatUnits
  globalThis.ethers = {
    formatEther: (wei) => {
      const n = BigInt(String(wei || '0'));
      const whole = n / 10n ** 18n;
      const frac = n % 10n ** 18n;
      if (frac === 0n) return whole.toString();
      const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '');
      return `${whole}.${fracStr}`;
    },
    formatUnits: (raw, decimals) => {
      const d = BigInt(Number(decimals) || 0);
      const n = BigInt(String(raw || '0'));
      const base = 10n ** d;
      const whole = n / base;
      const frac = n % base;
      if (frac === 0n) return whole.toString();
      const fracStr = frac.toString().padStart(Number(d), '0').replace(/0+$/, '');
      return `${whole}.${fracStr}`;
    },
  };

  let src = fs.readFileSync(
    path.resolve(__dirname, '../../extension/popup/modules/tx-history-providers.js'),
    'utf8',
  );
  // Strip ES module syntax so new Function() can parse it
  src = src.replace(/^export\s+/gm, '');
  // eslint-disable-next-line no-new-func
  new Function(src)();
  Providers = globalThis.WolfPopupTxHistoryProviders;
});

// ── URL helpers ─────────────────────────────────────────────────────────

describe('isAlchemyUrl', () => {
  it('detects alchemy.com subdomains', () => {
    expect(Providers.isAlchemyUrl('https://eth-mainnet.g.alchemy.com/v2/KEY')).toBe(true);
    expect(Providers.isAlchemyUrl('https://eth-sepolia.g.alchemy.com/v2/KEY')).toBe(true);
    expect(Providers.isAlchemyUrl('https://bnb-mainnet.g.alchemy.com/v2/KEY')).toBe(true);
  });

  it('rejects non-alchemy hosts', () => {
    expect(Providers.isAlchemyUrl('https://ethereum-rpc.publicnode.com')).toBe(false);
    expect(Providers.isAlchemyUrl('https://mainnet.infura.io/v3/KEY')).toBe(false);
    expect(Providers.isAlchemyUrl('https://eth.blockscout.com/api')).toBe(false);
    expect(Providers.isAlchemyUrl('https://api.etherscan.io/v2/api')).toBe(false);
  });

  it('handles invalid input safely', () => {
    expect(Providers.isAlchemyUrl('')).toBe(false);
    expect(Providers.isAlchemyUrl(null)).toBe(false);
    expect(Providers.isAlchemyUrl('not-a-url')).toBe(false);
  });

  it('rejects malicious look-alike domains', () => {
    // hostname.endsWith('.alchemy.com') отсекает evil-alchemy.com
    expect(Providers.isAlchemyUrl('https://evil-alchemy.com/api')).toBe(false);
    expect(Providers.isAlchemyUrl('https://alchemy.com.attacker.io/')).toBe(false);
  });
});

describe('isBlockscoutSupported', () => {
  it('returns true for ETH mainnet and Sepolia', () => {
    expect(Providers.isBlockscoutSupported('eth-mainnet')).toBe(true);
    expect(Providers.isBlockscoutSupported('eth-sepolia')).toBe(true);
  });

  it('returns false for BSC (no public Blockscout instance)', () => {
    expect(Providers.isBlockscoutSupported('bsc')).toBe(false);
  });

  it('returns false for unknown networks', () => {
    expect(Providers.isBlockscoutSupported('polygon')).toBe(false);
    expect(Providers.isBlockscoutSupported('')).toBe(false);
  });
});

describe('getNativeAssetForNetwork', () => {
  it('returns ETH for Ethereum networks', () => {
    expect(Providers.getNativeAssetForNetwork('eth-mainnet')).toBe('ETH');
    expect(Providers.getNativeAssetForNetwork('eth-sepolia')).toBe('ETH');
  });

  it('returns BNB for BSC', () => {
    expect(Providers.getNativeAssetForNetwork('bsc')).toBe('BNB');
  });

  it('defaults to ETH for unknown networks', () => {
    expect(Providers.getNativeAssetForNetwork('foo')).toBe('ETH');
  });
});

// ── Normalization: Alchemy format ───────────────────────────────────────

describe('normalizeAlchemyTransfer', () => {
  it('normalizes a typical Alchemy response entry', () => {
    const raw = {
      blockNum: '0x8b4b8d',
      hash: '0xabc123',
      from: '0xFROM',
      to: '0xTO',
      value: 0.0078,
      asset: 'ETH',
      category: 'external',
      metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
    };
    const out = Providers.normalizeAlchemyTransfer(raw);
    expect(out).toEqual({
      hash: '0xabc123',
      from: '0xFROM',
      to: '0xTO',
      value: '0.0078',
      asset: 'ETH',
      blockNum: '0x8b4b8d',
      category: 'external',
      metadata: { blockTimestamp: '2024-01-01T00:00:00Z' },
    });
  });

  it('coerces category to "erc20" or "external"', () => {
    const erc20 = Providers.normalizeAlchemyTransfer({
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: 1,
      asset: 'USDC',
      blockNum: '0x1',
      category: 'erc20',
    });
    expect(erc20.category).toBe('erc20');

    const internal = Providers.normalizeAlchemyTransfer({
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: 1,
      asset: 'ETH',
      blockNum: '0x1',
      category: 'internal',
    });
    // Unknown category falls back to external
    expect(internal.category).toBe('external');
  });

  it('returns null when hash is missing', () => {
    expect(Providers.normalizeAlchemyTransfer(null)).toBe(null);
    expect(Providers.normalizeAlchemyTransfer({ from: 'a' })).toBe(null);
  });

  it('handles missing metadata', () => {
    const out = Providers.normalizeAlchemyTransfer({
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: 0,
      asset: 'ETH',
      blockNum: '0x1',
      category: 'external',
    });
    expect(out.metadata).toBe(null);
  });

  it('stringifies numeric values', () => {
    const out = Providers.normalizeAlchemyTransfer({
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: 1.5,
      asset: 'ETH',
      blockNum: '0x1',
      category: 'external',
    });
    expect(out.value).toBe('1.5');
    expect(typeof out.value).toBe('string');
  });
});

// ── Normalization: Etherscan/Blockscout native (txlist) ─────────────────

describe('normalizeNativeTxlistRow', () => {
  it('converts wei to ether string', () => {
    const raw = {
      blockNumber: '12345',
      timeStamp: '1704067200', // 2024-01-01T00:00:00Z
      hash: '0xdef456',
      from: '0xFROM',
      to: '0xTO',
      value: '1000000000000000000', // 1 ETH in wei
      isError: '0',
      txreceipt_status: '1',
    };
    const out = Providers.normalizeNativeTxlistRow(raw, 'ETH');
    expect(out.value).toBe('1');
    expect(out.asset).toBe('ETH');
    expect(out.category).toBe('external');
    expect(out.hash).toBe('0xdef456');
    expect(out.blockNum).toBe('0x3039'); // 12345 в hex
  });

  it('converts to hex blockNum', () => {
    const raw = {
      blockNumber: '255',
      timeStamp: '1700000000',
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: '0',
      isError: '0',
    };
    const out = Providers.normalizeNativeTxlistRow(raw, 'ETH');
    expect(out.blockNum).toBe('0xff');
  });

  it('zeroes out failed transactions', () => {
    const raw = {
      blockNumber: '100',
      timeStamp: '1700000000',
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: '1000000000000000000',
      isError: '1', // failed
    };
    const out = Providers.normalizeNativeTxlistRow(raw, 'ETH');
    expect(out.value).toBe('0');
  });

  it('uses BNB as asset for BSC', () => {
    const raw = {
      blockNumber: '100',
      timeStamp: '1700000000',
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: '0',
      isError: '0',
    };
    const out = Providers.normalizeNativeTxlistRow(raw, 'BNB');
    expect(out.asset).toBe('BNB');
  });

  it('produces ISO timestamp from seconds', () => {
    const raw = {
      blockNumber: '1',
      timeStamp: '1704067200',
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: '0',
      isError: '0',
    };
    const out = Providers.normalizeNativeTxlistRow(raw, 'ETH');
    expect(out.metadata).toEqual({ blockTimestamp: '2024-01-01T00:00:00.000Z' });
  });

  it('returns null when hash missing', () => {
    expect(Providers.normalizeNativeTxlistRow({ from: 'a' }, 'ETH')).toBe(null);
    expect(Providers.normalizeNativeTxlistRow(null, 'ETH')).toBe(null);
  });
});

// ── Normalization: Etherscan/Blockscout tokentx (ERC-20) ────────────────

describe('normalizeTokenTxlistRow', () => {
  it('converts token raw to human using tokenDecimal', () => {
    const raw = {
      blockNumber: '100',
      timeStamp: '1704067200',
      hash: '0xtoken1',
      from: '0xFROM',
      to: '0xTO',
      value: '123000000', // 123 USDC (6 decimals)
      tokenSymbol: 'USDC',
      tokenDecimal: '6',
      contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    };
    const out = Providers.normalizeTokenTxlistRow(raw);
    expect(out.value).toBe('123');
    expect(out.asset).toBe('USDC');
    expect(out.category).toBe('erc20');
  });

  it('handles 18-decimal tokens (WETH/ERC20)', () => {
    const raw = {
      blockNumber: '1',
      timeStamp: '1700000000',
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: '5000000000000000000', // 5 tokens
      tokenSymbol: 'DAI',
      tokenDecimal: '18',
    };
    const out = Providers.normalizeTokenTxlistRow(raw);
    expect(out.value).toBe('5');
    expect(out.asset).toBe('DAI');
  });

  it('defaults tokenDecimal to 18 if missing', () => {
    const raw = {
      blockNumber: '1',
      timeStamp: '1700000000',
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: '1000000000000000000',
      tokenSymbol: 'X',
    };
    const out = Providers.normalizeTokenTxlistRow(raw);
    expect(out.value).toBe('1');
  });

  it('falls back asset to "TOKEN" if symbol missing', () => {
    const raw = {
      blockNumber: '1',
      timeStamp: '1700000000',
      hash: '0x1',
      from: 'a',
      to: 'b',
      value: '0',
      tokenDecimal: '18',
    };
    const out = Providers.normalizeTokenTxlistRow(raw);
    expect(out.asset).toBe('TOKEN');
  });
});

// ── Resolver priority ───────────────────────────────────────────────────

describe('resolveProvider', () => {
  it('priority 1: returns Alchemy when RPC URL is alchemy.com', () => {
    const p = Providers.resolveProvider({
      networkKey: 'eth-mainnet',
      rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/KEY',
      etherscanKey: '',
    });
    expect(p).toBeTruthy();
    expect(p.type).toBe('alchemy');
    expect(typeof p.fetchAll).toBe('function');
  });

  it('priority 1 applies even when etherscan key is present (Alchemy wins)', () => {
    const p = Providers.resolveProvider({
      networkKey: 'eth-mainnet',
      rpcUrl: 'https://eth-mainnet.g.alchemy.com/v2/KEY',
      etherscanKey: 'ABCDEF123456',
    });
    expect(p.type).toBe('alchemy');
  });

  it('priority 2: returns Etherscan V2 when user has a key (non-Alchemy RPC)', () => {
    const p = Providers.resolveProvider({
      networkKey: 'eth-mainnet',
      rpcUrl: 'https://ethereum-rpc.publicnode.com',
      etherscanKey: 'ABCDEF123456',
    });
    expect(p).toBeTruthy();
    expect(p.type).toBe('etherscan');
  });

  it('priority 3: returns Blockscout for ETH mainnet when no key', () => {
    const p = Providers.resolveProvider({
      networkKey: 'eth-mainnet',
      rpcUrl: 'https://ethereum-rpc.publicnode.com',
      etherscanKey: '',
    });
    expect(p).toBeTruthy();
    expect(p.type).toBe('blockscout');
  });

  it('priority 3: returns Blockscout for Sepolia when no key', () => {
    const p = Providers.resolveProvider({
      networkKey: 'eth-sepolia',
      rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
      etherscanKey: '',
    });
    expect(p).toBeTruthy();
    expect(p.type).toBe('blockscout');
  });

  it('priority 4: returns null for BSC when no key (no public Blockscout)', () => {
    const p = Providers.resolveProvider({
      networkKey: 'bsc',
      rpcUrl: 'https://bsc-rpc.publicnode.com',
      etherscanKey: '',
    });
    expect(p).toBe(null);
  });

  it('priority 2 overrides Blockscout for BSC when key is provided', () => {
    const p = Providers.resolveProvider({
      networkKey: 'bsc',
      rpcUrl: 'https://bsc-rpc.publicnode.com',
      etherscanKey: 'ABCDEF123456',
    });
    expect(p).toBeTruthy();
    expect(p.type).toBe('etherscan');
  });
});

// ── No-provider reason messages ─────────────────────────────────────────

describe('getNoProviderReason', () => {
  it('returns a non-empty message for any network', () => {
    const msg = Providers.getNoProviderReason('bsc');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('produces a fallback message for unknown networks', () => {
    const msg = Providers.getNoProviderReason('unknown');
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });
});

// ── Integration: fetch providers use correct endpoints ─────────────────

describe('fetch* functions URL structure', () => {
  let fetchSpy;

  beforeAll(() => {
    fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: '1', message: 'OK', result: [] }),
    }));
    globalThis.fetch = fetchSpy;
  });

  it('fetchBlockscoutTransfers calls eth.blockscout.com for mainnet', async () => {
    fetchSpy.mockClear();
    await Providers.fetchBlockscoutTransfers('eth-mainnet', '0xAddr');
    expect(fetchSpy).toHaveBeenCalledTimes(2); // txlist + tokentx
    const calls = fetchSpy.mock.calls.map(([url]) => url);
    expect(calls.every((u) => u.startsWith('https://eth.blockscout.com/api'))).toBe(true);
    expect(calls.some((u) => u.includes('action=txlist'))).toBe(true);
    expect(calls.some((u) => u.includes('action=tokentx'))).toBe(true);
  });

  it('fetchBlockscoutTransfers calls eth-sepolia.blockscout.com for Sepolia', async () => {
    fetchSpy.mockClear();
    await Providers.fetchBlockscoutTransfers('eth-sepolia', '0xAddr');
    const calls = fetchSpy.mock.calls.map(([url]) => url);
    expect(calls.every((u) => u.startsWith('https://eth-sepolia.blockscout.com/api'))).toBe(true);
  });

  it('fetchBlockscoutTransfers throws for BSC (not supported)', async () => {
    fetchSpy.mockClear();
    await expect(Providers.fetchBlockscoutTransfers('bsc', '0xAddr')).rejects.toThrow(/bsc/i);
  });

  it('fetchEtherscanV2Transfers includes chainid and apikey', async () => {
    fetchSpy.mockClear();
    await Providers.fetchEtherscanV2Transfers('bsc', '0xAddr', 'MYKEY');
    const calls = fetchSpy.mock.calls.map(([url]) => url);
    expect(calls.every((u) => u.startsWith('https://api.etherscan.io/v2/api'))).toBe(true);
    expect(calls.every((u) => u.includes('chainid=56'))).toBe(true);
    expect(calls.every((u) => u.includes('apikey=MYKEY'))).toBe(true);
  });

  it('fetchEtherscanV2Transfers uses chainid=1 for ETH mainnet', async () => {
    fetchSpy.mockClear();
    await Providers.fetchEtherscanV2Transfers('eth-mainnet', '0xAddr', 'KEY');
    const calls = fetchSpy.mock.calls.map(([url]) => url);
    expect(calls.every((u) => u.includes('chainid=1&') || u.endsWith('chainid=1'))).toBe(true);
  });

  it('fetchEtherscanV2Transfers uses chainid=11155111 for Sepolia', async () => {
    fetchSpy.mockClear();
    await Providers.fetchEtherscanV2Transfers('eth-sepolia', '0xAddr', 'KEY');
    const calls = fetchSpy.mock.calls.map(([url]) => url);
    expect(calls.every((u) => u.includes('chainid=11155111'))).toBe(true);
  });

  it('fetchEtherscanV2Transfers throws without API key', async () => {
    await expect(Providers.fetchEtherscanV2Transfers('bsc', '0xAddr', '')).rejects.toThrow(
      /api key/i,
    );
  });

  it('fetchAlchemyTransfers returns empty result for non-alchemy URL', async () => {
    const res = await Providers.fetchAlchemyTransfers('https://publicnode.com', '0xAddr', 'from');
    expect(res).toEqual({ result: { transfers: [] } });
  });
});

// ── Error resilience: empty responses ──────────────────────────────────

describe('Etherscan-like response handling', () => {
  it('treats "No transactions found" as empty array (not error)', async () => {
    const emptyFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: '0', message: 'No transactions found', result: [] }),
    }));
    globalThis.fetch = emptyFetch;
    const result = await Providers.fetchBlockscoutTransfers('eth-mainnet', '0xAddr');
    expect(result).toEqual([]);
  });
});
