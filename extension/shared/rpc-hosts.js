(function initRpcHosts(root) {
  'use strict';

  // ── Whitelist of allowed RPC hosts ─────────────────────────────────────
  // Пользователь может ввести custom RPC URL через popup setup screen.
  // Мы валидируем что host принадлежит одному из известных провайдеров
  // из этого списка. Любой другой домен отклоняется.
  //
  // ВАЖНО: этот список должен совпадать с connect-src CSP в manifest.json
  // и с host_permissions. Если добавляете нового провайдера — обновляйте
  // все три места.
  //
  // Формат: либо полный hostname (`eth-mainnet.g.alchemy.com`),
  // либо суффикс начинающийся с точки (`.infura.io` → matches `mainnet.infura.io`).

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
    return ALLOWED_RPC_HOSTS.some(h => hostname === h || hostname.endsWith(h));
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

  const api = Object.freeze({
    ALLOWED_RPC_HOSTS,
    isAllowedRpcHost,
    isAllowedRpcUrl,
  });

  root.WolfWalletRpcHosts = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
