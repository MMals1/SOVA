'use strict';

import { WolfPopupSharedState } from './popup-state.js';
import { WolfPopupAvatar } from './avatar.js';
import { WolfPopupTokenState } from './token-state.js';
import { WolfPopupTxHistory } from './tx-history.js';

// ── Wallet screen + auto-refresh loop ─────────────────────────────────
// Загружает данные кошелька (баланс, токены, транзакции) и автоматически
// обновляет их при появлении новых блоков / по таймеру.

const PopupState = globalThis.WolfPopupSharedState || {};
const _sendToSW = (...a) => globalThis.sendToSW(...a);
const _setAvatar = (...a) => (globalThis.WolfPopupAvatar || globalThis).setAvatar(...a);
const _showScreen = (...a) => (globalThis.WolfPopupUiState || globalThis).showScreen(...a);
const _shortAddr = (...a) =>
  typeof globalThis.shortAddr === 'function' ? globalThis.shortAddr(...a) : '';
const _formatAmount = (...a) =>
  typeof globalThis.formatAmount === 'function' ? globalThis.formatAmount(...a) : '0';
const _getAccountsCached = (...a) =>
  typeof globalThis.getAccountsCached === 'function' ? globalThis.getAccountsCached(...a) : [];
const _updateNetworkBadge = () => {
  if (typeof globalThis.updateNetworkBadge === 'function') globalThis.updateNetworkBadge();
};
const _switchWalletTab = (...a) => {
  if (typeof globalThis.switchWalletTab === 'function') globalThis.switchWalletTab(...a);
};
const _loadTokenBalances = (...a) => {
  const m = globalThis.WolfPopupTokenState;
  if (m) return m.loadTokenBalances(...a);
};
const _loadTransactions = (...a) => {
  const m = globalThis.WolfPopupTxHistory;
  if (m) return m.loadTransactions(...a);
};
const _setTxRefreshIndicator = (...a) => {
  const m = globalThis.WolfPopupTxHistory;
  if (m) m.setTxRefreshIndicator(...a);
};

const AUTO_REFRESH_MIN_INTERVAL_MS = 10_000;
const AUTO_REFRESH_FALLBACK_MS = 30_000;

let _autoRefreshAddress = null;
let _autoRefreshBlockListener = null;
let _autoRefreshTimer = null;
let _autoRefreshInFlight = false;
let _lastAutoRefreshAt = 0;

function getAutoRefreshAddress() {
  return _autoRefreshAddress;
}

// ── loadWalletScreen ──────────────────────────────────────────────────
async function loadWalletScreen(address) {
  if (!address) {
    console.error('[popup] loadWalletScreen called without address');
    _showScreen('screen-setup');
    return;
  }
  _sendToSW({ type: MessageType.RESET_LOCK_TIMER });
  _setAvatar('wallet-avatar', address);

  const accounts = await _getAccountsCached();
  const acctName =
    accounts[PopupState.activeAccountIndex]?.name || `Account ${PopupState.activeAccountIndex + 1}`;
  document.getElementById('header-acct-name').textContent = acctName;
  document.getElementById('wallet-address').textContent = _shortAddr(address);
  _updateNetworkBadge();

  loadBalance(address);
  _loadTokenBalances(address);
  _loadTransactions(address);
  startAutoRefresh(address);
  _switchWalletTab('tokens');
}

function isWalletScreenVisible() {
  return document.getElementById('screen-wallet')?.classList.contains('active');
}

// ── Auto-refresh ──────────────────────────────────────────────────────
async function refreshActiveAccountData(force = false) {
  if (_autoRefreshInFlight) return;
  if (!isWalletScreenVisible()) return;

  const now = Date.now();
  if (!force && now - _lastAutoRefreshAt < AUTO_REFRESH_MIN_INTERVAL_MS) return;

  const accounts = await _getAccountsCached();
  const address = accounts[PopupState.activeAccountIndex]?.address;
  if (!address || address.toLowerCase() !== _autoRefreshAddress) return;

  _autoRefreshInFlight = true;
  _lastAutoRefreshAt = now;
  setBalanceRefreshIndicator(true);
  try {
    await Promise.all([
      loadBalance(address),
      _loadTokenBalances(address),
      _loadTransactions(address),
    ]);
  } finally {
    _autoRefreshInFlight = false;
    setBalanceRefreshIndicator(false);
  }
}

function stopAutoRefresh() {
  if (PopupState.provider && _autoRefreshBlockListener) {
    PopupState.provider.off('block', _autoRefreshBlockListener);
  }
  if (_autoRefreshTimer) clearInterval(_autoRefreshTimer);
  _autoRefreshAddress = null;
  _autoRefreshBlockListener = null;
  _autoRefreshTimer = null;
  _autoRefreshInFlight = false;
  _lastAutoRefreshAt = 0;
}

function startAutoRefresh(address) {
  stopAutoRefresh();
  if (!PopupState.provider || !address) return;

  _autoRefreshAddress = address.toLowerCase();
  _autoRefreshBlockListener = () => refreshActiveAccountData(false);
  PopupState.provider.on('block', _autoRefreshBlockListener);

  _autoRefreshTimer = setInterval(() => {
    refreshActiveAccountData(true);
  }, AUTO_REFRESH_FALLBACK_MS);
}

// ── Balance ───────────────────────────────────────────────────────────
async function loadBalance(address) {
  try {
    const wei = await PopupState.provider.getBalance(address);
    document.getElementById('wallet-balance').textContent = _formatAmount(
      parseFloat(ethers.formatEther(wei)),
    );
  } catch {
    document.getElementById('wallet-balance').textContent = '—';
  }
}

function setBalanceRefreshIndicator(active) {
  const el = document.getElementById('balance-refresh-indicator');
  if (el) el.classList.toggle('active', !!active);
  _setTxRefreshIndicator(active);
}

async function refreshBalance() {
  const accounts = await _getAccountsCached();
  const address = accounts[PopupState.activeAccountIndex]?.address;
  if (!address) return;
  _autoRefreshAddress = address.toLowerCase();
  setBalanceRefreshIndicator(true);
  try {
    await Promise.all([loadBalance(address), _loadTokenBalances(address)]);
    _loadTransactions(address);
  } finally {
    setBalanceRefreshIndicator(false);
  }
}

// Expose
globalThis.loadWalletScreen = loadWalletScreen;
globalThis.isWalletScreenVisible = isWalletScreenVisible;
globalThis.stopAutoRefresh = stopAutoRefresh;
globalThis.startAutoRefresh = startAutoRefresh;
globalThis.refreshBalance = refreshBalance;
globalThis.getAutoRefreshAddress = getAutoRefreshAddress;

export const WolfPopupRefreshLoop = {
  loadWalletScreen,
  isWalletScreenVisible,
  refreshActiveAccountData,
  stopAutoRefresh,
  startAutoRefresh,
  loadBalance,
  setBalanceRefreshIndicator,
  refreshBalance,
  getAutoRefreshAddress,
};
globalThis.WolfPopupRefreshLoop = WolfPopupRefreshLoop;
