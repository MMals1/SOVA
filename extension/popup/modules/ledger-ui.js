'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// ledger-ui.js — Ledger hardware wallet UI & account management (6.1)
// Handles connection, address derivation, account import, and signing
// delegation for Ledger hardware wallet accounts.
// ═══════════════════════════════════════════════════════════════════════════

import { WolfPopupSharedState } from './popup-state.js';
import { WolfPopupStorage } from './storage.js';
import { WolfPopupUiMessages } from './ui-messages.js';

const PopupState = globalThis.WolfPopupSharedState || {};
const _getLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).getLocal(...a);
const _setLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).setLocal(...a);
const _showScreen = (...a) => (globalThis.WolfPopupUiState || globalThis).showScreen(...a);
const _showError = (...a) => (globalThis.WolfPopupUiMessages || globalThis).showError(...a);
const _setStatus = (...a) => (globalThis.WolfPopupUiMessages || globalThis).setStatus(...a);
const _setLoading = (...a) => (globalThis.WolfPopupUiMessages || globalThis).setLoading(...a);
const _clearMessages = (...a) => (globalThis.WolfPopupUiMessages || globalThis).clearMessages(...a);
const _shortAddr = (...a) =>
  typeof globalThis.shortAddr === 'function' ? globalThis.shortAddr(...a) : '';

// ── State ────────────────────────────────────────────────────────────
let _ledgerConnected = false;
let _derivedAddresses = []; // [{index, address, publicKey}]

// ── Helpers ──────────────────────────────────────────────────────────
function _isWebHIDSupported() {
  return typeof navigator !== 'undefined' && !!navigator.hid;
}

function _getTransport() {
  return globalThis.LedgerTransport;
}

function _getEthApp() {
  return globalThis.LedgerEth;
}

// ── Connection ───────────────────────────────────────────────────────
async function connectLedger() {
  _clearMessages('ledger');

  if (!_isWebHIDSupported()) {
    _showError('ledger', 'WebHID не поддерживается в этом браузере');
    return false;
  }

  const transport = _getTransport();
  if (!transport) {
    _showError('ledger', 'Ledger transport не загружен');
    return false;
  }

  _setStatus('ledger', 'Подключение к Ledger…');
  _setLoading('btn-ledger-connect', true);

  try {
    await transport.connect();
    _ledgerConnected = true;
    _updateConnectionUI(true);

    // Verify Ethereum app is open
    const ethApp = _getEthApp();
    if (ethApp) {
      try {
        const config = await ethApp.getAppConfig();
        _setStatus('ledger', `Ethereum app v${config.version}`);
      } catch {
        _showError('ledger', 'Откройте приложение Ethereum на Ledger');
        _setLoading('btn-ledger-connect', false);
        return false;
      }
    }

    // Derive first 5 addresses
    await _deriveAddresses(5);
    _setLoading('btn-ledger-connect', false);
    return true;
  } catch (e) {
    _ledgerConnected = false;
    _updateConnectionUI(false);
    _setLoading('btn-ledger-connect', false);

    if (e.message?.includes('denied') || e.message?.includes('NotAllowedError')) {
      _showError('ledger', 'Доступ к устройству отклонён');
    } else if (e.message?.includes('not found')) {
      _showError('ledger', 'Ledger не найден — подключите устройство и разблокируйте его');
    } else {
      _showError('ledger', e.message || 'Ошибка подключения');
    }
    return false;
  }
}

async function disconnectLedger() {
  const transport = _getTransport();
  if (transport && transport.isConnected()) {
    await transport.disconnect();
  }
  _ledgerConnected = false;
  _derivedAddresses = [];
  _updateConnectionUI(false);
  _clearMessages('ledger');
}

