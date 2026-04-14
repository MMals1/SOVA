'use strict';
(() => {
  const DEFAULT_NETWORK_KEY = 'eth-sepolia';
  const DEFAULT_CHAIN_KEY = 'ethereum';
  const BASE_NETWORKS = {
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
  function getNetworkConfigs(rpcDefaults = {}) {
    const defaults = rpcDefaults && typeof rpcDefaults === 'object' ? rpcDefaults : {};
    const out = {};
    Object.entries(BASE_NETWORKS).forEach(([key, cfg]) => {
      out[key] = {
        ...cfg,
        defaultRpcUrl: defaults[key] || cfg.defaultRpcUrl,
      };
    });
    return out;
  }
  const WolfWalletNetworks = {
    BASE_NETWORKS,
    DEFAULT_CHAIN_KEY,
    DEFAULT_NETWORK_KEY,
    getNetworkConfigs,
  };
  if (typeof globalThis !== 'undefined') {
    globalThis.WolfWalletNetworks = WolfWalletNetworks;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = WolfWalletNetworks;
  }
})();
