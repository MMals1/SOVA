'use strict';

// ── SOVA Wallet — Transaction history orchestrator ─────────────────────
// Coordinates loading, caching, and rendering of transaction history.
// Delegates to WolfPopupTxCache (cache/pagination state),
// WolfPopupTxRender (DOM rendering), and WolfPopupTxHistoryProviders
// (data fetching) via globalThis.

// ── Lazy references to sibling modules ─────────────────────────────────
function _getPopupState() {
  return (
    globalThis.WolfPopupSharedState || {
      provider: null,
      activeAccountIndex: 0,
      selectedChain: 'ethereum',
      selectedNetwork: 'eth-sepolia',
      rpcByNetwork: {},
    }
  );
}

function _getCache() {
  return globalThis.WolfPopupTxCache || {};
}

function _getRender() {
  return globalThis.WolfPopupTxRender || {};
}

function _getProviders() {
  return globalThis.WolfPopupTxHistoryProviders;
}

const _Storage = globalThis.WolfPopupStorage;
const getLocal = _Storage
  ? _Storage.getLocal.bind(_Storage)
  : (keys) => new Promise((r) => chrome.storage.local.get(keys, r));

function _getNetworks() {
  return globalThis.WolfPopupNetworkState?.NETWORKS || {};
}

function _getRpcUrlForNetwork(networkKey, map) {
  const ns = globalThis.WolfPopupNetworkState;
  if (ns) return ns.getRpcUrlForNetwork(networkKey, map);
  return null;
}

async function _getAccounts() {
  if (typeof globalThis.getAccountsCached === 'function') {
    return globalThis.getAccountsCached();
  }
  const { accounts = [] } = await getLocal(['accounts']);
  return Array.isArray(accounts) ? accounts : [];
}

async function _getEtherscanKey() {
  try {
    const { etherscanApiKey } = await getLocal(['etherscanApiKey']);
    return typeof etherscanApiKey === 'string' ? etherscanApiKey.trim() : '';
  } catch {
    return '';
  }
}

// ── Legacy compatibility wrappers ──────────────────────────────────────

// Legacy URL check -- kept for backward compat in module exports.
function _isAlchemyUrl(url) {
  const P = _getProviders();
  if (P && typeof P.isAlchemyUrl === 'function') return P.isAlchemyUrl(url);
  try {
    return new URL(url).hostname.endsWith('.alchemy.com');
  } catch {
    return false;
  }
}

/**
 * Thin compatibility wrapper -- delegates to tx-history-providers.js.
 * @param {string} address
 * @param {'from'|'to'} direction
 * @param {object} [opts]
 * @returns {Promise<{result: {transfers: Array}}>}
 */
async function fetchAlchemyTransfers(address, direction, opts = {}) {
  const P = _getProviders();
  if (!P || typeof P.fetchAlchemyTransfers !== 'function') {
    return { result: { transfers: [] } };
  }
  const PopupState = _getPopupState();
  const NETWORKS = _getNetworks();
  const networkKey = NETWORKS[PopupState.selectedNetwork]
    ? PopupState.selectedNetwork
    : Object.keys(NETWORKS)[0];
  const activeUrl = _getRpcUrlForNetwork(networkKey, PopupState.rpcByNetwork || {});
  return P.fetchAlchemyTransfers(activeUrl, address, direction, opts);
}

// ── Core load orchestrator ─────────────────────────────────────────────

/**
 * Load transaction history for the given address from the best
 * available provider (Alchemy -> Etherscan V2 -> Blockscout).
 * Merges with cached transactions and persists the result.
 * @param {string} address
 * @returns {Promise<void>}
 */
