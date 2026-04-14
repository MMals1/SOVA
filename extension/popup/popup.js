'use strict';

// ── SOVA Wallet — popup.js (wiring layer) ──────────────────────────────
// Роль этого файла: wiring. Все бизнес-логика в модулях.
// Этот файл:
//  1. Связывает модули с globalThis (для event-binder data-onclick)
//  2. Синхронизирует PopupState с runtime-переменными
//  3. Запускает bootstrap
//
// Утилиты (formatAmount, shortAddr, provider cache) — popup-utils.js
// Seed backup — backup-seed.js

// ── Module imports ──────────────────────────────────────────────────────
import { WolfPopupSharedState } from './modules/popup-state.js';
import { WolfPopupStorage } from './modules/storage.js';
import { WolfPopupUiMessages } from './modules/ui-messages.js';
import { WolfPopupAvatar } from './modules/avatar.js';
import { WolfPopupClipboard } from './modules/clipboard.js';
import { WolfPopupNetworkState } from './modules/network-state.js';
import { WolfPopupTxHistory } from './modules/tx-history.js';
import { WolfPopupTokenState } from './modules/token-state.js';
import { WolfPopupSendFlow } from './modules/send-flow.js';
import { WolfPopupUiState } from './modules/ui-state.js';
import { WolfPopupDappApproval } from './modules/dapp-approval.js';
import { WolfPopupAccounts } from './modules/accounts.js';
import { WolfPopupRefreshLoop } from './modules/refresh-loop.js';
import { WolfPopupSwMessaging } from './modules/sw-messaging.js';
import { WolfPopupBootstrap } from './modules/bootstrap.js';
import { WolfPopupSettings } from './modules/settings.js';
// popup-utils.js and backup-seed.js register their functions on globalThis
import './modules/popup-utils.js';
import './modules/backup-seed.js';

// ── Module references (short aliases for wiring below) ──────────────────
const PopupState = WolfPopupSharedState;
const NS = WolfPopupNetworkState;
const TxHistory = WolfPopupTxHistory;
const TokenState = WolfPopupTokenState;
const SendFlow = WolfPopupSendFlow;
const UiState = WolfPopupUiState;
const DappApproval = WolfPopupDappApproval;
const Accounts = WolfPopupAccounts;
const RefreshLoop = WolfPopupRefreshLoop;
const SwMsg = WolfPopupSwMessaging;
const Bootstrap = WolfPopupBootstrap;
const Storage = WolfPopupStorage;
const UiMessages = WolfPopupUiMessages;
const Settings = WolfPopupSettings;
const Avatar = WolfPopupAvatar;
const Clipboard = WolfPopupClipboard;

// ── Short aliases for frequently used functions ─────────────────────────
const getLocal = Storage.getLocal.bind(Storage);
const setLocal = Storage.setLocal.bind(Storage);
const getSession = Storage.getSession.bind(Storage);
const setSession = Storage.setSession.bind(Storage);
const showError = UiMessages.showError.bind(UiMessages);
const setStatus = UiMessages.setStatus.bind(UiMessages);
const clearMessages = UiMessages.clearMessages.bind(UiMessages);
const setLoading = UiMessages.setLoading.bind(UiMessages);
const setAvatar = Avatar.setAvatar.bind(Avatar);
const copyText = Clipboard.copyText.bind(Clipboard);

// ── Runtime state (synced to PopupState via defineProperties) ───────────
let provider = null;
let activeAccountIndex = 0;
let selectedNetwork = NS.DEFAULT_NETWORK_KEY;
let rpcByNetwork = {};

Object.defineProperties(PopupState, {
  provider: {
    configurable: true,
    get: () => provider,
    set: (v) => {
      provider = v;
    },
  },
  activeAccountIndex: {
    configurable: true,
    get: () => activeAccountIndex,
    set: (v) => {
      activeAccountIndex = v;
    },
  },
  selectedChain: { configurable: true, get: () => NS.DEFAULT_CHAIN_KEY, set: () => {} },
  selectedNetwork: {
    configurable: true,
    get: () => selectedNetwork,
    set: (v) => {
      selectedNetwork = v;
    },
  },
  rpcByNetwork: {
    configurable: true,
    get: () => rpcByNetwork,
    set: (v) => {
      rpcByNetwork = v;
    },
  },
});

// ── Runtime state (synced to PopupState via defineProperties) ───────────
async function copyAddress() {
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (!address) return;
  await copyText(address);
  const btn = document.querySelector('.copy-btn');
  const originalNodes = Array.from(btn.childNodes).map((n) => n.cloneNode(true));
  btn.textContent = '';
  const tick = document.createElement('span');
  tick.style.cssText = 'font-size:12px;color:#4ade80';
  tick.textContent = '✓';
  btn.appendChild(tick);
  setTimeout(() => {
    btn.textContent = '';
    originalNodes.forEach((n) => btn.appendChild(n));
  }, 1500);
}

async function resetWallet() {
  const ok = confirm(
    'Удалить кошелёк с этого устройства?\n\nВосстановить можно только по мнемонической фразе.',
  );
  if (!ok) return;
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  activeAccountIndex = 0;
  UiState.showScreen('screen-setup');
}

