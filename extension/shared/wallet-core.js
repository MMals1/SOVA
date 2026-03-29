(function initWalletCore(root, factory) {
  const api = factory();
  root.WolfWalletCore = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  function formatAmount(value) {
    if (value === 0) return '0';
    const abs = Math.abs(value);
    let str;
    if (abs >= 1000) str = value.toFixed(2);
    else if (abs >= 1) str = value.toFixed(4);
    else if (abs >= 0.000001) str = value.toFixed(6);
    else return '< 0.000001';
    return str.replace(/\.?0+$/, '');
  }

  function shortAddr(addr) {
    return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
  }

  function getTxScopeKey(address, networkKey = 'eth-sepolia') {
    return `${networkKey}:${String(address).toLowerCase()}`;
  }

  function getTxExplorerBaseUrl(networkKey = 'eth-sepolia') {
    if (networkKey === 'eth-mainnet') return 'https://etherscan.io/tx/';
    if (networkKey === 'eth-sepolia') return 'https://sepolia.etherscan.io/tx/';
    return 'https://etherscan.io/tx/';
  }

  function getTotalPages(totalItems, pageSize = 10) {
    return Math.max(1, Math.ceil(Math.max(0, totalItems) / pageSize));
  }

  function clampPage(requestedPage, totalPages) {
    return Math.min(totalPages, Math.max(1, requestedPage));
  }

  function paginateItems(items, currentPage, pageSize = 10) {
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

  function isSameAddress(left, right) {
    if (!left || !right) return false;
    return String(left).toLowerCase() === String(right).toLowerCase();
  }

  return {
    clampPage,
    formatAmount,
    getTotalPages,
    getTxExplorerBaseUrl,
    getTxScopeKey,
    isSameAddress,
    paginateItems,
    shortAddr,
  };
});
