'use strict';

import { WolfPopupSharedState } from './popup-state.js';
import { WolfPopupStorage } from './storage.js';
import { WolfPopupUiMessages } from './ui-messages.js';
import { WolfPopupNetworkState } from './network-state.js';
import { WolfPopupTokenState } from './token-state.js';
import { WolfPopupSendValidation } from './send-validation.js';
import { WolfPopupAssetPicker } from './asset-picker.js';

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

async function _getAccounts() {
  if (typeof globalThis.getAccountsCached === 'function') {
    return globalThis.getAccountsCached();
  }
  const { accounts = [] } = await getLocal(['accounts']);
  return Array.isArray(accounts) ? accounts : [];
}

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
const setStatus = _UiMessages
  ? _UiMessages.setStatus.bind(_UiMessages)
  : (p, m) => {
      const el = document.getElementById(`${p}-status`);
      if (el) {
        el.textContent = m;
        el.style.display = m ? 'block' : 'none';
      }
    };
const showSuccess = _UiMessages
  ? _UiMessages.showSuccess.bind(_UiMessages)
  : (p, m) => {
      const el = document.getElementById(`${p}-success`);
      if (el) {
        el.textContent = '✓ ' + m;
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
const setLoading = _UiMessages
  ? _UiMessages.setLoading.bind(_UiMessages)
  : (id, l) => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = l;
    };

// Cross-module access via globalThis
const Validation = globalThis.WolfPopupSendValidation;
const AssetPicker = globalThis.WolfPopupAssetPicker;

let _pendingTx = null;

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

async function _getTokensForSelectedNetwork() {
  const ts = globalThis.WolfPopupTokenState;
  return ts ? ts.getTokensForSelectedNetwork() : [];
}

function _getERC20ABI() {
  return (
    globalThis.WolfPopupTokenState?.ERC20_ABI || [
      'function balanceOf(address owner) view returns (uint256)',
      'function transfer(address to, uint256 value) returns (bool)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function name() view returns (string)',
    ]
  );
}

// ── Show / reset ────────────────────────────────────────────────
/**
 * Navigate to the send screen, populating the asset picker with
 * the native asset and all ERC-20 tokens for the selected network.
 * @returns {Promise<void>}
 */
async function showSendScreen() {
  const ap = globalThis.WolfPopupAssetPicker || AssetPicker;
  const options = await ap.buildOptionsForNetwork();
  ap.buildAssetPicker(options);

  resetSendFlowUI({ clearInputs: true });
  if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-send');
}

/**
 * Reset the send-flow UI state (pending tx, messages, confirm fields).
 * @param {object} [options]
 * @param {boolean} [options.clearInputs=false] -- also clear the recipient / amount inputs
 */
function resetSendFlowUI({ clearInputs = false } = {}) {
  _pendingTx = null;
  clearMessages('send');
  clearMessages('confirm');

  const confirmIds = [
    'confirm-to',
    'confirm-amount',
    'confirm-asset',
    'confirm-gas-estimate',
    'confirm-total',
  ];
  confirmIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });

  if (!clearInputs) return;

  const toEl = document.getElementById('send-to');
  const amountEl = document.getElementById('send-amount');
  if (toEl) toEl.value = '';
  if (amountEl) amountEl.value = '';
  const ap = globalThis.WolfPopupAssetPicker || AssetPicker;
  if (ap) ap.resetToFirst();
}

/**
 * Step 1 of the send flow: validate inputs, estimate gas, and
 * display the confirmation screen. On error -- shows inline message.
 * @returns {Promise<void>}
 */
