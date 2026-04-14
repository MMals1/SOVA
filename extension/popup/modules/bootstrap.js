'use strict';

import { WolfPopupSharedState } from './popup-state.js';
import { WolfPopupStorage } from './storage.js';

// ── Bootstrap: module assertion + DOMContentLoaded init ────────────────
// Оркестратор загрузки popup. Проверяет наличие всех модулей, рендерит
// шаблоны, инициализирует сеть, решает какой экран показать (setup /
// unlock / wallet / dapp-approval).

const PopupState = globalThis.WolfPopupSharedState || {};
const _getLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).getLocal(...a);
const _setLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).setLocal(...a);
const _getSession = (...a) => (globalThis.WolfPopupStorage || globalThis).getSession(...a);
const _setSession = (...a) => (globalThis.WolfPopupStorage || globalThis).setSession(...a);
const _setAvatar = (...a) => (globalThis.WolfPopupAvatar || globalThis).setAvatar(...a);
const _showScreen = (...a) => (globalThis.WolfPopupUiState || globalThis).showScreen(...a);
const _clearMessages = (...a) => (globalThis.WolfPopupUiMessages || globalThis).clearMessages(...a);
const _setStatus = (...a) => (globalThis.WolfPopupUiMessages || globalThis).setStatus(...a);
const _shortAddr = (...a) =>
  typeof globalThis.shortAddr === 'function' ? globalThis.shortAddr(...a) : '';

const AUTO_LOCK_MINUTES = 5;

function assertModulesLoaded() {
  const requirements = {
    WolfPopupStorage: ['getLocal', 'setLocal', 'removeLocal', 'getSession', 'setSession'],
    WolfPopupUiMessages: ['showError', 'setStatus', 'showSuccess', 'clearMessages', 'setLoading'],
    WolfPopupAvatar: ['setAvatar'],
    WolfPopupClipboard: ['copyText'],
    WolfPopupTemplates: ['renderNetworkPickers', 'renderFeedbackMounts'],
    WolfPopupSharedState: [],
    WolfPopupNetworkState: [
      'initializeNetworkState',
      'getRpcUrlForNetwork',
      'getCurrentNetworkMeta',
      'setNetwork',
    ],
    WolfPopupTxHistory: ['loadTransactions', 'fetchAlchemyTransfers', 'renderTransactions'],
    WolfPopupTokenState: ['getTokensForSelectedNetwork', 'loadTokenBalances', 'fetchTokenInfo'],
    WolfPopupSendFlow: ['sendTransaction', 'confirmSend', 'showSendScreen'],
    WolfPopupUiState: ['showScreen', 'switchTab', 'switchWalletTab'],
    WolfPopupEventBinder: ['bindDeclarativeHandlers'],
    WolfPopupDappApproval: ['getRequestIdFromUrl', 'handleRequest', 'renderConnectedSitesList'],
  };
  for (const [name, methods] of Object.entries(requirements)) {
    const mod = globalThis[name];
    if (!mod)
      throw new Error(`Required module not loaded: ${name}. Check popup.html script order.`);
    for (const m of methods) {
      if (typeof mod[m] !== 'function')
        throw new Error(`${name}.${m} is missing or not a function`);
    }
  }
}

function _showErrorOverlay(msg) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'padding:24px;color:#f87171;font-family:monospace;';
  const title = document.createElement('h2');
  title.textContent = 'Ошибка инициализации SOVA Wallet';
  const p = document.createElement('p');
  p.style.cssText = 'margin-top:12px;font-size:13px;color:#888;word-break:break-all;';
  p.textContent = msg;
  overlay.appendChild(title);
  overlay.appendChild(p);
  document.body.appendChild(overlay);
}

