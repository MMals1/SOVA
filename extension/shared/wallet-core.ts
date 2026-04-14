// ═══════════════════════════════════════════════════════════════════════════
// wallet-core.ts — Shared utility functions for popup & service worker
// Pure functions — no side effects, no DOM, no chrome.* API.
// ═══════════════════════════════════════════════════════════════════════════

/** ERC-20 token descriptor stored per-network. */
export interface TokenInfo {
  /** Checksummed contract address. */
  address: string;
  /** Ticker symbol, e.g. "USDT". */
  symbol: string;
  /** Token decimals (usually 18 or 6). */
  decimals: number;
  /** Human-readable name, e.g. "Tether USD". */
  name?: string;
}

/** Map of network key → token list. */
export interface TokensByNetwork {
  [networkKey: string]: TokenInfo[];
}

/** Result of a paginated list operation. */
export interface PaginationResult<T> {
  /** Current 1-based page number. */
  page: number;
  /** Total number of pages (≥ 1). */
  totalPages: number;
  /** Subset of items for the current page. */
  items: T[];
}

/**
 * Format a numeric amount for display (auto-selects decimal precision).
 * @param value - Amount in native units (e.g. ETH, BNB).
 * @returns Formatted string, e.g. "1.2345" or "< 0.000001".
 */
export function formatAmount(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  let str: string;
  if (abs >= 1000) str = value.toFixed(2);
  else if (abs >= 1) str = value.toFixed(4);
  else if (abs >= 0.000001) str = value.toFixed(6);
  else return '< 0.000001';
  return str.replace(/\.?0+$/, '');
}

/**
 * Truncate an address to "0x1234…abcd" form.
 * @param addr - Full hex address (or null/undefined).
 */
export function shortAddr(addr: string | null | undefined): string {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

/**
 * Build a cache/storage key scoping transactions to address + network.
 * @returns Key in the form `"networkKey:0xlowercase"`.
 */
export function getTxScopeKey(address: string, networkKey = 'eth-sepolia'): string {
  return `${networkKey}:${String(address).toLowerCase()}`;
}

/**
 * Return the block-explorer transaction base URL for a given network.
 * @param networkKey - One of 'eth-mainnet', 'eth-sepolia', 'bsc'.
 */
export function getTxExplorerBaseUrl(networkKey = 'eth-sepolia'): string {
  if (networkKey === 'eth-mainnet') return 'https://etherscan.io/tx/';
  if (networkKey === 'eth-sepolia') return 'https://sepolia.etherscan.io/tx/';
  if (networkKey === 'bsc') return 'https://bscscan.com/tx/';
  return 'https://etherscan.io/tx/';
}

/**
 * Retrieve the token list for a specific network from a TokensByNetwork map.
 * @returns Array of {@link TokenInfo} (empty if none stored).
 */
export function getTokensForNetwork(
  tokensByNetwork: TokensByNetwork | null | undefined,
  networkKey: string,
): TokenInfo[] {
  if (!tokensByNetwork || typeof tokensByNetwork !== 'object') return [];
  const scoped = tokensByNetwork[networkKey];
  return Array.isArray(scoped) ? scoped : [];
}

/**
 * Immutably update the token list for one network inside a TokensByNetwork map.
 * @returns A shallow copy of the map with the updated network entry.
 */
export function setTokensForNetwork(
  tokensByNetwork: TokensByNetwork | null | undefined,
  networkKey: string,
  tokens: TokenInfo[],
): TokensByNetwork {
  const nextMap: TokensByNetwork =
    tokensByNetwork && typeof tokensByNetwork === 'object' ? { ...tokensByNetwork } : {};
  nextMap[networkKey] = Array.isArray(tokens) ? tokens : [];
  return nextMap;
}

/**
 * Generate CDN logo URLs (TrustWallet, 1inch) for an ERC-20 token.
 * @param tokenAddress - Checksummed or lowercase contract address.
 * @param networkKey - Network identifier.
 * @returns Array of image URLs to try (may be empty for unsupported networks).
 */
export function getTokenLogoUrls(tokenAddress: string, networkKey = 'eth-sepolia'): string[] {
  if (!tokenAddress) return [];
  if (!String(networkKey).startsWith('eth-') && networkKey !== 'bsc') return [];
  const normalized = String(tokenAddress);
  const lower = normalized.toLowerCase();
  if (networkKey === 'bsc') {
    return [
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/${normalized}/logo.png`,
      `https://tokens.1inch.io/${lower}.png`,
    ];
  }
  return [
    `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${normalized}/logo.png`,
    `https://tokens.1inch.io/${lower}.png`,
  ];
}

/**
 * Calculate the total number of pages needed (minimum 1).
 * @param totalItems - Total item count.
 * @param pageSize - Items per page (default 10).
 */
export function getTotalPages(totalItems: number, pageSize = 10): number {
  return Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
}

/**
 * Clamp a page number to the valid range [1, totalPages].
 */
export function clampPage(requestedPage: number, totalPages: number): number {
  return Math.min(totalPages, Math.max(1, requestedPage));
}

/**
 * Slice an array into a single page and return pagination metadata.
 * @returns {@link PaginationResult} with clamped page number.
 */
export function paginateItems<T>(
  items: T[],
  currentPage: number,
  pageSize = 10,
): PaginationResult<T> {
  const list = Array.isArray(items) ? items : [];
  const totalPages = getTotalPages(list.length, pageSize);
  const page = clampPage(currentPage, totalPages);
  const startIndex = (page - 1) * pageSize;
  return {
    page,
    totalPages,
    items: list.slice(startIndex, startIndex + pageSize),
  };
}

/**
 * Case-insensitive comparison of two Ethereum addresses.
 * @returns `true` if both are non-empty and equal when lowercased.
 */
export function isSameAddress(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  if (!left || !right) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

// ── API object (for globalThis / module.exports compat) ─────────────────
export const WolfWalletCore = {
  clampPage,
  formatAmount,
  getTokenLogoUrls,
  getTokensForNetwork,
  getTotalPages,
  getTxExplorerBaseUrl,
  getTxScopeKey,
  isSameAddress,
  paginateItems,
  setTokensForNetwork,
  shortAddr,
};

// ── Dual export for SW (importScripts) and CJS (tests) ──────────────────
declare const globalThis: Record<string, unknown>;
declare const module: { exports: unknown };

if (typeof globalThis !== 'undefined') {
  globalThis.WolfWalletCore = WolfWalletCore;
}
if (typeof module === 'object' && module.exports) {
  module.exports = WolfWalletCore;
}
