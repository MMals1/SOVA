'use strict';

import { WolfPopupStorage } from './storage.js';
import { WolfPopupSharedState } from './popup-state.js';
import { WolfPopupNetworkState } from './network-state.js';
import { WolfPopupI18n } from './i18n.js';
import { WolfPopupTemplates } from './ui-templates.js';
import { WolfPopupEventBinder } from './event-binder.js';

// ── Settings screen logic ─────────────────────────────────────────────
// Управляет языком, RPC/Etherscan ключами и подключёнными сайтами
// из единого экрана настроек.

const _getLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).getLocal(...a);
const _setLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).setLocal(...a);
const PopupState = globalThis.WolfPopupSharedState || {};

// ── Language toggle ───────────────────────────────────────────────────
function setAppLang(lang) {
  const i18n = globalThis.WolfPopupI18n;
  if (!i18n) return;
  i18n.setLang(lang);
  _updateLangButtons(lang);
}

function _updateLangButtons(lang) {
  const ru = document.getElementById('lang-btn-ru');
  const en = document.getElementById('lang-btn-en');
  if (ru) ru.classList.toggle('active', lang === 'ru');
  if (en) en.classList.toggle('active', lang === 'en');
}

// ── RPC / Etherscan key management in settings ────────────────────────
// Синхронизирует поля settings screen с текущими значениями из storage.

async function initSettingsScreen() {
  const ns = globalThis.WolfPopupNetworkState;
  if (!ns) return;

  // Sync language buttons
  const i18n = globalThis.WolfPopupI18n;
  if (i18n) _updateLangButtons(i18n.getLang());

  // Sync RPC checkbox + custom URL
  const customRpc = PopupState.rpcByNetwork?.[PopupState.selectedNetwork] || '';
  const useDefault = !customRpc;
  const cb = document.getElementById('settings-use-default-key');
  const field = document.getElementById('settings-custom-key-field');
  const input = document.getElementById('settings-custom-rpc-url');
  if (cb) cb.checked = useDefault;
  if (field) field.style.display = useDefault ? 'none' : 'block';
  if (input) {
    input.value = customRpc;
    input.placeholder = ns.getCurrentNetworkMeta()?.defaultRpcUrl || '';
  }

  // Sync Etherscan key
  const ethKey = document.getElementById('settings-etherscan-key');
  if (ethKey) {
    const { etherscanApiKey } = await _getLocal(['etherscanApiKey']);
    ethKey.value = typeof etherscanApiKey === 'string' ? etherscanApiKey : '';
  }

  // Render connected sites
  const dapp = globalThis.WolfPopupDappApproval;
  if (dapp && typeof dapp.renderConnectedSitesList === 'function') {
    dapp.renderConnectedSitesList('settings-connected-sites-list');
  }

  // Render network picker for settings
  const templates = globalThis.WolfPopupTemplates;
  if (templates && typeof templates.renderNetworkPickers === 'function') {
    templates.renderNetworkPickers({
      contexts: ['settings'],
      defaultNetworkKey: ns.DEFAULT_NETWORK_KEY,
      networkKeys: ['eth-mainnet', 'eth-sepolia', 'bsc'],
      networks: ns.NETWORKS,
      optionResolver: ns.getNetworkPickerOption,
    });
    ns.applyNetworkPickerState('settings', PopupState.selectedNetwork);
    // Rebind event handlers for newly-rendered network picker DOM elements.
    // bindDeclarativeHandlers() вызывается при bootstrap, но settings picker
    // рендерится позже — новые data-onclick элементы не имеют listeners.
    const eventBinder = globalThis.WolfPopupEventBinder;
    if (eventBinder) eventBinder.bindDeclarativeHandlers();
  }

  // 1.3: Load daily limit UI
  await _loadDailyLimitUI();
}

function settingsToggleCustomKey() {
  const useDefault = document.getElementById('settings-use-default-key')?.checked;
  const field = document.getElementById('settings-custom-key-field');
  if (field) field.style.display = useDefault ? 'none' : 'block';
}

