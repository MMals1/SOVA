// ═══════════════════════════════════════════════════════════════════════════
// networks.ts — Network configuration for SOVA Wallet
// Defines supported chains, their metadata, and RPC defaults.
// ═══════════════════════════════════════════════════════════════════════════

/** Configuration for a single supported blockchain network. */
export interface NetworkConfig {
  /** Chain family identifier, e.g. 'ethereum', 'bsc'. */
  chain: string;
  /** EIP-155 chain ID (1 = Ethereum Mainnet, 11155111 = Sepolia, 56 = BSC). */
  chainId: number;
  /** Human-readable network name. */
  label: string;
  /** Short badge text shown in the UI. */
  badge: string;
  /** Whether this is a testnet. */
  isTestnet: boolean;
  /** Default public RPC endpoint URL. */
  defaultRpcUrl: string;
}

/** Map of network key (e.g. 'eth-mainnet') to its configuration. */
export interface NetworkMap {
  [key: string]: NetworkConfig;
}

/** Map of network key to user-overridden RPC URL. */
export interface RpcDefaults {
  [key: string]: string;
}

export const DEFAULT_NETWORK_KEY = 'eth-sepolia';
export const DEFAULT_CHAIN_KEY = 'ethereum';

export const BASE_NETWORKS: Readonly<NetworkMap> = {
  'eth-mainnet': {
    chain: 'ethereum',
    chainId: 1,
    label: 'Ethereum Mainnet',
    badge: 'Ethereum Mainnet',
    isTestnet: false,
    defaultRpcUrl: 'https://ethereum-rpc.publicnode.com',
  },
  'eth-sepolia': {
    chain: 'ethereum',
    chainId: 11155111,
    label: 'Ethereum Sepolia',
    badge: 'Sepolia testnet',
    isTestnet: true,
    defaultRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  bsc: {
    chain: 'bsc',
    chainId: 56,
    label: 'BNB Chain',
    badge: 'BNB Chain Mainnet',
    isTestnet: false,
    defaultRpcUrl: 'https://bsc-rpc.publicnode.com',
  },
};

/**
 * Build a full network config map, optionally overriding default RPC URLs.
 * @param rpcDefaults - User-configured RPC URL overrides per network key.
 * @returns Complete {@link NetworkMap} with defaults merged.
 */
export function getNetworkConfigs(rpcDefaults: RpcDefaults = {}): NetworkMap {
  const defaults = rpcDefaults && typeof rpcDefaults === 'object' ? rpcDefaults : {};
  const out: NetworkMap = {};
  Object.entries(BASE_NETWORKS).forEach(([key, cfg]) => {
    out[key] = {
      ...cfg,
      defaultRpcUrl: defaults[key] || cfg.defaultRpcUrl,
    };
  });
  return out;
}

// ── API object (for globalThis / module.exports compat) ─────────────────
export const WolfWalletNetworks = {
  BASE_NETWORKS,
  DEFAULT_CHAIN_KEY,
  DEFAULT_NETWORK_KEY,
  getNetworkConfigs,
};

declare const globalThis: Record<string, unknown>;
declare const module: { exports: unknown };

if (typeof globalThis !== 'undefined') {
  globalThis.WolfWalletNetworks = WolfWalletNetworks;
}
if (typeof module === 'object' && module.exports) {
  module.exports = WolfWalletNetworks;
}