async function sendTransaction() {
  const accounts = await _getAccounts();
  const activeAddress = accounts[PopupState.activeAccountIndex]?.address;

  const ensureFn = globalThis.ensureActiveAccountInSW;
  if (
    !activeAddress ||
    (typeof ensureFn === 'function' &&
      !(await ensureFn(activeAddress, PopupState.activeAccountIndex)))
  ) {
    if (typeof globalThis.handleSWLocked === 'function') await globalThis.handleSWLocked();
    return;
  }

  const to = document.getElementById('send-to').value.trim();
  const amount = document.getElementById('send-amount').value.trim();
  const asset = document.getElementById('send-asset').value;

  clearMessages('send');
  clearMessages('confirm');
  if (!ethers.isAddress(to)) {
    showError('send', 'Неверный адрес получателя');
    return;
  }
  // MED-12: строгая валидация суммы.
  // Защита от:
  //  - 'Infinity' -> parseFloat('Infinity') === Infinity, проходит >0
  //  - '1e-30' -> 1e-30 > 0, но < 1 wei, ethers.parseEther падает
  //  - '123abc' -> parseFloat принимает частично
  //  - '  ' -> NaN
  if (!amount) {
    showError('send', 'Введите сумму');
    return;
  }
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    showError('send', 'Некорректный формат суммы');
    return;
  }
  const amountNum = parseFloat(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    showError('send', 'Сумма должна быть > 0');
    return;
  }

  const ensureGuardFn = globalThis.WolfPopupNetworkState?.ensureMainnetSendGuard;
  if (typeof ensureGuardFn === 'function' && !(await ensureGuardFn())) return;

  setLoading('btn-send', true);
  setStatus('send', 'Оценка газа…');

  try {
    const nativeSymbol = _getNativeAssetSymbol();
    let gasEstimateWei, assetLabel, token;

    if (asset === 'ETH') {
      assetLabel = nativeSymbol;
      const txRequest = {
        to,
        value: ethers.parseEther(amount),
        chainId: _getCurrentNetworkMeta().chainId,
      };
      gasEstimateWei = await PopupState.provider.estimateGas(txRequest);
    } else {
      const tokens = await _getTokensForSelectedNetwork();
      token = tokens.find((t) => t.address.toLowerCase() === asset.toLowerCase());
      if (!token) {
        showError('send', 'Токен не найден');
        return;
      }
      assetLabel = token.symbol;
      const contract = new ethers.Contract(token.address, _getERC20ABI(), PopupState.provider);
      const accts = await _getAccounts();
      const from = accts[PopupState.activeAccountIndex]?.address;
      const data = contract.interface.encodeFunctionData('transfer', [
        to,
        ethers.parseUnits(amount, token.decimals),
      ]);
      gasEstimateWei = await PopupState.provider.estimateGas({ from, to: token.address, data });
    }

    const feeData = await PopupState.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    const gasCostWei = gasEstimateWei * gasPrice;
    const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));

    const totalText =
      asset === 'ETH'
        ? `${_formatAmount(parseFloat(amount) + gasCostEth)} ${nativeSymbol}`
        : `${amount} ${assetLabel} + ${_formatAmount(gasCostEth)} ${nativeSymbol} (газ)`;

    _pendingTx = { to, amount, asset, token: token || null };

    document.getElementById('confirm-to').textContent = to;
    document.getElementById('confirm-amount').textContent = `${amount}`;
    document.getElementById('confirm-asset').textContent = assetLabel;
    document.getElementById('confirm-gas-estimate').textContent =
      `~${_formatAmount(gasCostEth)} ${nativeSymbol}`;
    document.getElementById('confirm-total').textContent = totalText;

    // 1.2: Проверка — отправляем ли на новый адрес
    const val = globalThis.WolfPopupSendValidation || Validation;
    const warningEl = document.getElementById('new-recipient-warning');
    const confirmBtn = document.getElementById('btn-confirm-send');
    const isNew = await val.isFirstTimeRecipient(to);
    if (warningEl) warningEl.style.display = isNew ? 'flex' : 'none';
    if (isNew && confirmBtn) {
      // Задержка кнопки 5 сек — защита от импульсной отправки
      confirmBtn.disabled = true;
      confirmBtn.dataset.originalText = confirmBtn.textContent;
      let remaining = 5;
      confirmBtn.textContent = `Подождите (${remaining})`;
      const interval = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          confirmBtn.textContent = `Подождите (${remaining})`;
        } else {
          clearInterval(interval);
          confirmBtn.disabled = false;
          confirmBtn.textContent = confirmBtn.dataset.originalText || 'Подтвердить';
        }
      }, 1000);
    }

    clearMessages('send');
    if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-confirm-tx');
  } catch (e) {
    if (e.message?.includes('insufficient funds')) {
      showError('send', 'Недостаточно средств');
    } else {
      showError('send', 'Ошибка оценки газа');
    }
  } finally {
    setLoading('btn-send', false);
    setStatus('send', '');
  }
}

/**
 * Step 2 of the send flow: re-authenticate on mainnet, check daily
 * limit, then sign & broadcast the pending transaction via the
 * service worker (software accounts) or WebHID (Ledger accounts).
 * @returns {Promise<void>}
 */
