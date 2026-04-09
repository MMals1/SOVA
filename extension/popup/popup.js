'use strict';

// ── SOVA Wallet — popup.js (P5-1 decomposed) ───────────────────────────
// Роль этого файла: wiring. Все бизнес-логика в модулях.
// Этот файл:
//  1. Связывает модули с globalThis (для event-binder data-onclick)
//  2. Синхронизирует PopupState с runtime-переменными
//  3. Предоставляет provider cache и утилиты (formatAmount, shortAddr)
//  4. Запускает bootstrap
//
// Все модули загружаются из popup.html ДО этого файла.
// bootstrap.js → assertModulesLoaded() гарантирует их наличие.

// ── Module references (без fallback'ов — bootstrap проверяет) ───────────
const WalletCore   = globalThis.WolfWalletCore || {};
const PopupState   = globalThis.WolfPopupSharedState;
const NS           = globalThis.WolfPopupNetworkState;
const TxHistory    = globalThis.WolfPopupTxHistory;
const TokenState   = globalThis.WolfPopupTokenState;
const SendFlow     = globalThis.WolfPopupSendFlow;
const UiState      = globalThis.WolfPopupUiState;
const DappApproval = globalThis.WolfPopupDappApproval;
const Accounts     = globalThis.WolfPopupAccounts;
const QuizFlow     = globalThis.WolfPopupQuizFlow;
const UnlockFlow   = globalThis.WolfPopupUnlockFlow;
const RefreshLoop  = globalThis.WolfPopupRefreshLoop;
const SwMsg        = globalThis.WolfPopupSwMessaging;
const Bootstrap    = globalThis.WolfPopupBootstrap;
const Storage      = globalThis.WolfPopupStorage;
const UiMessages   = globalThis.WolfPopupUiMessages;
const Avatar       = globalThis.WolfPopupAvatar;
const Clipboard    = globalThis.WolfPopupClipboard;

// ── Short aliases for frequently used functions ─────────────────────────
const getLocal     = Storage.getLocal.bind(Storage);
const setLocal     = Storage.setLocal.bind(Storage);
const getSession   = Storage.getSession.bind(Storage);
const setSession   = Storage.setSession.bind(Storage);
const showError    = UiMessages.showError.bind(UiMessages);
const setStatus    = UiMessages.setStatus.bind(UiMessages);
const clearMessages = UiMessages.clearMessages.bind(UiMessages);
const setLoading   = UiMessages.setLoading.bind(UiMessages);
const setAvatar    = Avatar.setAvatar.bind(Avatar);
const copyText     = Clipboard.copyText.bind(Clipboard);

// ── Runtime state (synced to PopupState via defineProperties) ───────────
let provider = null;
let activeAccountIndex = 0;
let selectedNetwork = NS.DEFAULT_NETWORK_KEY;
let rpcByNetwork = {};

Object.defineProperties(PopupState, {
  provider:           { configurable: true, get: () => provider,           set: (v) => { provider = v; } },
  activeAccountIndex: { configurable: true, get: () => activeAccountIndex, set: (v) => { activeAccountIndex = v; } },
  selectedChain:      { configurable: true, get: () => NS.DEFAULT_CHAIN_KEY, set: () => {} },
  selectedNetwork:    { configurable: true, get: () => selectedNetwork,    set: (v) => { selectedNetwork = v; } },
  rpcByNetwork:       { configurable: true, get: () => rpcByNetwork,      set: (v) => { rpcByNetwork = v; } },
});

// ── Provider cache ──────────────────────────────────────────────────────
const _providerCache = new Map();
function getOrCreatePopupProvider(rpcUrl) {
  const key = String(rpcUrl || '').trim();
  if (!key) return new ethers.JsonRpcProvider(rpcUrl);
  const cached = _providerCache.get(key);
  if (cached) return cached;
  if (_providerCache.size >= 6) {
    _providerCache.delete(_providerCache.keys().next().value);
  }
  const created = new ethers.JsonRpcProvider(key);
  _providerCache.set(key, created);
  return created;
}
globalThis.getOrCreatePopupProvider = getOrCreatePopupProvider;