async function loadTransactions(address) {
  const Cache = _getCache();
  const Render = _getRender();
  const PopupState = _getPopupState();

  const getTxScopeKey =
    Cache.getTxScopeKey || ((addr, net) => `${net}:${String(addr).toLowerCase()}`);
  const scopeKey = getTxScopeKey(address);

  if (Cache.hasLoadPromise && Cache.hasLoadPromise(scopeKey)) {
    return Cache.getLoadPromise(scopeKey);
  }

  const TX_HISTORY_LIMIT = Cache.TX_HISTORY_LIMIT || 1000;
  const TX_INITIAL_MAX_COUNT = Cache.TX_INITIAL_MAX_COUNT || '0x3e8';
  const TX_INCREMENTAL_MAX_COUNT = Cache.TX_INCREMENTAL_MAX_COUNT || '0x64';

  const renderTransactions =
    typeof Render.renderTransactionList === 'function' ? Render.renderTransactionList : () => {};
  const setTxRefreshIndicator =
    typeof Render.setTxRefreshIndicator === 'function' ? Render.setTxRefreshIndicator : () => {};
  const renderInlineMessage =
    typeof Render.renderInlineMessage === 'function' ? Render.renderInlineMessage : () => {};

  const run = (async () => {
    const el = document.getElementById('tx-list');
    setTxRefreshIndicator(true);

    const NETWORKS = _getNetworks();
    const nk = NETWORKS[PopupState.selectedNetwork]
      ? PopupState.selectedNetwork
      : Object.keys(NETWORKS)[0];
    const rpcUrl = _getRpcUrlForNetwork(nk, PopupState.rpcByNetwork || {});
    const etherscanKey = await _getEtherscanKey();

    const Providers = _getProviders();
    if (!Providers || typeof Providers.resolveProvider !== 'function') {
      setTxRefreshIndicator(false);
      renderInlineMessage(
        el,
        '\u041c\u043e\u0434\u0443\u043b\u044c \u0438\u0441\u0442\u043e\u0440\u0438\u0438 \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d',
      );
      return;
    }

    const provider = Providers.resolveProvider({
      networkKey: nk,
      rpcUrl,
      etherscanKey,
    });

    if (!provider) {
      setTxRefreshIndicator(false);
      renderInlineMessage(el, Providers.getNoProviderReason(nk));
      return;
    }

    try {
      const syncState =
        typeof Cache.getFullSyncState === 'function' ? await Cache.getFullSyncState() : {};
      const txCacheAll = typeof Cache.getFullCache === 'function' ? await Cache.getFullCache() : {};

      const accountSync = syncState?.[scopeKey] || {};
      const cachedTxs = Array.isArray(txCacheAll?.[scopeKey]) ? txCacheAll[scopeKey] : [];

      const hasCheckpoint =
        Number.isInteger(accountSync.lastProcessedBlock) && accountSync.lastProcessedBlock >= 0;
      const fromBlockHex = hasCheckpoint
        ? `0x${(accountSync.lastProcessedBlock + 1).toString(16)}`
        : '0x0';

      if (cachedTxs.length) {
        renderTransactions(el, address, cachedTxs, PopupState.selectedNetwork);
      } else {
        renderInlineMessage(el, '\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026');
        const p = el.querySelector('.empty');
        if (p) p.style.whiteSpace = '';
      }

      const fetchOpts =
        provider.type === 'alchemy'
          ? {
              fromBlock: fromBlockHex,
              maxCount: hasCheckpoint ? TX_INCREMENTAL_MAX_COUNT : TX_INITIAL_MAX_COUNT,
            }
          : { offset: 200 };

      let fresh = await provider.fetchAll(address, fetchOpts);

      if (provider.type === 'alchemy' && hasCheckpoint && !cachedTxs.length && fresh.length === 0) {
        fresh = await provider.fetchAll(address, {
          fromBlock: '0x0',
          maxCount: TX_INITIAL_MAX_COUNT,
        });
      }

      const freshSeen = new Set();
      fresh = fresh
        .filter((tx) => {
          if (!tx || !tx.hash) return false;
          if (freshSeen.has(tx.hash)) return false;
          freshSeen.add(tx.hash);
          return true;
        })
        .sort((a, b) => (parseInt(b.blockNum, 16) || 0) - (parseInt(a.blockNum, 16) || 0));

      const mergedSeen = new Set();
      const baseForMerge =
        provider.type === 'alchemy' && hasCheckpoint && fresh.length === 0 && cachedTxs.length > 0
          ? cachedTxs
          : [...fresh, ...cachedTxs];
      const merged = baseForMerge
        .filter((tx) => {
          if (mergedSeen.has(tx.hash)) return false;
          mergedSeen.add(tx.hash);
          return true;
        })
        .sort((a, b) => (parseInt(b.blockNum, 16) || 0) - (parseInt(a.blockNum, 16) || 0))
        .slice(0, TX_HISTORY_LIMIT);

      renderTransactions(el, address, merged, PopupState.selectedNetwork);

      const maxMergedBlock = merged.reduce(
        (acc, tx) => Math.max(acc, parseInt(tx.blockNum, 16) || -1),
        -1,
      );
      const nextCheckpoint = Math.max(
        hasCheckpoint ? accountSync.lastProcessedBlock : -1,
        maxMergedBlock,
      );

      const nextSyncState = { ...syncState };
      nextSyncState[scopeKey] = {
        lastProcessedBlock: nextCheckpoint,
        updatedAt: new Date().toISOString(),
        provider: provider.type,
      };

      const nextCache = { ...txCacheAll };
      nextCache[scopeKey] = merged;

      if (typeof Cache.persistSyncAndCache === 'function') {
        await Cache.persistSyncAndCache(nextSyncState, nextCache);
      }
    } catch (e) {
      console.error('[loadTransactions]', e);

      if (provider.type !== 'blockscout' && Providers.isBlockscoutSupported(nk)) {
        try {
          console.info('[loadTransactions] Falling back to Blockscout for', nk);
          const fallbackFresh = await Providers.fetchBlockscoutTransfers(nk, address, {
            offset: 200,
          });
          if (fallbackFresh && fallbackFresh.length > 0) {
            renderTransactions(
              el,
              address,
              fallbackFresh.slice(0, TX_HISTORY_LIMIT),
              PopupState.selectedNetwork,
            );
            if (typeof Cache.setCachedTransactions === 'function') {
              await Cache.setCachedTransactions(scopeKey, fallbackFresh.slice(0, TX_HISTORY_LIMIT));
            }
            return;
          }
        } catch (fallbackErr) {
          console.error('[loadTransactions] Blockscout fallback also failed:', fallbackErr);
        }
      }

      const hasRenderedTx = el.querySelector('.tx');
      if (!hasRenderedTx) {
        renderInlineMessage(
          el,
          `\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0442\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438 (${provider.label})`,
        );
      }
    } finally {
      setTxRefreshIndicator(false);
    }
  })();

  if (typeof Cache.setLoadPromise === 'function') {
    Cache.setLoadPromise(scopeKey, run);
  }
  try {
    await run;
  } finally {
    if (typeof Cache.deleteLoadPromise === 'function') {
      Cache.deleteLoadPromise(scopeKey);
    }
  }
}

