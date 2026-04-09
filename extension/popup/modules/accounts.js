(function () {
  'use strict';

  // ── Account management ────────────────────────────────────────────────
  // Cache, account menu, switching, sub-account creation.

  const PopupState = globalThis.WolfPopupSharedState || {};
  const _getLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).getLocal(...a);
  const _setLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).setLocal(...a);
  const _setAvatar = (...a) => (globalThis.WolfPopupAvatar || globalThis).setAvatar(...a);
  const _shortAddr = (...a) => typeof globalThis.shortAddr === 'function' ? globalThis.shortAddr(...a) : '';
  const _showScreen = (...a) => (globalThis.WolfPopupUiState || globalThis).showScreen(...a);
  const _showError = (...a) => (globalThis.WolfPopupUiMessages || globalThis).showError(...a);
  const _setStatus = (...a) => (globalThis.WolfPopupUiMessages || globalThis).setStatus(...a);
  const _setLoading = (...a) => (globalThis.WolfPopupUiMessages || globalThis).setLoading(...a);
  const _clearMessages = (...a) => (globalThis.WolfPopupUiMessages || globalThis).clearMessages(...a);
  const _sendToSW = (...a) => globalThis.sendToSW(...a);

  let _accountsCache = null;

  async function getAccountsCached(forceRefresh = false) {
    if (!forceRefresh && Array.isArray(_accountsCache)) {
      return _accountsCache;
    }
    const { accounts = [] } = await _getLocal(['accounts']);
    _accountsCache = Array.isArray(accounts) ? accounts : [];
    return _accountsCache;
  }

  function setAccountsCache(accounts) {
    _accountsCache = Array.isArray(accounts) ? accounts : [];
  }

  // ── Account menu ──────────────────────────────────────────────────────
  async function toggleAccountMenu() {
    const menu = document.getElementById('acct-menu');
    if (menu.classList.contains('hidden')) {
      await renderAccountMenu();
      menu.classList.remove('hidden');
    } else {
      menu.classList.add('hidden');
    }
  }

  async function renderAccountMenu() {
    const { accounts = [] } = await _getLocal(['accounts']);
    const listEl = document.getElementById('acct-list');
    listEl.textContent = '';

    accounts.forEach((acct, i) => {
      const item = document.createElement('div');
      item.className = 'acct-item' + (i === PopupState.activeAccountIndex ? ' active' : '');
      item.addEventListener('click', () => switchAccount(i));

      const avatarEl = document.createElement('div');
      avatarEl.className = 'avatar avatar-sm';
      avatarEl.id = `acct-av-${i}`;

      const infoEl = document.createElement('div');
      infoEl.style.flex = '1';

      const nameEl = document.createElement('div');
      nameEl.className = 'acct-item-name';
      nameEl.textContent = acct.name;

      const addrEl = document.createElement('div');
      addrEl.className = 'acct-item-addr';
      addrEl.textContent = _shortAddr(acct.address);

      infoEl.appendChild(nameEl);
      infoEl.appendChild(addrEl);
      item.appendChild(avatarEl);
      item.appendChild(infoEl);

      if (i === PopupState.activeAccountIndex) {
        const check = document.createElement('span');
        check.className = 'acct-item-check';
        check.textContent = '✓';
        item.appendChild(check);
      }

      listEl.appendChild(item);
    });

    accounts.forEach((_, i) => _setAvatar(`acct-av-${i}`, accounts[i].address));
  }

  // ── Switch account ────────────────────────────────────────────────────
  async function switchAccount(idx) {
    const { accounts = [] } = await _getLocal(['accounts']);
    if (idx >= accounts.length) return;

    PopupState.activeAccountIndex = idx;
    await _setLocal({ activeAccount: idx });
    if (typeof globalThis.stopAutoRefresh === 'function') globalThis.stopAutoRefresh();

    const targetAccount = accounts[idx];
    const targetAddress = targetAccount.address;
    const targetName = targetAccount.name || `Account ${idx + 1}`;

    if (typeof globalThis.ensureActiveAccountInSW === 'function' &&
        await globalThis.ensureActiveAccountInSW(targetAddress, idx)) {
      _showScreen('screen-wallet');
      if (typeof globalThis.loadWalletScreen === 'function') globalThis.loadWalletScreen(targetAddress);
      return;
    }

    await chrome.storage.session.clear();
    _setAvatar('unlock-avatar', targetAddress);
    document.getElementById('unlock-address').textContent = `${targetName} · ${_shortAddr(targetAddress)}`;
    document.getElementById('unlock-password').value = '';
    _clearMessages('unlock');
    _setStatus('unlock', `Введите пароль для ${targetName}`);
    _showScreen('screen-unlock');
    setTimeout(() => document.getElementById('unlock-password')?.focus(), 50);
  }

  // ── Add sub-account ───────────────────────────────────────────────────
  async function addSubAccount() {
    const password = document.getElementById('add-account-password').value;
    _clearMessages('add-account');
    if (!password) { _showError('add-account', 'Введите пароль'); return; }

    _setLoading('btn-add-account', true);
    _setStatus('add-account', 'Создание субаккаунта…');

    const result = await _sendToSW({ type: 'add-sub-account', password });

    if (!result?.ok) {
      const msg = result?.error?.includes('password') || result?.error?.includes('пароль')
        ? 'Неверный пароль'
        : (result?.error || 'Ошибка');
      _showError('add-account', msg);
      _setLoading('btn-add-account', false);
      _setStatus('add-account', '');
      return;
    }

    const { accounts = [] } = await _getLocal(['accounts']);
    accounts.push({ address: result.address, keystore: result.keystore, name: `Account ${result.index + 1}` });
    PopupState.activeAccountIndex = result.index;
    await _setLocal({ accounts, activeAccount: result.index });
    setAccountsCache(accounts);

    document.getElementById('add-account-password').value = '';
    _setLoading('btn-add-account', false);
    _setStatus('add-account', '');
    _showScreen('screen-wallet');
    if (typeof globalThis.loadWalletScreen === 'function') globalThis.loadWalletScreen(result.address);
  }

  // Expose
  globalThis.getAccountsCached = getAccountsCached;
  globalThis.setAccountsCache = setAccountsCache;
  globalThis.toggleAccountMenu = toggleAccountMenu;
  globalThis.switchAccount = switchAccount;
  globalThis.addSubAccount = addSubAccount;

  globalThis.WolfPopupAccounts = {
    getAccountsCached,
    setAccountsCache,
    toggleAccountMenu,
    renderAccountMenu,
    switchAccount,
    addSubAccount,
  };
})();