async function openConnectedSites() {
  document.getElementById('acct-menu')?.classList.add('hidden');
  UiState.showScreen('screen-connected-sites');
  DappApproval.renderConnectedSitesList('connected-sites-list');
}

async function saveEtherscanKeyFromInput() {
  const input = document.getElementById('etherscan-api-key');
  if (!input) return;
  await NS.saveEtherscanKey(input.value || '');
  const accounts = await Accounts.getAccountsCached();
  const acct = accounts[activeAccountIndex];
  if (acct?.address) TxHistory.loadTransactions(acct.address);
}

async function setNetwork(networkKey) {
  await NS.setNetwork(networkKey);
  SwMsg.notifyChainChangedToDapps(networkKey);
}

// ── globalThis wiring for event-binder (data-onclick="fnName()") ────────
// Все функции, которые используются в popup.html через data-onclick,
// data-onchange, data-onkeydown — должны быть на globalThis.
// Модули уже назначают свои функции на globalThis, но popup.js
// добавляет оставшиеся wrappers:

// Navigation
globalThis.showScreen = (...a) => UiState.showScreen(...a);
globalThis.switchTab = (...a) => UiState.switchTab(...a);
globalThis.switchWalletTab = (...a) => UiState.switchWalletTab(...a);

// Network
globalThis.toggleCustomKey = () => NS.toggleCustomKey();
globalThis.toggleNetworkPicker = (...a) => NS.toggleNetworkPicker(...a);
globalThis.selectNetworkOption = (...a) => NS.selectNetworkOption(...a);
globalThis.setNetwork = setNetwork;
globalThis.updateNetworkBadge = () => NS.updateNetworkBadge();

// Wallet create/import (already on globalThis from module, but alias for safety)
globalThis.createWallet = () => globalThis.WolfPopupWalletCreateImport.createWallet();
globalThis.importWallet = () => globalThis.WolfPopupWalletCreateImport.importWallet();

// Token
globalThis.loadTokenBalances = (...a) => TokenState.loadTokenBalances(...a);
globalThis.onTokenAddrChange = () => TokenState.onTokenAddrChange();
globalThis.fetchTokenInfo = () => TokenState.fetchTokenInfo();
globalThis.addToken = () => TokenState.addToken();
globalThis.removeToken = (...a) => TokenState.removeToken(...a);
globalThis.getTokensForSelectedNetwork = () => TokenState.getTokensForSelectedNetwork();

// Tx history
globalThis.loadTransactions = (...a) => TxHistory.loadTransactions(...a);
globalThis.changeTxPage = (...a) => TxHistory.changeTxPage(...a);
globalThis.copyTxHash = (...a) => TxHistory.copyTxHash(...a);

// Send
globalThis.showSendScreen = () => SendFlow.showSendScreen();
globalThis.resetSendFlowUI = (...a) => SendFlow.resetSendFlowUI(...a);
globalThis.sendTransaction = () => SendFlow.sendTransaction();
globalThis.confirmSend = () => SendFlow.confirmSend();
globalThis.cancelSend = () => SendFlow.cancelSend();

// Balance
globalThis.refreshBalance = () => RefreshLoop.refreshBalance();

// Misc
globalThis.copyAddress = copyAddress;
globalThis.resetWallet = resetWallet;
globalThis.openConnectedSites = openConnectedSites;
globalThis.saveEtherscanKeyFromInput = saveEtherscanKeyFromInput;

// Network delegations (used by modules and event-binder)
globalThis.getRpcUrlForNetwork = (...a) => NS.getRpcUrlForNetwork(...a);
globalThis.getCurrentNetworkMeta = () => NS.getCurrentNetworkMeta();
globalThis.getNativeAssetSymbol = (...a) => NS.getNativeAssetSymbol(...a);
globalThis.ensureMainnetSendGuard = () => NS.ensureMainnetSendGuard();
globalThis.syncNetworkControls = () => NS.syncNetworkControls();

// Settings (wired via data-onclick in popup.html)
globalThis.setAppLang = (...a) => Settings.setAppLang(...a);
globalThis.settingsToggleCustomKey = () => Settings.settingsToggleCustomKey();
globalThis.settingsSaveKeys = () => Settings.settingsSaveKeys();

// 1.5: Auto-lock timeout
globalThis.setAutoLockMinutes = async function (minutes) {
  await setLocal({ autoLockMinutes: minutes });
  // Обновляем UI кнопок
  document.querySelectorAll('.autolock-option').forEach((btn) => {
    btn.classList.toggle('active', parseInt(btn.dataset.minutes, 10) === minutes);
  });
  // Если сессия активна — обновляем alarm в SW
  const sendToSW = globalThis.sendToSW;
  if (typeof sendToSW === 'function') sendToSW({ type: MessageType.RESET_LOCK_TIMER });
};

// Инициализация auto-lock picker при загрузке settings
globalThis._initAutoLockPicker = async function () {
  const { autoLockMinutes = 5 } = await getLocal(['autoLockMinutes']);
  const val = parseInt(autoLockMinutes, 10) || 5;
  document.querySelectorAll('.autolock-option').forEach((btn) => {
    btn.classList.toggle('active', parseInt(btn.dataset.minutes, 10) === val);
  });
};

// ── Bootstrap ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => Bootstrap.init());
