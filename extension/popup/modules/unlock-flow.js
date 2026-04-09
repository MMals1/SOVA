(function () {
  'use strict';

  // ── Unlock / Lock / SW session management ─────────────────────────────
  // Управляет разблокировкой кошелька (пароль → SW → расшифровка keystore),
  // блокировкой и восстановлением сессии при idle-kill SW.

  const PopupState = globalThis.WolfPopupSharedState || {};

  // Lazy helpers — доступны через globalThis, определяются в popup.js или модулях.
  const _sendToSW = (...a) => globalThis.sendToSW(...a);
  const _showScreen = (...a) => (globalThis.WolfPopupUiState || globalThis).showScreen(...a);
  const _showError = (...a) => (globalThis.WolfPopupUiMessages || globalThis).showError(...a);
  const _setStatus = (...a) => (globalThis.WolfPopupUiMessages || globalThis).setStatus(...a);
  const _setLoading = (...a) => (globalThis.WolfPopupUiMessages || globalThis).setLoading(...a);
  const _clearMessages = (...a) => (globalThis.WolfPopupUiMessages || globalThis).clearMessages(...a);
  const _setAvatar = (...a) => (globalThis.WolfPopupAvatar || globalThis).setAvatar(...a);
  const _shortAddr = (...a) => typeof globalThis.shortAddr === 'function' ? globalThis.shortAddr(...a) : '';
  const _getLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).getLocal(...a);
  const _getAccountsCached = (...a) => typeof globalThis.getAccountsCached === 'function' ? globalThis.getAccountsCached(...a) : [];
  const _getSession = (...a) => (globalThis.WolfPopupStorage || globalThis).getSession(...a);
  const _loadWalletScreen = (...a) => typeof globalThis.loadWalletScreen === 'function' ? globalThis.loadWalletScreen(...a) : undefined;

  // ── unlockWallet ──────────────────────────────────────────────────────
  async function unlockWallet() {
    const password = document.getElementById('unlock-password').value;
    _clearMessages('unlock');
    if (!password) { _showError('unlock', 'Введите пароль'); return; }

    _setLoading('btn-unlock', true);
    _setStatus('unlock', 'Проверка пароля…');

    const result = await _sendToSW({ type: 'unlock', password, accountIndex: PopupState.activeAccountIndex });

    if (!result?.ok) {
      _showError('unlock', 'Неверный пароль');
      _setLoading('btn-unlock', false);
      _setStatus('unlock', '');
      return;
    }

    document.getElementById('unlock-password').value = '';
    _clearMessages('unlock');
    _setLoading('btn-unlock', false);
    _setStatus('unlock', '');

    const accounts = await _getAccountsCached();
    const acct = accounts[PopupState.activeAccountIndex];
    if (!acct?.address) {
      console.error('[popup] active account missing after unlock', { activeAccountIndex: PopupState.activeAccountIndex, total: accounts.length });
      _showScreen('screen-setup');
      return;
    }
    _showScreen('screen-wallet');
    _loadWalletScreen(acct.address);
  }

  // ── lockWallet ────────────────────────────────────────────────────────
  async function lockWallet() {
    await _sendToSW({ type: 'lock' });
    const { accounts } = await _getLocal(['accounts']);
    const acct = accounts[PopupState.activeAccountIndex];
    const address = acct?.address;
    const name = acct?.name || `Account ${PopupState.activeAccountIndex + 1}`;
    _setAvatar('unlock-avatar', address);
    document.getElementById('unlock-address').textContent = address ? `${name} · ${_shortAddr(address)}` : '';
    document.getElementById('unlock-password').value = '';
    _clearMessages('unlock');
    _showScreen('screen-unlock');
    setTimeout(() => document.getElementById('unlock-password')?.focus(), 50);
  }

  // ── isActiveAccountUnlocked ───────────────────────────────────────────
  async function isActiveAccountUnlocked(expectedAddress) {
    if (!expectedAddress) return false;
    const result = await _sendToSW({ type: 'get-wallet-address' });
    if (!result?.ok || !result.address) return false;
    return String(result.address).toLowerCase() === String(expectedAddress).toLowerCase();
  }

  // ── ensureActiveAccountInSW ───────────────────────────────────────────
  async function ensureActiveAccountInSW(expectedAddress, accountIndex) {
    if (!expectedAddress || accountIndex == null) return false;
    if (await isActiveAccountUnlocked(expectedAddress)) return true;
    const activated = await _sendToSW({ type: 'activate-account', accountIndex });
    if (!activated?.ok || !activated.activated) return false;
    return isActiveAccountUnlocked(expectedAddress);
  }

  // ── handleSWLocked ────────────────────────────────────────────────────
  // SW был убит Chrome'ом — сессия устарела, нужно разблокировать снова.
  async function handleSWLocked() {
    await chrome.storage.session.clear();
    const { accounts } = await _getLocal(['accounts']);
    const acct = accounts[PopupState.activeAccountIndex];
    const address = acct?.address;
    const name = acct?.name || `Account ${PopupState.activeAccountIndex + 1}`;
    _setAvatar('unlock-avatar', address);
    document.getElementById('unlock-address').textContent = address ? `${name} · ${_shortAddr(address)}` : '';
    document.getElementById('unlock-password').value = '';
    _clearMessages('unlock');
    _setStatus('unlock', 'Сессия обновлена — введите пароль');
    _showScreen('screen-unlock');
    setTimeout(() => document.getElementById('unlock-password')?.focus(), 50);
  }

  // Expose (send-flow.js вызывает globalThis.ensureActiveAccountInSW и handleSWLocked)
  globalThis.unlockWallet = unlockWallet;
  globalThis.lockWallet = lockWallet;
  globalThis.ensureActiveAccountInSW = ensureActiveAccountInSW;
  globalThis.handleSWLocked = handleSWLocked;

  globalThis.WolfPopupUnlockFlow = {
    unlockWallet,
    lockWallet,
    isActiveAccountUnlocked,
    ensureActiveAccountInSW,
    handleSWLocked,
  };
})();