// ── Refresh (force reload) ─────────────────────────────────────────────

async function refreshHistory() {
  const PopupState = _getPopupState();
  const accounts = await _getAccounts();
  const address = accounts[PopupState.activeAccountIndex]?.address;
  if (!address) return;

  const Cache = _getCache();
  const getTxScopeKey =
    Cache.getTxScopeKey || ((addr, net) => `${net}:${String(addr).toLowerCase()}`);
  const scopeKey = getTxScopeKey(address);
  if (typeof Cache.invalidateScope === 'function') {
    Cache.invalidateScope(scopeKey);
  }

  await loadTransactions(address);
}

// ── Pagination ─────────────────────────────────────────────────────────

/**
 * Navigate to the next or previous page of transactions.
 * @param {number} delta -- page offset (+1 = next, -1 = previous)
 * @returns {Promise<void>}
 */
async function changeTxPage(delta) {
  if (!delta) return;

  const PopupState = _getPopupState();
  const Cache = _getCache();
  const Render = _getRender();

  const accounts = await _getAccounts();
  const address = accounts[PopupState.activeAccountIndex]?.address;
  if (!address) return;

  const getTxScopeKey =
    Cache.getTxScopeKey || ((addr, net) => `${net}:${String(addr).toLowerCase()}`);
  const TX_PAGE_SIZE = Cache.TX_PAGE_SIZE || 10;
  const scopeKey = getTxScopeKey(address);

  const rendered =
    typeof Cache.getRenderedState === 'function' ? Cache.getRenderedState(scopeKey) : null;
  if (!rendered || !Array.isArray(rendered.txs) || rendered.txs.length === 0) return;

  const totalPages = Math.max(1, Math.ceil(rendered.txs.length / TX_PAGE_SIZE));
  const currentPage = typeof Cache.getPageState === 'function' ? Cache.getPageState(scopeKey) : 1;
  const nextPage = Math.min(totalPages, Math.max(1, currentPage + delta));
  if (nextPage === currentPage) return;

  if (typeof Cache.setPageState === 'function') {
    Cache.setPageState(scopeKey, nextPage);
  }

  const el = document.getElementById('tx-list');
  if (!el) return;

  const renderTransactions =
    typeof Render.renderTransactionList === 'function' ? Render.renderTransactionList : () => {};
  renderTransactions(el, rendered.address, rendered.txs, rendered.networkKey);
}