// ── Address derivation ──────────────────────────────────────────────
async function _deriveAddresses(count) {
  const ethApp = _getEthApp();
  if (!ethApp) return;

  _derivedAddresses = [];
  const listEl = document.getElementById('ledger-address-list');
  if (listEl) listEl.textContent = '';

  for (let i = 0; i < count; i++) {
    try {
      const { address, publicKey } = await ethApp.getAddress(i, false);
      _derivedAddresses.push({ index: i, address, publicKey });
      _renderAddressRow(i, address);
    } catch (e) {
      _showError('ledger', `Ошибка получения адреса #${i}: ${e.message}`);
      break;
    }
  }
}

function _renderAddressRow(index, address) {
  const listEl = document.getElementById('ledger-address-list');
  if (!listEl) return;

  const row = document.createElement('div');
  row.className = 'ledger-addr-row';

  const indexEl = document.createElement('span');
  indexEl.className = 'ledger-addr-index';
  indexEl.textContent = `#${index}`;

  const addrEl = document.createElement('span');
  addrEl.className = 'ledger-addr-text mono';
  addrEl.textContent = _shortAddr(address) || address.slice(0, 10) + '…' + address.slice(-8);
  addrEl.title = address;

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn-ghost btn-sm';
  importBtn.textContent = 'Импорт';
  importBtn.addEventListener('click', () => importLedgerAccount(index));

  row.appendChild(indexEl);
  row.appendChild(addrEl);
  row.appendChild(importBtn);
  listEl.appendChild(row);
}

// ── Import Ledger account ───────────────────────────────────────────
async function importLedgerAccount(derivationIndex) {
  const derived = _derivedAddresses.find((d) => d.index === derivationIndex);
  if (!derived) {
    _showError('ledger', 'Адрес не найден');
    return;
  }

  const { accounts = [] } = await _getLocal(['accounts']);

  // Check for duplicate
  if (accounts.some((a) => a.address?.toLowerCase() === derived.address.toLowerCase())) {
    _showError('ledger', 'Этот адрес уже добавлен');
    return;
  }

  const newAccount = {
    address: derived.address,
    name: `Ledger ${derivationIndex + 1}`,
    type: 'ledger',
    derivationPath: `m/44'/60'/0'/0/${derivationIndex}`,
    derivationIndex,
  };

  accounts.push(newAccount);
  const newIdx = accounts.length - 1;
  PopupState.activeAccountIndex = newIdx;
  await _setLocal({ accounts, activeAccount: newIdx });

  if (typeof globalThis.setAccountsCache === 'function') {
    globalThis.setAccountsCache(accounts);
  }

  _setStatus('ledger', `✓ ${newAccount.name} (${_shortAddr(derived.address)}) добавлен`);

  const bus = globalThis.WolfPopupEventBus;
  if (bus)
    bus.emit(bus.Events.ACCOUNT_ADDED, { index: newIdx, address: derived.address, type: 'ledger' });

  // Mark imported row
  const listEl = document.getElementById('ledger-address-list');
  if (listEl) {
    const rows = listEl.querySelectorAll('.ledger-addr-row');
    if (rows[derivationIndex]) {
      const btn = rows[derivationIndex].querySelector('button');
      if (btn) {
        btn.textContent = '✓';
        btn.disabled = true;
      }
    }
  }
}

// ── UI updates ──────────────────────────────────────────────────────
function _updateConnectionUI(connected) {
  const statusEl = document.getElementById('ledger-status');
  const connectBtn = document.getElementById('btn-ledger-connect');
  const disconnectBtn = document.getElementById('btn-ledger-disconnect');
  const addrSection = document.getElementById('ledger-addresses-section');

  if (statusEl) {
    statusEl.textContent = connected ? '🟢 Подключён' : '⚪ Не подключён';
    statusEl.className = 'ledger-status ' + (connected ? 'connected' : '');
  }
  if (connectBtn) connectBtn.style.display = connected ? 'none' : '';
  if (disconnectBtn) disconnectBtn.style.display = connected ? '' : 'none';
  if (addrSection) addrSection.style.display = connected ? '' : 'none';
}

