'use strict';

import { WolfPopupSharedState } from './popup-state.js';
import { WolfPopupStorage } from './storage.js';
import { WolfPopupUiMessages } from './ui-messages.js';
import { WolfPopupNetworkState } from './network-state.js';

const PopupState = globalThis.WolfPopupSharedState || {
  provider: null,
  activeAccountIndex: 0,
  selectedChain: 'ethereum',
  selectedNetwork: 'eth-sepolia',
  rpcByNetwork: {},
};

const _Storage = globalThis.WolfPopupStorage;
const getLocal = _Storage
  ? _Storage.getLocal.bind(_Storage)
  : (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
const _setLocal = _Storage
  ? _Storage.setLocal.bind(_Storage)
  : (data) => new Promise((r) => chrome.storage.local.set(data, r));

const _UiMessages = globalThis.WolfPopupUiMessages;
const showError = _UiMessages
  ? _UiMessages.showError.bind(_UiMessages)
  : (p, m) => {
      const el = document.getElementById(`${p}-error`);
      if (el) {
        el.textContent = m;
        el.style.display = 'block';
      }
    };
const clearMessages = _UiMessages
  ? _UiMessages.clearMessages.bind(_UiMessages)
  : (p) => {
      ['error', 'status', 'success'].forEach((t) => {
        const el = document.getElementById(`${p}-${t}`);
        if (el) el.style.display = 'none';
      });
    };

function _formatAmount(value) {
  if (typeof globalThis.formatAmount === 'function') return globalThis.formatAmount(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  let s;
  if (abs >= 1000) s = value.toFixed(2);
  else if (abs >= 1) s = value.toFixed(4);
  else if (abs >= 0.000001) s = value.toFixed(6);
  else return '< 0.000001';
  return s.replace(/\.?0+$/, '');
}

function _getNativeAssetSymbol() {
  const ns = globalThis.WolfPopupNetworkState;
  if (ns) return ns.getNativeAssetSymbol();
  return PopupState.selectedNetwork === 'bsc' ? 'BNB' : 'ETH';
}

function _getCurrentNetworkMeta() {
  const ns = globalThis.WolfPopupNetworkState;
  if (ns) return ns.getCurrentNetworkMeta();
  return { chainId: 11155111, isTestnet: true, label: 'Ethereum Sepolia' };
}

// ── 1.2: Known recipients (per-network scope) ────────────────────────────
// Хранилище: chrome.storage.local.knownRecipients.{networkKey}.{address} = timestamp
async function isFirstTimeRecipient(address) {
  try {
    const networkKey = PopupState.selectedNetwork || 'eth-sepolia';
    const { knownRecipients = {} } = await getLocal(['knownRecipients']);
    const networkMap = knownRecipients[networkKey] || {};
    return !networkMap[String(address).toLowerCase()];
  } catch {
    return false;
  }
}

async function markRecipientKnown(address) {
  try {
    const networkKey = PopupState.selectedNetwork || 'eth-sepolia';
    const { knownRecipients = {} } = await getLocal(['knownRecipients']);
    if (!knownRecipients[networkKey]) knownRecipients[networkKey] = {};
    knownRecipients[networkKey][String(address).toLowerCase()] = Date.now();
    await _setLocal({ knownRecipients });
  } catch {
    /* ignore */
  }
}

// ── 1.3: Дневной лимит расходов ────────────────────────────────────────
const DEFAULT_DAILY_LIMIT_ETH = 0.1;

function _todayKey() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

async function getDailySpending() {
  try {
    const { dailySpending = {} } = await getLocal(['dailySpending']);
    const networkKey = PopupState.selectedNetwork || 'eth-sepolia';
    const entry = dailySpending[networkKey];
    if (!entry || entry.date !== _todayKey()) return 0;
    return parseFloat(entry.total) || 0;
  } catch {
    return 0;
  }
}

async function getDailyLimit() {
  try {
    const { dailyLimitEth } = await getLocal(['dailyLimitEth']);
    if (
      dailyLimitEth != null &&
      Number.isFinite(parseFloat(dailyLimitEth)) &&
      parseFloat(dailyLimitEth) > 0
    ) {
      return parseFloat(dailyLimitEth);
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_DAILY_LIMIT_ETH;
}

async function recordSpending(amountEth) {
  try {
    const networkKey = PopupState.selectedNetwork || 'eth-sepolia';
    const today = _todayKey();
    const { dailySpending = {} } = await getLocal(['dailySpending']);
    const entry = dailySpending[networkKey];
    const current = entry && entry.date === today ? parseFloat(entry.total) || 0 : 0;
    dailySpending[networkKey] = { date: today, total: String(current + amountEth) };
    await _setLocal({ dailySpending });
  } catch {
    /* ignore */
  }
}

// Проверяет лимит. Если лимит исчерпан — показывает re-auth. Для testnet — пропускает.
async function checkDailyLimit(amountEth) {
  const meta = _getCurrentNetworkMeta();
  if (!meta || meta.isTestnet) return true;

  const limit = await getDailyLimit();
  const spent = await getDailySpending();
  if (spent + amountEth <= limit) return true;

  // Лимит превышен — предупреждение + re-auth
  const remaining = Math.max(0, limit - spent);
  showError(
    'confirm',
    `Дневной лимит ${_formatAmount(limit)} ${_getNativeAssetSymbol()} будет превышен ` +
      `(потрачено ${_formatAmount(spent)}, осталось ${_formatAmount(remaining)}). Введите пароль.`,
  );
  const reauthOk = await requireMainnetReauth();
  if (reauthOk) clearMessages('confirm');
  return reauthOk;
}

// ── 1.1: Re-auth для mainnet-транзакций ─────────────────────────────────
// Возвращает Promise<boolean>: true — пароль верен, false — отменено/ошибка.
// На testnet пропускает проверку.
function requireMainnetReauth() {
  const meta = _getCurrentNetworkMeta();
  if (!meta || meta.isTestnet) return Promise.resolve(true);

  return new Promise((resolve) => {
    const overlay = document.getElementById('reauth-overlay');
    const input = document.getElementById('reauth-password');
    const errorEl = document.getElementById('reauth-error');
    const confirmBtn = document.getElementById('reauth-confirm');
    const cancelBtn = document.getElementById('reauth-cancel');
    if (!overlay || !input) return resolve(true); // fallback: пропустить если DOM не найден

    // Сброс
    input.value = '';
    errorEl.style.display = 'none';
    errorEl.textContent = '';
    confirmBtn.disabled = false;
    overlay.style.display = 'flex';
    input.focus();

    function cleanup() {
      overlay.style.display = 'none';
      input.value = '';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
    }

    async function onConfirm() {
      const password = input.value;
      if (!password) {
        errorEl.textContent = 'Введите пароль';
        errorEl.style.display = 'block';
        return;
      }
      confirmBtn.disabled = true;
      errorEl.style.display = 'none';
      try {
        const sendToSW = globalThis.sendToSW;
        const result = await sendToSW({
          type: MessageType.VERIFY_PASSWORD,
          password,
          accountIndex: PopupState.activeAccountIndex,
        });
        if (result?.ok) {
          cleanup();
          resolve(true);
        } else {
          errorEl.textContent = result?.error || 'Неверный пароль';
          errorEl.style.display = 'block';
          confirmBtn.disabled = false;
          input.value = '';
          input.focus();
        }
      } catch (e) {
        errorEl.textContent = e.message || 'Ошибка проверки';
        errorEl.style.display = 'block';
        confirmBtn.disabled = false;
        input.value = '';
        input.focus();
      }
    }

    function onCancel() {
      cleanup();
      resolve(false);
    }

    function onKeydown(e) {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    }

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  });
}

export const WolfPopupSendValidation = {
  isFirstTimeRecipient,
  markRecipientKnown,
  getDailySpending,
  getDailyLimit,
  recordSpending,
  checkDailyLimit,
  requireMainnetReauth,
  DEFAULT_DAILY_LIMIT_ETH,
};
globalThis.WolfPopupSendValidation = WolfPopupSendValidation;
