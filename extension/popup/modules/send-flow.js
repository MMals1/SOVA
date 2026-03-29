(function () {
  'use strict';

  const PopupState = globalThis.WolfPopupSharedState || {
    provider: null, activeAccountIndex: 0, selectedChain: 'ethereum',
    selectedNetwork: 'eth-sepolia', rpcByNetwork: {},
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
    : (p, m) => { const el = document.getElementById(`${p}-error`); if (el) { el.textContent = m; el.style.display = 'block'; } };
  const setStatus = _UiMessages
    ? _UiMessages.setStatus.bind(_UiMessages)
    : (p, m) => { const el = document.getElementById(`${p}-status`); if (el) { el.textContent = m; el.style.display = m ? 'block' : 'none'; } };
  const showSuccess = _UiMessages
    ? _UiMessages.showSuccess.bind(_UiMessages)
    : (p, m) => { const el = document.getElementById(`${p}-success`); if (el) { el.textContent = '✓ ' + m; el.style.display = 'block'; } };
  const clearMessages = _UiMessages
    ? _UiMessages.clearMessages.bind(_UiMessages)
    : (p) => { ['error', 'status', 'success'].forEach(t => { const el = document.getElementById(`${p}-${t}`); if (el) el.style.display = 'none'; }); };
  const setLoading = _UiMessages
    ? _UiMessages.setLoading.bind(_UiMessages)
    : (id, l) => { const btn = document.getElementById(id); if (btn) btn.disabled = l; };

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
    return globalThis.WolfPopupTokenState?.ERC20_ABI || [
      'function balanceOf(address owner) view returns (uint256)',
      'function transfer(address to, uint256 value) returns (bool)',
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)',
      'function name() view returns (string)',
    ];
  }

  async function showSendScreen() {
    const tokens = await _getTokensForSelectedNetwork();
    const select = document.getElementById('send-asset');
    select.textContent = '';
    const nativeSymbol = _getNativeAssetSymbol();

    const ethOpt = document.createElement('option');
    ethOpt.value = 'ETH';
    ethOpt.textContent = `${nativeSymbol} (Native)`;
    select.appendChild(ethOpt);

    tokens.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.address;
      opt.textContent = `${t.symbol} (ERC-20)`;
      select.appendChild(opt);
    });

    resetSendFlowUI({ clearInputs: true });
    if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-send');
  }

  function resetSendFlowUI({ clearInputs = false } = {}) {
    _pendingTx = null;
    clearMessages('send');
    clearMessages('confirm');

    const confirmIds = ['confirm-to', 'confirm-amount', 'confirm-asset', 'confirm-gas-estimate', 'confirm-total'];
    confirmIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = '';
    });

    if (!clearInputs) return;

    const toEl = document.getElementById('send-to');
    const amountEl = document.getElementById('send-amount');
    const assetEl = document.getElementById('send-asset');
    if (toEl) toEl.value = '';
    if (amountEl) amountEl.value = '';
    if (assetEl) assetEl.selectedIndex = 0;
  }

  // Шаг 1: валидация, оценка газа, показ экрана подтверждения
  async function sendTransaction() {
    const accounts = await _getAccounts();
    const activeAddress = accounts[PopupState.activeAccountIndex]?.address;

    const ensureFn = globalThis.ensureActiveAccountInSW;
    if (!activeAddress || (typeof ensureFn === 'function' && !(await ensureFn(activeAddress, PopupState.activeAccountIndex)))) {
      if (typeof globalThis.handleSWLocked === 'function') await globalThis.handleSWLocked();
      return;
    }

    const to = document.getElementById('send-to').value.trim();
    const amount = document.getElementById('send-amount').value.trim();
    const asset = document.getElementById('send-asset').value;

    clearMessages('send');
    clearMessages('confirm');
    if (!ethers.isAddress(to)) { showError('send', 'Неверный адрес получателя'); return; }
    if (!amount || parseFloat(amount) <= 0) { showError('send', 'Введите корректную сумму'); return; }

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
        token = tokens.find(t => t.address.toLowerCase() === asset.toLowerCase());
        if (!token) { showError('send', 'Токен не найден'); return; }
        assetLabel = token.symbol;
        const contract = new ethers.Contract(token.address, _getERC20ABI(), PopupState.provider);
        const accts = await _getAccounts();
        const from = accts[PopupState.activeAccountIndex]?.address;
        const data = contract.interface.encodeFunctionData('transfer', [
          to, ethers.parseUnits(amount, token.decimals),
        ]);
        gasEstimateWei = await PopupState.provider.estimateGas({ from, to: token.address, data });
      }

      const feeData = await PopupState.provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
      const gasCostWei = gasEstimateWei * gasPrice;
      const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));

      const totalText = asset === 'ETH'
        ? `${_formatAmount(parseFloat(amount) + gasCostEth)} ${nativeSymbol}`
        : `${amount} ${assetLabel} + ${_formatAmount(gasCostEth)} ${nativeSymbol} (газ)`;

      _pendingTx = { to, amount, asset, token: token || null };

      document.getElementById('confirm-to').textContent = to;
      document.getElementById('confirm-amount').textContent = `${amount}`;
      document.getElementById('confirm-asset').textContent = assetLabel;
      document.getElementById('confirm-gas-estimate').textContent = `~${_formatAmount(gasCostEth)} ${nativeSymbol}`;
      document.getElementById('confirm-total').textContent = totalText;

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

  // Шаг 2: пользователь подтвердил — отправляем в SW
  async function confirmSend() {
    if (!_pendingTx) {
      if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-send');
      return;
    }
    const sendToSW = globalThis.sendToSW;
    if (typeof sendToSW === 'function') sendToSW({ type: 'reset-lock-timer' });
    clearMessages('confirm');
    setLoading('btn-confirm-send', true);
    setStatus('confirm', 'Подпись и отправка…');

    try {
      const { to, amount, asset, token } = _pendingTx;
      let result;

      if (asset === 'ETH') {
        result = await sendToSW({ type: 'send-eth', to, amount });
      } else {
        result = await sendToSW({
          type: 'send-erc20', to, amount,
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
      showSuccess('confirm', `Отправлено! ${result.hash.slice(0, 20)}…`);

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

  // Отмена — возврат к экрану отправки
  function cancelSend() {
    _pendingTx = null;
    if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-send');
  }

  globalThis.WolfPopupSendFlow = {
    showSendScreen, resetSendFlowUI, sendTransaction, confirmSend, cancelSend,
  };
})();