async function confirmSend() {
  if (!_pendingTx) {
    if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-send');
    return;
  }

  const val = globalThis.WolfPopupSendValidation || Validation;

  // 1.1: На mainnet (chainId 1, 56) требуем повторный ввод пароля
  const reauthOk = await val.requireMainnetReauth();
  if (!reauthOk) return;

  // 1.3: Проверяем дневной лимит (ETH native — фактическая сумма)
  const sendAmountEth = _pendingTx.asset === 'ETH' ? parseFloat(_pendingTx.amount) : 0;
  const limitOk = await val.checkDailyLimit(sendAmountEth);
  if (!limitOk) return;

  const sendToSW = globalThis.sendToSW;
  if (typeof sendToSW === 'function') sendToSW({ type: MessageType.RESET_LOCK_TIMER });
  clearMessages('confirm');
  setLoading('btn-confirm-send', true);
  setStatus('confirm', 'Подпись и отправка…');

  try {
    const { to, amount, asset, token } = _pendingTx;

    // ── Ledger accounts: sign in popup via WebHID ────────────
    const ledgerUi = globalThis.WolfPopupLedgerUi;
    if (
      ledgerUi &&
      typeof ledgerUi.isActiveLedgerAccount === 'function' &&
      (await ledgerUi.isActiveLedgerAccount())
    ) {
      setStatus('confirm', 'Подтвердите на Ledger…');
      const provider = PopupState.provider;
      const accounts = await _getAccounts();
      const from = accounts[PopupState.activeAccountIndex]?.address;
      const feeData = await provider.getFeeData();
      const nonce = await provider.getTransactionCount(from, 'pending');
      const chainId = _getCurrentNetworkMeta().chainId;

      let txParams;
      if (asset === 'ETH') {
        txParams = {
          to,
          value: ethers.parseEther(amount),
          data: '0x',
          chainId,
          nonce,
          gasLimit: await provider.estimateGas({ from, to, value: ethers.parseEther(amount) }),
          maxFeePerGas: feeData.maxFeePerGas ?? feeData.gasPrice,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
        };
      } else {
        const contract = new ethers.Contract(token.address, _getERC20ABI(), provider);
        const data = contract.interface.encodeFunctionData('transfer', [
          to,
          ethers.parseUnits(amount, token.decimals),
        ]);
        txParams = {
          to: token.address,
          value: 0n,
          data,
          chainId,
          nonce,
          gasLimit: await provider.estimateGas({ from, to: token.address, data }),
          maxFeePerGas: feeData.maxFeePerGas ?? feeData.gasPrice,
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 0n,
        };
      }

      const result = await ledgerUi.signAndSendTransaction(txParams);
      if (!result?.ok) {
        showError('confirm', result?.error || 'Ошибка отправки');
        return;
      }

      _pendingTx = null;
      val.markRecipientKnown(to).catch(() => {});
      if (asset === 'ETH') val.recordSpending(parseFloat(amount)).catch(() => {});
      showSuccess('confirm', `Отправлено! ${result.hash.slice(0, 20)}…`);
      const bus = globalThis.WolfPopupEventBus;
      if (bus) bus.emit(bus.Events.TX_SENT, { hash: result.hash, to, value: amount });

      setTimeout(async () => {
        if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-wallet');
        const accts = await _getAccounts();
        if (typeof globalThis.loadWalletScreen === 'function') {
          globalThis.loadWalletScreen(accts[PopupState.activeAccountIndex].address);
        }
      }, 2000);
      return;
    }

    // ── Software accounts: delegate to SW ────────────────────
    let result;

    if (asset === 'ETH') {
      result = await sendToSW({ type: MessageType.SEND_ETH, to, amount });
    } else {
      result = await sendToSW({
        type: MessageType.SEND_ERC20,
        to,
        amount,
        tokenAddress: token.address,
        decimals: token.decimals,
      });
    }

    if (!result?.ok) {
      if (result?.error === 'locked') {
        _pendingTx = null;
        if (typeof globalThis.handleSWLocked === 'function') await globalThis.handleSWLocked();
        return;
      }
      let errMsg = 'Ошибка отправки';
      if (result?.error?.includes('insufficient funds')) errMsg = 'Недостаточно средств';
      else if (result?.error?.includes('nonce')) errMsg = 'Ошибка nonce — попробуйте ещё раз';
      showError('confirm', errMsg);
      return;
    }

    _pendingTx = null;
    // 1.2: Запоминаем получателя как известного после успешной отправки
    val.markRecipientKnown(to).catch(() => {});
    // 1.3: Записываем расход в дневной лимит
    if (asset === 'ETH') val.recordSpending(parseFloat(amount)).catch(() => {});
    showSuccess('confirm', `Отправлено! ${result.hash.slice(0, 20)}…`);
    const bus = globalThis.WolfPopupEventBus;
    if (bus) bus.emit(bus.Events.TX_SENT, { hash: result.hash, to, value: amount });

    setTimeout(async () => {
      if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-wallet');
      const accounts = await _getAccounts();
      if (typeof globalThis.loadWalletScreen === 'function') {
        globalThis.loadWalletScreen(accounts[PopupState.activeAccountIndex].address);
      }
    }, 2000);
  } catch {
    showError('confirm', 'Ошибка отправки');
  } finally {
    setLoading('btn-confirm-send', false);
    setStatus('confirm', '');
  }
}

/**
 * Cancel the pending transaction and navigate back to the send screen.
 */
function cancelSend() {
  _pendingTx = null;
  if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-send');
}

export const WolfPopupSendFlow = {
  showSendScreen,
  resetSendFlowUI,
  sendTransaction,
  confirmSend,
  cancelSend,
};
globalThis.WolfPopupSendFlow = WolfPopupSendFlow;