/**
 * Check if the active account is a Ledger account.
 * @returns {Promise<boolean>}
 */
async function isActiveLedgerAccount() {
  const accounts =
    typeof globalThis.getAccountsCached === 'function' ? await globalThis.getAccountsCached() : [];
  const acct = accounts[PopupState.activeAccountIndex];
  return acct?.type === 'ledger';
}

/**
 * Sign a transaction with the Ledger device (popup-side).
 * Used by the send flow when the active account is a Ledger account.
 * @param {object} txParams - { to, value, data, chainId, nonce, gasLimit, maxFeePerGas, maxPriorityFeePerGas }
 * @returns {Promise<string>} signed transaction hex
 */
async function signAndSendTransaction(txParams) {
  const transport = _getTransport();
  const ethApp = _getEthApp();
  if (!transport || !transport.isConnected() || !ethApp) {
    throw new Error('Ledger не подключён — подключите устройство');
  }

  const accounts =
    typeof globalThis.getAccountsCached === 'function' ? await globalThis.getAccountsCached() : [];
  const acct = accounts[PopupState.activeAccountIndex];
  if (!acct || acct.type !== 'ledger') {
    throw new Error('Активный аккаунт не является Ledger');
  }

  // Build unsigned transaction
  const tx = {
    to: txParams.to,
    value: txParams.value ?? 0n,
    data: txParams.data ?? '0x',
    chainId: txParams.chainId,
    nonce: txParams.nonce,
    type: 2, // EIP-1559
    maxFeePerGas: txParams.maxFeePerGas,
    maxPriorityFeePerGas: txParams.maxPriorityFeePerGas,
    gasLimit: txParams.gasLimit,
  };

  // Serialize unsigned tx (RLP)
  const unsignedSerialized = ethers.Transaction.from(tx).unsignedSerialized;
  const rawTxBytes = ethers.getBytes(unsignedSerialized);

  // Sign on Ledger
  const { v, r, s } = await ethApp.signTransaction(rawTxBytes, acct.derivationIndex || 0);

  // Reconstruct signed tx
  const signedTx = ethers.Transaction.from({
    ...tx,
    signature: { v, r, s },
  });

  // Broadcast via provider
  const provider = PopupState.provider;
  if (!provider) throw new Error('Провайдер не настроен');

  const response = await provider.broadcastTransaction(signedTx.serialized);
  return { ok: true, hash: response.hash };
}

/**
 * Sign a personal message with the Ledger device.
 * @param {string} message
 * @returns {Promise<string>} signature hex
 */
async function signMessage(message) {
  const ethApp = _getEthApp();
  if (!ethApp) throw new Error('Ledger не подключён');

  const accounts =
    typeof globalThis.getAccountsCached === 'function' ? await globalThis.getAccountsCached() : [];
  const acct = accounts[PopupState.activeAccountIndex];
  if (!acct || acct.type !== 'ledger') {
    throw new Error('Активный аккаунт не является Ledger');
  }

  const { v, r, s } = await ethApp.signPersonalMessage(message, acct.derivationIndex || 0);
  return ethers.Signature.from({ v, r, s }).serialized;
}

// ── Show Ledger screen ──────────────────────────────────────────────
function showLedgerScreen() {
  _clearMessages('ledger');
  _updateConnectionUI(_ledgerConnected);
  _showScreen('screen-ledger');
}

// ── Expose ──────────────────────────────────────────────────────────
export const WolfPopupLedgerUi = Object.freeze({
  connectLedger,
  disconnectLedger,
  importLedgerAccount,
  isActiveLedgerAccount,
  signAndSendTransaction,
  signMessage,
  showLedgerScreen,
});

globalThis.WolfPopupLedgerUi = WolfPopupLedgerUi;
globalThis.connectLedger = connectLedger;
globalThis.disconnectLedger = disconnectLedger;
globalThis.showLedgerScreen = showLedgerScreen;