// ── Init (event listeners) ─────────────────────────────────────────────

function initHistory() {
  const prevBtn = document.getElementById('tx-page-prev');
  const nextBtn = document.getElementById('tx-page-next');
  if (prevBtn) prevBtn.addEventListener('click', () => changeTxPage(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => changeTxPage(1));

  const refreshBtn = document.getElementById('tx-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshHistory());
}

// ── Backward-compatible renderTransactions wrapper ──────────────────────
// Callers that still use WolfPopupTxHistory.renderTransactions() are
// forwarded to the new WolfPopupTxRender.renderTransactionList().
function renderTransactions(el, address, txs, networkKey) {
  const Render = _getRender();
  if (typeof Render.renderTransactionList === 'function') {
    return Render.renderTransactionList(el, address, txs, networkKey);
  }
}

// ── Export ──────────────────────────────────────────────────────────────

export const WolfPopupTxHistory = {
  TX_PAGE_SIZE: 10,
  getTxScopeKey: (...args) => {
    const Cache = _getCache();
    return typeof Cache.getTxScopeKey === 'function'
      ? Cache.getTxScopeKey(...args)
      : `${args[1] || _getPopupState().selectedNetwork}:${String(args[0]).toLowerCase()}`;
  },
  getTxExplorerBaseUrl: (...args) => {
    const Render = _getRender();
    return typeof Render.getTxExplorerBaseUrl === 'function'
      ? Render.getTxExplorerBaseUrl(...args)
      : 'https://etherscan.io/tx/';
  },
  loadTransactions,
  renderTransactions,
  updateTxPaginationUI: (...args) => {
    const Render = _getRender();
    if (typeof Render.updateTxPaginationUI === 'function') {
      return Render.updateTxPaginationUI(...args);
    }
  },
  changeTxPage,
  fetchAlchemyTransfers,
  setTxRefreshIndicator: (...args) => {
    const Render = _getRender();
    if (typeof Render.setTxRefreshIndicator === 'function') {
      return Render.setTxRefreshIndicator(...args);
    }
  },
  copyTxHash: (...args) => {
    const Render = _getRender();
    if (typeof Render.copyTxHash === 'function') {
      return Render.copyTxHash(...args);
    }
  },
  refreshHistory,
  initHistory,
};
globalThis.WolfPopupTxHistory = WolfPopupTxHistory;
