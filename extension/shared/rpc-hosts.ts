// ═══════════════════════════════════════════════════════════════════════════
// rpc-hosts.ts — RPC host whitelist for SOVA Wallet
// Validates user-provided RPC URLs against known providers.
// ═══════════════════════════════════════════════════════════════════════════

/** Trusted RPC host suffixes (and exact matches) for URL validation. */
export const ALLOWED_RPC_HOSTS: readonly string[] = Object.freeze([
  'eth-mainnet.g.alchemy.com',
  'eth-sepolia.g.alchemy.com',
  '.g.alchemy.com',
  '.infura.io',
  '.quiknode.pro',
  '.publicnode.com',
  '.drpc.org',
  '.llamarpc.com',
  '.ankr.com',
  '.chainstack.com',
  '.1rpc.io',
]);

/**
 * Check if a hostname matches the RPC host whitelist.
 * @param hostname - Bare hostname (no protocol or path).
 */
export function isAllowedRpcHost(hostname: string | null | undefined): boolean {
  if (!hostname || typeof hostname !== 'string') return false;
  return ALLOWED_RPC_HOSTS.some((h) => hostname === h || hostname.endsWith(h));
}

/**
 * Validate a full URL: must be HTTPS with a whitelisted RPC host.
 * @param url - Complete URL string (e.g. 'https://eth-sepolia.g.alchemy.com/v2/KEY').
 */
export function isAllowedRpcUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  try {
    const hostname = new URL(url).hostname;
    return isAllowedRpcHost(hostname);
  } catch {
    return false;
  }
}

// ── API object (for globalThis / module.exports compat) ─────────────────
export const WolfWalletRpcHosts = Object.freeze({
  ALLOWED_RPC_HOSTS,
  isAllowedRpcHost,
  isAllowedRpcUrl,
});

declare const globalThis: Record<string, unknown>;
declare const module: { exports: unknown };

if (typeof globalThis !== 'undefined') {
  globalThis.WolfWalletRpcHosts = WolfWalletRpcHosts;
}
if (typeof module === 'object' && module.exports) {
  module.exports = WolfWalletRpcHosts;
}