// ── Utility functions (used by multiple modules via globalThis) ─────────
function formatAmount(value) {
  if (typeof WalletCore.formatAmount === 'function') return WalletCore.formatAmount(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  let s;
  if      (abs >= 1000)    s = value.toFixed(2);
  else if (abs >= 1)       s = value.toFixed(4);
  else if (abs >= 0.000001) s = value.toFixed(6);
  else                     return '< 0.000001';
  return s.replace(/\.?0+$/, '');
}

function shortAddr(addr) {
  if (typeof WalletCore.shortAddr === 'function') return WalletCore.shortAddr(addr);
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

function getTxScopeKey(address, networkKey = selectedNetwork) {
  return typeof WalletCore.getTxScopeKey === 'function'
    ? WalletCore.getTxScopeKey(address, networkKey)
    : `${networkKey}:${String(address).toLowerCase()}`;
}

function getTxExplorerBaseUrl(networkKey = selectedNetwork) {
  return typeof WalletCore.getTxExplorerBaseUrl === 'function'
    ? WalletCore.getTxExplorerBaseUrl(networkKey)
    : (networkKey === 'eth-sepolia' ? 'https://sepolia.etherscan.io/tx/'
       : networkKey === 'bsc' ? 'https://bscscan.com/tx/'
       : 'https://etherscan.io/tx/');
}

function getTokenLogoUrls(tokenAddress, networkKey = selectedNetwork) {
  if (!tokenAddress) return [];
  if (!String(networkKey).startsWith('eth-') && networkKey !== 'bsc') return [];
  try {
    const checksum = ethers.getAddress(tokenAddress);
    if (typeof WalletCore.getTokenLogoUrls === 'function') return WalletCore.getTokenLogoUrls(checksum, networkKey);
    const lower = checksum.toLowerCase();
    const chain = networkKey === 'bsc' ? 'smartchain' : 'ethereum';
    return [
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${checksum}/logo.png`,
      `https://tokens.1inch.io/${lower}.png`,
    ];
  } catch { return []; }
}

// ── Small self-contained functions ──────────────────────────────────────
async function copyAddress() {
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (!address) return;
  await copyText(address);
  const btn = document.querySelector('.copy-btn');
  const originalNodes = Array.from(btn.childNodes).map(n => n.cloneNode(true));
  btn.textContent = '';
  const tick = document.createElement('span');
  tick.style.cssText = 'font-size:12px;color:#4ade80';
  tick.textContent = '✓';
  btn.appendChild(tick);
  setTimeout(() => {
    btn.textContent = '';
    originalNodes.forEach(n => btn.appendChild(n));
  }, 1500);
}

async function resetWallet() {
  const ok = confirm('Удалить кошелёк с этого устройства?\n\nВосстановить можно только по мнемонической фразе.');
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
globalThis.showScreen         = (...a) => UiState.showScreen(...a);
globalThis.switchTab           = (...a) => UiState.switchTab(...a);
globalThis.switchWalletTab     = (...a) => UiState.switchWalletTab(...a);

// Network
globalThis.toggleCustomKey     = () => NS.toggleCustomKey();
globalThis.toggleNetworkPicker = (...a) => NS.toggleNetworkPicker(...a);
globalThis.selectNetworkOption = (...a) => NS.selectNetworkOption(...a);
globalThis.setNetwork          = setNetwork;
globalThis.updateNetworkBadge  = () => NS.updateNetworkBadge();

// Wallet create/import (already on globalThis from module, but alias for safety)
globalThis.createWallet        = () => globalThis.WolfPopupWalletCreateImport.createWallet();
globalThis.importWallet        = () => globalThis.WolfPopupWalletCreateImport.importWallet();

// Token
globalThis.loadTokenBalances   = (...a) => TokenState.loadTokenBalances(...a);
globalThis.onTokenAddrChange   = () => TokenState.onTokenAddrChange();
globalThis.fetchTokenInfo      = () => TokenState.fetchTokenInfo();
globalThis.addToken            = () => TokenState.addToken();
globalThis.removeToken         = (...a) => TokenState.removeToken(...a);
globalThis.getTokensForSelectedNetwork = () => TokenState.getTokensForSelectedNetwork();
globalThis.getTokenLogoUrls    = getTokenLogoUrls;

// Tx history
globalThis.loadTransactions    = (...a) => TxHistory.loadTransactions(...a);
globalThis.changeTxPage        = (...a) => TxHistory.changeTxPage(...a);
globalThis.copyTxHash          = (...a) => TxHistory.copyTxHash(...a);
globalThis.getTxScopeKey       = getTxScopeKey;
globalThis.getTxExplorerBaseUrl = getTxExplorerBaseUrl;

// Send
globalThis.showSendScreen      = () => SendFlow.showSendScreen();
globalThis.resetSendFlowUI     = (...a) => SendFlow.resetSendFlowUI(...a);
globalThis.sendTransaction     = () => SendFlow.sendTransaction();
globalThis.confirmSend         = () => SendFlow.confirmSend();
globalThis.cancelSend          = () => SendFlow.cancelSend();

// Balance
globalThis.refreshBalance      = () => RefreshLoop.refreshBalance();

// Misc
globalThis.copyAddress         = copyAddress;
globalThis.resetWallet         = resetWallet;
globalThis.openConnectedSites  = openConnectedSites;
globalThis.saveEtherscanKeyFromInput = saveEtherscanKeyFromInput;
globalThis.formatAmount        = formatAmount;
globalThis.shortAddr           = shortAddr;

// Network delegations (used by modules and event-binder)
globalThis.getRpcUrlForNetwork     = (...a) => NS.getRpcUrlForNetwork(...a);
globalThis.getCurrentNetworkMeta   = () => NS.getCurrentNetworkMeta();
globalThis.getNativeAssetSymbol    = (...a) => NS.getNativeAssetSymbol(...a);
globalThis.ensureMainnetSendGuard  = () => NS.ensureMainnetSendGuard();
globalThis.syncNetworkControls     = () => NS.syncNetworkControls();

// ── Bootstrap ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => Bootstrap.init());
