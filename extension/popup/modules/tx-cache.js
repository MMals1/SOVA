'use strict';

// ── SOVA Wallet — Transaction cache & pagination state ─────────────────
// Manages in-memory Maps for deduplication of concurrent loads,
// per-account/network pagination cursors, and rendered-state tracking.
// Also provides helpers to read/write the persistent chrome.storage cache.

const _Storage = globalThis.WolfPopupStorage;
const getLocal = _Storage
  ? _Storage.getLocal.bind(_Storage)
  : (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const setLocal = _Storage
  ? _Storage.setLocal.bind(_Storage)
  : (data) => new Promise((r) => chrome.storage.local.set(data, r));

const TX_SYNC_STATE_KEY = 'txSyncState';
const TX_HISTORY_CACHE_KEY = 'txHistoryCache';
const TX_HISTORY_LIMIT = 1000;
const TX_PAGE_SIZE = 10;
const TX_INITIAL_MAX_COUNT = '0x3e8';
const TX_INCREMENTAL_MAX_COUNT = '0x64';

// ── In-memory Maps ─────────────────────────────────────────────────────
const _txLoadPromises = new Map();
const _txPaginationState = new Map();
const _txRenderedState = new Map();

// ── PopupState / WalletCore references ─────────────────────────────────
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

function _getWalletCore() {
  return globalThis.WolfWalletCore && typeof globalThis.WolfWalletCore === 'object'
    ? globalThis.WolfWalletCore
    : {};
}

// ── Scope key ──────────────────────────────────────────────────────────

/**
 * Build a unique cache / pagination key for a given address + network.
 * @param {string} address
 * @param {string} [networkKey]
 * @returns {string}
 */
function getTxScopeKey(address, networkKey) {
  const PopupState = _getPopupState();
  const nk = networkKey !== undefined ? networkKey : PopupState.selectedNetwork;
  const WalletCore = _getWalletCore();
  if (typeof WalletCore.getTxScopeKey === 'function') {
    return WalletCore.getTxScopeKey(address, nk);
  }
  return `${nk}:${String(address).toLowerCase()}`;
}

// ── Load-promise deduplication ─────────────────────────────────────────

function hasLoadPromise(scopeKey) {
  return _txLoadPromises.has(scopeKey);
}

function getLoadPromise(scopeKey) {
  return _txLoadPromises.get(scopeKey);
}

function setLoadPromise(scopeKey, promise) {
  _txLoadPromises.set(scopeKey, promise);
}

function deleteLoadPromise(scopeKey) {
  _txLoadPromises.delete(scopeKey);
}

// ── Pagination state ───────────────────────────────────────────────────

function getPageState(scopeKey) {
  return _txPaginationState.get(scopeKey) || 1;
}

function setPageState(scopeKey, page) {
  _txPaginationState.set(scopeKey, page);
}

function resetPageState(scopeKey) {
  _txPaginationState.delete(scopeKey);
}

// ── Rendered state ─────────────────────────────────────────────────────

function getRenderedState(scopeKey) {
  return _txRenderedState.get(scopeKey);
}

function setRenderedState(scopeKey, state) {
  _txRenderedState.set(scopeKey, state);
}

function resetRenderedState(scopeKey) {
  _txRenderedState.delete(scopeKey);
}

// ── Persistent storage helpers ─────────────────────────────────────────

async function getCachedTransactions(scopeKey) {
  const { [TX_HISTORY_CACHE_KEY]: txCache = {} } = await getLocal([TX_HISTORY_CACHE_KEY]);
  const cached = txCache?.[scopeKey];
  return Array.isArray(cached) ? cached : [];
}

async function setCachedTransactions(scopeKey, txs) {
  const { [TX_HISTORY_CACHE_KEY]: txCache = {} } = await getLocal([TX_HISTORY_CACHE_KEY]);
  const nextCache = { ...txCache };
  nextCache[scopeKey] = txs;
  await setLocal({ [TX_HISTORY_CACHE_KEY]: nextCache });
}

async function getSyncState(scopeKey) {
  const { [TX_SYNC_STATE_KEY]: syncState = {} } = await getLocal([TX_SYNC_STATE_KEY]);
  return syncState?.[scopeKey] || {};
}

async function getFullSyncState() {
  const { [TX_SYNC_STATE_KEY]: syncState = {} } = await getLocal([TX_SYNC_STATE_KEY]);
  return syncState || {};
}

async function getFullCache() {
  const { [TX_HISTORY_CACHE_KEY]: txCache = {} } = await getLocal([TX_HISTORY_CACHE_KEY]);
  return txCache || {};
}

async function persistSyncAndCache(syncState, txCache) {
  await setLocal({
    [TX_SYNC_STATE_KEY]: syncState,
    [TX_HISTORY_CACHE_KEY]: txCache,
  });
}

// ── Cache invalidation ─────────────────────────────────────────────────

function invalidateScope(scopeKey) {
  _txLoadPromises.delete(scopeKey);
  _txPaginationState.delete(scopeKey);
  _txRenderedState.delete(scopeKey);
}

function invalidateAll() {
  _txLoadPromises.clear();
  _txPaginationState.clear();
  _txRenderedState.clear();
}

// ── Export ──────────────────────────────────────────────────────────────

export const WolfPopupTxCache = {
  TX_SYNC_STATE_KEY,
  TX_HISTORY_CACHE_KEY,
  TX_HISTORY_LIMIT,
  TX_PAGE_SIZE,
  TX_INITIAL_MAX_COUNT,
  TX_INCREMENTAL_MAX_COUNT,

  getTxScopeKey,

  hasLoadPromise,
  getLoadPromise,
  setLoadPromise,
  deleteLoadPromise,

  getPageState,
  setPageState,
  resetPageState,

  getRenderedState,
  setRenderedState,
  resetRenderedState,

  getCachedTransactions,
  setCachedTransactions,
  getSyncState,
  getFullSyncState,
  getFullCache,
  persistSyncAndCache,

  invalidateScope,
  invalidateAll,
};
globalThis.WolfPopupTxCache = WolfPopupTxCache;
