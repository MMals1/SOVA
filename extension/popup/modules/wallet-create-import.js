(function () {
  'use strict';

  // ── Wallet creation & import ──────────────────────────────────────────
  // Генерация нового кошелька (createRandom) и импорт по мнемонической фразе.

  const PopupState = globalThis.WolfPopupSharedState || {};
  const _showScreen = (...a) => (globalThis.WolfPopupUiState || globalThis).showScreen(...a);
  const _showError = (...a) => (globalThis.WolfPopupUiMessages || globalThis).showError(...a);
  const _setStatus = (...a) => (globalThis.WolfPopupUiMessages || globalThis).setStatus(...a);
  const _setLoading = (...a) => (globalThis.WolfPopupUiMessages || globalThis).setLoading(...a);
  const _clearMessages = (...a) => (globalThis.WolfPopupUiMessages || globalThis).clearMessages(...a);
  const _setLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).setLocal(...a);
  const _sendToSW = (...a) => globalThis.sendToSW(...a);
  const _getAccountsCached = (...a) => typeof globalThis.getAccountsCached === 'function' ? globalThis.getAccountsCached(...a) : [];
  const _setAccountsCache = (...a) => typeof globalThis.setAccountsCache === 'function' ? globalThis.setAccountsCache(...a) : undefined;

  function _validatePassword(password) {
    if (password.length < 8)        return 'Пароль минимум 8 символов';
    if (!/[A-Z]/.test(password))    return 'Нужна хотя бы одна заглавная буква';
    if (!/[a-z]/.test(password))    return 'Нужна хотя бы одна строчная буква';
    if (!/[0-9]/.test(password))    return 'Нужна хотя бы одна цифра';
    return null;
  }

  async function createWallet() {
    const password = document.getElementById('create-password').value;
    _clearMessages('create');
    const pwErr = _validatePassword(password);
    if (pwErr) { _showError('create', pwErr); return; }

    const ns = globalThis.WolfPopupNetworkState;
    const rpcChoice = ns._readRpcChoice();
    if (!rpcChoice.ok) { _showError('create', rpcChoice.error); return; }

    _setLoading('btn-create', true);
    _setStatus('create', 'Генерация ключей…');

    try {
      const wallet = ethers.Wallet.createRandom();
      const mnemonic = wallet.mnemonic.phrase;

      _setStatus('create', 'Шифрование keystore…');
      const keystore = await wallet.encrypt(password);

      const accounts = await _getAccountsCached(true);
      accounts.push({ address: wallet.address, keystore, name: `Account ${accounts.length + 1}` });
      _setAccountsCache(accounts);
      PopupState.activeAccountIndex = accounts.length - 1;
      await _setLocal({ accounts, activeAccount: PopupState.activeAccountIndex });

      await ns._saveRpcChoice(rpcChoice);
      await ns.saveEtherscanKey(ns._readEtherscanKeyFromUi());
      await _sendToSW({ type: 'unlock', password, accountIndex: PopupState.activeAccountIndex });

      const qf = globalThis.WolfPopupQuizFlow;
      if (qf) qf.setPendingMnemonic(mnemonic);
      document.getElementById('mnemonic-display').textContent = mnemonic;
      _clearMessages('create');
      _showScreen('screen-mnemonic');

    } catch (e) {
      _showError('create', 'Ошибка: ' + e.message);
    } finally {
      _setLoading('btn-create', false);
      _setStatus('create', '');
    }
  }

  async function importWallet() {
    const mnemonic = document.getElementById('import-mnemonic').value.trim();
    const password = document.getElementById('import-password').value;
    _clearMessages('import');
    if (!mnemonic) { _showError('import', 'Введите мнемоническую фразу'); return; }
    const pwErr = _validatePassword(password);
    if (pwErr) { _showError('import', pwErr); return; }

    const ns = globalThis.WolfPopupNetworkState;
    const rpcChoice = ns._readRpcChoice();
    if (!rpcChoice.ok) { _showError('import', rpcChoice.error); return; }

    _setLoading('btn-import', true);
    _setStatus('import', 'Проверка фразы…');

    try {
      let wallet;
      try {
        wallet = ethers.Wallet.fromPhrase(mnemonic);
      } catch {
        _showError('import', 'Неверная мнемоническая фраза');
        return;
      }

      _setStatus('import', 'Шифрование keystore…');
      const keystore = await wallet.encrypt(password);

      const accounts = await _getAccountsCached(true);
      accounts.push({ address: wallet.address, keystore, name: `Account ${accounts.length + 1}` });
      _setAccountsCache(accounts);
      PopupState.activeAccountIndex = accounts.length - 1;
      await _setLocal({ accounts, activeAccount: PopupState.activeAccountIndex });

      await ns._saveRpcChoice(rpcChoice);
      await ns.saveEtherscanKey(ns._readEtherscanKeyFromUi());
      await _sendToSW({ type: 'unlock', password, accountIndex: PopupState.activeAccountIndex });

      _clearMessages('import');
      _showScreen('screen-wallet');
      if (typeof globalThis.loadWalletScreen === 'function') {
        globalThis.loadWalletScreen(wallet.address);
      }

    } catch (e) {
      _showError('import', 'Ошибка: ' + e.message);
    } finally {
      _setLoading('btn-import', false);
      _setStatus('import', '');
    }
  }

  globalThis.createWallet = createWallet;
  globalThis.importWallet = importWallet;

  globalThis.WolfPopupWalletCreateImport = {
    createWallet,
    importWallet,
    _validatePassword,
  };
})();