async function init() {
  // Assert modules
  try {
    assertModulesLoaded();
  } catch (e) {
    console.error('[SOVA bootstrap]', e);
    document.body.replaceChildren();
    _showErrorOverlay(e.message);
    return;
  }

  const ns = globalThis.WolfPopupNetworkState;
  const templates = globalThis.WolfPopupTemplates;
  const eventBinder = globalThis.WolfPopupEventBinder;
  const dapp = globalThis.WolfPopupDappApproval;

  try {
    // Load saved language BEFORE rendering any UI
    const i18n = globalThis.WolfPopupI18n;
    if (i18n) await i18n.loadLang();

    templates.renderNetworkPickers({
      contexts: ['setup', 'wallet', 'settings'],
      defaultNetworkKey: ns.DEFAULT_NETWORK_KEY,
      networkKeys: ['eth-mainnet', 'eth-sepolia', 'bsc'],
      networks: ns.NETWORKS,
      optionResolver: ns.getNetworkPickerOption,
    });
    templates.renderFeedbackMounts();
    eventBinder.bindDeclarativeHandlers();
    await ns.initializeNetworkState();

    PopupState.provider =
      typeof globalThis.getOrCreatePopupProvider === 'function'
        ? globalThis.getOrCreatePopupProvider(ns.getRpcUrlForNetwork(PopupState.selectedNetwork))
        : new ethers.JsonRpcProvider(ns.getRpcUrlForNetwork(PopupState.selectedNetwork));

    ns.initNetworkPickerInteractions();
    ns.syncNetworkControls();
    ns.loadEtherscanKeyIntoUi().catch(() => {});

    // Apply language after all DOM is ready
    if (i18n) i18n.applyLang();

    // 1.5: Init auto-lock picker
    if (typeof globalThis._initAutoLockPicker === 'function') {
      globalThis._initAutoLockPicker().catch(() => {});
    }

    // dApp approval mode
    const dappRequestId = dapp.getRequestIdFromUrl();
    if (dappRequestId) {
      _showScreen('screen-dapp-approval');
      dapp.handleRequest(dappRequestId);
      return;
    }

    // Legacy migration
    const legacy = await _getLocal(['keystore', 'address', 'accounts', 'activeAccount']);
    if (legacy.keystore && legacy.address && !legacy.accounts) {
      await _setLocal({
        accounts: [{ address: legacy.address, keystore: legacy.keystore, name: 'Account 1' }],
        activeAccount: 0,
      });
    }

    const accounts = await (typeof globalThis.getAccountsCached === 'function'
      ? globalThis.getAccountsCached(true)
      : _getLocal(['accounts']).then((r) => r.accounts || []));
    if (!accounts || accounts.length === 0) {
      _showScreen('screen-setup');
      return;
    }

    const { activeAccount } = await _getLocal(['activeAccount']);
    PopupState.activeAccountIndex =
      activeAccount != null && activeAccount < accounts.length ? activeAccount : 0;

    const current = accounts[PopupState.activeAccountIndex];
    if (!current?.address) {
      console.error('[popup] stored account has no address', {
        idx: PopupState.activeAccountIndex,
        total: accounts.length,
      });
      _showScreen('screen-setup');
      return;
    }
    const currentName = current.name || `Account ${PopupState.activeAccountIndex + 1}`;
    const { unlocked, unlockTime } = await _getSession(['unlocked', 'unlockTime']);
    const expired = !unlockTime || Date.now() - unlockTime > AUTO_LOCK_MINUTES * 60 * 1000;

    const goToUnlockFor = (acctName, acctAddress, statusText) => {
      _setAvatar('unlock-avatar', acctAddress);
      document.getElementById('unlock-address').textContent =
        `${acctName} · ${_shortAddr(acctAddress)}`;
      document.getElementById('unlock-password').value = '';
      _clearMessages('unlock');
      if (statusText) _setStatus('unlock', statusText);
      _showScreen('screen-unlock');
      setTimeout(() => document.getElementById('unlock-password')?.focus(), 50);
    };

    if (!unlocked || expired) {
      goToUnlockFor(
        currentName,
        current.address,
        expired && unlocked ? 'Сессия истекла — войдите снова' : null,
      );
    } else {
      const ensureFn =
        typeof globalThis.ensureActiveAccountInSW === 'function'
          ? globalThis.ensureActiveAccountInSW
          : () => false;
      if (await ensureFn(current.address, PopupState.activeAccountIndex)) {
        await _setSession({ unlockTime: Date.now() });
        _showScreen('screen-wallet');
        if (typeof globalThis.loadWalletScreen === 'function') {
          globalThis.loadWalletScreen(current.address);
        }
      } else {
        await chrome.storage.session.clear();
        goToUnlockFor(currentName, current.address, 'Сессия обновлена — введите пароль');
      }
    }
  } catch (initErr) {
    console.error('[SOVA popup init]', initErr);
    _showErrorOverlay(initErr.message || String(initErr));
  }
}

export const WolfPopupBootstrap = {
  assertModulesLoaded,
  init,
};
globalThis.WolfPopupBootstrap = WolfPopupBootstrap;
