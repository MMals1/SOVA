'use strict';
(() => {
  const ALLOWED_RPC_HOSTS = Object.freeze([
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
  function isAllowedRpcHost(hostname) {
    if (!hostname || typeof hostname !== 'string') return false;
    return ALLOWED_RPC_HOSTS.some((h) => hostname === h || hostname.endsWith(h));
  }
  function isAllowedRpcUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (!url.startsWith('https://')) return false;
    try {
      const hostname = new URL(url).hostname;
      return isAllowedRpcHost(hostname);
    } catch {
      return false;
    }
  }
  const WolfWalletRpcHosts = Object.freeze({
    ALLOWED_RPC_HOSTS,
    isAllowedRpcHost,
    isAllowedRpcUrl,
  });
  if (typeof globalThis !== 'undefined') {
    globalThis.WolfWalletRpcHosts = WolfWalletRpcHosts;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = WolfWalletRpcHosts;
  }
})();