async function settingsSaveKeys() {
  const ns = globalThis.WolfPopupNetworkState;
  if (!ns) return;

  // Save custom RPC
  const useDefault = document.getElementById('settings-use-default-key')?.checked;
  const customUrl = document.getElementById('settings-custom-rpc-url')?.value?.trim() || '';

  if (useDefault) {
    delete PopupState.rpcByNetwork[PopupState.selectedNetwork];
  } else if (customUrl) {
    // Validate URL
    if (!customUrl.startsWith('https://')) {
      const msg = globalThis.WolfPopupUiMessages;
      if (msg) msg.showError('settings-keys', 'URL должен начинаться с https://');
      return;
    }
    PopupState.rpcByNetwork[PopupState.selectedNetwork] = customUrl;
  }
  await _setLocal({ rpcByNetwork: PopupState.rpcByNetwork });

  // Update provider
  PopupState.provider =
    typeof globalThis.getOrCreatePopupProvider === 'function'
      ? globalThis.getOrCreatePopupProvider(ns.getRpcUrlForNetwork(PopupState.selectedNetwork))
      : new ethers.JsonRpcProvider(ns.getRpcUrlForNetwork(PopupState.selectedNetwork));

  // Save Etherscan key
  const ethKey = document.getElementById('settings-etherscan-key')?.value?.trim() || '';
  await ns.saveEtherscanKey(ethKey);

  // Also sync the setup screen fields (если пользователь вернётся в setup)
  const setupCb = document.getElementById('use-default-key');
  const setupRpc = document.getElementById('custom-rpc-url');
  const setupEth = document.getElementById('etherscan-api-key');
  if (setupCb) setupCb.checked = useDefault;
  if (setupRpc) setupRpc.value = customUrl;
  if (setupEth) setupEth.value = ethKey;

  // Visual feedback — кнопка мигает зелёным
  const btn = document.querySelector('#screen-settings [data-onclick="settingsSaveKeys()"]');
  if (btn) {
    const origText = btn.textContent;
    btn.textContent = '✓';
    btn.style.color = '#4ade80';
    setTimeout(() => {
      btn.textContent = origText;
      btn.style.color = '';
    }, 1200);
  }

  // Refresh wallet data with new RPC
  if (typeof globalThis.refreshBalance === 'function') {
    globalThis.refreshBalance();
  }
}

// ── 1.3: Daily spending limit UI ──────────────────────────────────────
const DEFAULT_DAILY_LIMIT = 0.1;

async function _loadDailyLimitUI() {
  const input = document.getElementById('settings-daily-limit');
  const spentEl = document.getElementById('settings-daily-spent');
  if (!input) return;

  const { dailyLimitEth, dailySpending = {} } = await _getLocal(['dailyLimitEth', 'dailySpending']);
  const limit =
    dailyLimitEth != null &&
    Number.isFinite(parseFloat(dailyLimitEth)) &&
    parseFloat(dailyLimitEth) > 0
      ? parseFloat(dailyLimitEth)
      : DEFAULT_DAILY_LIMIT;
  input.value = limit;

  // Show today's spending
  if (spentEl) {
    const networkKey = PopupState.selectedNetwork || 'eth-sepolia';
    const entry = dailySpending[networkKey];
    const today = new Date().toISOString().slice(0, 10);
    const spent = entry && entry.date === today ? parseFloat(entry.total) || 0 : 0;
    const ns = globalThis.WolfPopupNetworkState;
    const symbol =
      ns && typeof ns.getNativeAssetSymbol === 'function' ? ns.getNativeAssetSymbol() : 'ETH';
    spentEl.textContent = `Потрачено сегодня: ${spent.toFixed(4)} / ${limit} ${symbol}`;
  }
}

async function settingsSaveDailyLimit() {
  const input = document.getElementById('settings-daily-limit');
  if (!input) return;
  const val = parseFloat(input.value);
  if (!Number.isFinite(val) || val <= 0) {
    input.style.borderColor = '#ef4444';
    setTimeout(() => {
      input.style.borderColor = '';
    }, 1500);
    return;
  }
  await _setLocal({ dailyLimitEth: val });
  input.style.borderColor = '#4ade80';
  setTimeout(() => {
    input.style.borderColor = '';
  }, 1200);
  // Refresh the displayed status
  await _loadDailyLimitUI();
}

// Expose
globalThis.setAppLang = setAppLang;
globalThis.settingsToggleCustomKey = settingsToggleCustomKey;
globalThis.settingsSaveKeys = settingsSaveKeys;
globalThis.settingsSaveDailyLimit = settingsSaveDailyLimit;

export const WolfPopupSettings = {
  setAppLang,
  initSettingsScreen,
  settingsToggleCustomKey,
  settingsSaveKeys,
  settingsSaveDailyLimit,
};
globalThis.WolfPopupSettings = WolfPopupSettings;
