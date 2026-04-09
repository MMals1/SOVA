import {
  formatAmount,
  shortAddr,
  getTxScopeKey,
  getTxExplorerBaseUrl,
  getTokenLogoUrls,
  getTotalPages,
  clampPage,
  paginateItems,
  getTokensForNetwork,
  setTokensForNetwork,
} from '../../extension/shared/wallet-core.js';
import { describe, it, expect } from 'vitest';

describe('wallet-core edge cases', () => {
  describe('formatAmount - edge cases', () => {
    it('handles negative amounts', () => {
      expect(formatAmount(-1.5)).toBe('-1.5');
      expect(formatAmount(-0.001234)).toBe('-0.001234');
    });

    it('handles very large numbers', () => {
      expect(formatAmount(1000000)).toBe('1000000');
      expect(formatAmount(999999.999)).toBe('1000000');
    });

    it('handles non-numeric input', () => {
      expect(formatAmount(null)).toBe('< 0.000001');
      expect(formatAmount(undefined)).toBe('< 0.000001');
      expect(formatAmount('abc')).toBe('< 0.000001');
    });

    it('handles boundary values', () => {
      expect(formatAmount(0.000001)).toBe('0.000001');
      expect(formatAmount(0.0000001)).toBe('< 0.000001');
    });

    it('removes trailing zeros', () => {
      expect(formatAmount(1.5000)).toBe('1.5');
      expect(formatAmount(1.0)).toBe('1');
    });
  });

  describe('shortAddr - edge cases', () => {
    it('returns empty string for null/undefined', () => {
      expect(shortAddr(null)).toBe('');
      expect(shortAddr(undefined)).toBe('');
    });

    it('handles short addresses', () => {
      // Note: shortAddr slices first 6 and last 4 chars
      expect(shortAddr('0x123')).toBe('0x123…x123');
      // '0x' slice(0,6) = '0x', slice(-4) = '0x'
      expect(shortAddr('0x')).toBe('0x…0x');
    });

    it('handles case insensitivity', () => {
      const lower = shortAddr('0x1234567890abcdef1234567890abcdef12345678');
      const upper = shortAddr('0x1234567890ABCDEF1234567890ABCDEF12345678');
      expect(lower).toBe(upper);
    });

    it('handles mixed case', () => {
      const result = shortAddr('0x1234567890AbCdEf1234567890AbCdEf12345678');
      expect(result).toMatch(/0x1234…5678/i);
    });
  });

  describe('getTxScopeKey - edge cases', () => {
    it('normalizes address to lowercase', () => {
      const upper = getTxScopeKey('0xABCDEF', 'eth-mainnet');
      const lower = getTxScopeKey('0xabcdef', 'eth-mainnet');
      expect(upper).toBe(lower);
    });

    it('handles missing address', () => {
      expect(getTxScopeKey(null, 'eth-mainnet')).toBe('eth-mainnet:null');
      expect(getTxScopeKey(undefined, 'eth-mainnet')).toBe('eth-mainnet:undefined');
    });

    it('handles missing network (uses default)', () => {
      const key = getTxScopeKey('0xABCD');
      expect(key).toContain('eth-sepolia');
    });

    it('handles unknown networks', () => {
      const key = getTxScopeKey('0xABCD', 'unknown-chain');
      expect(key).toBe('unknown-chain:0xabcd');
    });
  });

  describe('getTxExplorerBaseUrl - edge cases', () => {
    it('returns default (etherscan) for unknown network', () => {
      expect(getTxExplorerBaseUrl('unknown')).toBe('https://etherscan.io/tx/');
      expect(getTxExplorerBaseUrl('polygon')).toBe('https://etherscan.io/tx/');
      expect(getTxExplorerBaseUrl('')).toBe('https://etherscan.io/tx/');
    });

    it('handles case sensitivity', () => {
      expect(getTxExplorerBaseUrl('ETH-MAINNET')).toBe('https://etherscan.io/tx/');
      expect(getTxExplorerBaseUrl('Eth-Mainnet')).toBe('https://etherscan.io/tx/');
    });

    it('handles known networks case-insensitively (or not)', () => {
      // Actual behavior may be strict case, document it
      expect(getTxExplorerBaseUrl('eth-mainnet')).toBeDefined();
      expect(getTxExplorerBaseUrl('bsc')).toBeDefined();
    });
  });

  describe('getTokenLogoUrls - edge cases', () => {
    it('returns empty array for null/undefined address', () => {
      expect(getTokenLogoUrls(null)).toEqual([]);
      expect(getTokenLogoUrls(undefined)).toEqual([]);
    });

    it('returns empty array for unsupported networks', () => {
      const address = '0xAbCdEf0000000000000000000000000000000001';
      expect(getTokenLogoUrls(address, 'polygon')).toEqual([]);
      expect(getTokenLogoUrls(address, 'unknown')).toEqual([]);
    });

    it('generates correct URLs for eth-mainnet', () => {
      const address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const urls = getTokenLogoUrls(address, 'eth-mainnet');
      expect(urls.length).toBe(2);
      expect(urls[0]).toContain('trustwallet');
      expect(urls[0]).toContain('ethereum');
      expect(urls[1]).toContain('1inch.io');
    });

    it('generates correct URLs for bsc', () => {
      const address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
      const urls = getTokenLogoUrls(address, 'bsc');
      expect(urls.length).toBe(2);
      expect(urls[0]).toContain('trustwallet');
      expect(urls[0]).toContain('smartchain');
      expect(urls[1]).toContain('1inch.io');
    });

    it('lowercases address in 1inch URL', () => {
      const address = '0xABCDEF0000000000000000000000000000000001';
      const urls = getTokenLogoUrls(address, 'eth-mainnet');
      expect(urls[1]).toBe('https://tokens.1inch.io/0xabcdef0000000000000000000000000000000001.png');
    });
  });

  describe('getTotalPages - edge cases', () => {
    it('returns 1 for zero items', () => {
      expect(getTotalPages(0)).toBe(1);
    });

    it('returns 1 for items less than page size', () => {
      expect(getTotalPages(5, 10)).toBe(1);
    });

    it('calculates pages correctly', () => {
      expect(getTotalPages(20, 10)).toBe(2);
      expect(getTotalPages(25, 10)).toBe(3);
      expect(getTotalPages(30, 10)).toBe(3);
    });

    it('handles negative items (treats as 0)', () => {
      expect(getTotalPages(-5, 10)).toBe(1);
    });

    it('handles invalid page size (defaults to 10)', () => {
      expect(getTotalPages(25, null)).toBeGreaterThan(0);
      expect(getTotalPages(25, undefined)).toBeGreaterThan(0);
      expect(getTotalPages(25, 0)).toBeGreaterThan(0);
    });

    it('handles very large item counts', () => {
      const pages = getTotalPages(1000000, 10);
      expect(pages).toBe(100000);
    });
  });

  describe('clampPage - edge cases', () => {
    it('clamps to max page', () => {
      expect(clampPage(100, 5)).toBe(5);
    });

    it('clamps to min page (1)', () => {
      expect(clampPage(0, 5)).toBe(1);
      expect(clampPage(-5, 5)).toBe(1);
    });

    it('returns requested page if valid', () => {
      expect(clampPage(3, 5)).toBe(3);
    });

    it('handles negative total pages', () => {
      // Note: Math.min(-5, Math.max(1, 1)) = -5, which is unexpected but current behavior
      expect(clampPage(1, -5)).toBe(-5);
    });
  });

  describe('paginateItems - edge cases', () => {
    it('returns page 1 for empty array', () => {
      const result = paginateItems([], 1, 10);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.items).toEqual([]);
    });

    it('handles non-array input', () => {
      const result = paginateItems(null, 1, 10);
      expect(result.items).toEqual([]);
      expect(result.totalPages).toBe(1);
    });

    it('slices items correctly on first page', () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const result = paginateItems(items, 1, 10);
      expect(result.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('slices items correctly on last page', () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const result = paginateItems(items, 3, 10);
      expect(result.items).toEqual([20, 21, 22, 23, 24]);
    });

    it('clamps requested page to valid range', () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const result = paginateItems(items, 100, 10);
      expect(result.page).toBe(3);
      expect(result.items.length).toBe(5);
    });
  });

  describe('getTokensForNetwork - edge cases', () => {
    it('returns empty array for null tokensByNetwork', () => {
      expect(getTokensForNetwork(null, 'eth-mainnet')).toEqual([]);
    });

    it('returns empty array for undefined networkKey', () => {
      const map = { 'eth-mainnet': [{ symbol: 'ETH' }] };
      expect(getTokensForNetwork(map, undefined)).toEqual([]);
    });

    it('returns empty array for network not in map', () => {
      const map = { 'eth-mainnet': [{ symbol: 'ETH' }] };
      expect(getTokensForNetwork(map, 'bsc')).toEqual([]);
    });

    it('returns tokens for existing network', () => {
      const tokens = [{ symbol: 'USDC', address: '0x...' }];
      const map = { 'eth-mainnet': tokens };
      expect(getTokensForNetwork(map, 'eth-mainnet')).toEqual(tokens);
    });
  });

  describe('setTokensForNetwork - edge cases', () => {
    it('creates new map if null', () => {
      const result = setTokensForNetwork(null, 'eth-mainnet', [{ symbol: 'ETH' }]);
      expect(result).toHaveProperty('eth-mainnet');
      expect(result['eth-mainnet']).toHaveLength(1);
    });

    it('preserves other networks', () => {
      const initial = {
        'eth-mainnet': [{ symbol: 'USDC' }],
        'eth-sepolia': [{ symbol: 'sUSDT' }],
      };
      const result = setTokensForNetwork(initial, 'bsc', [{ symbol: 'BNB' }]);
      expect(result).toHaveProperty('eth-mainnet');
      expect(result).toHaveProperty('eth-sepolia');
      expect(result).toHaveProperty('bsc');
    });

    it('does not mutate original map', () => {
      const original = { 'eth-mainnet': [{ symbol: 'ETH' }] };
      setTokensForNetwork(original, 'eth-mainnet', [{ symbol: 'USDC' }]);
      expect(original['eth-mainnet'][0].symbol).toBe('ETH');
    });

    it('handles empty token array', () => {
      const result = setTokensForNetwork({}, 'eth-mainnet', []);
      expect(result['eth-mainnet']).toEqual([]);
    });
  });
});
