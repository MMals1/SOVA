(function () {
  'use strict';

  const PopupState = globalThis.WolfPopupSharedState || {
    provider: null, activeAccountIndex: 0, selectedChain: 'ethereum',
    selectedNetwork: 'eth-sepolia', rpcByNetwork: {},
  };
  const WalletCore = (globalThis.WolfWalletCore && typeof globalThis.WolfWalletCore === 'object')
    ? globalThis.WolfWalletCore : {};

  const _Storage = globalThis.WolfPopupStorage;
  const getLocal = _Storage
    ? _Storage.getLocal.bind(_Storage)
    : (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
  const setLocal = _Storage
    ? _Storage.setLocal.bind(_Storage)
    : (data) => new Promise((r) => chrome.storage.local.set(data, r));
  const removeLocal = _Storage
    ? _Storage.removeLocal.bind(_Storage)
    : (keys) => new Promise((r) => chrome.storage.local.remove(keys, r));

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
  const clearMessages = _UiMessages
    ? _UiMessages.clearMessages.bind(_UiMessages)
    : (p) => { ['error', 'status', 'success'].forEach(t => { const el = document.getElementById(`${p}-${t}`); if (el) el.style.display = 'none'; }); };

  const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint256)',
    'function transfer(address to, uint256 value) returns (bool)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function name() view returns (string)',
  ];

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

  async function getTokensForSelectedNetwork() {
    const { tokensByNetwork = {}, tokens: legacyTokens = [] } = await getLocal(['tokensByNetwork', 'tokens']);
    let map = (tokensByNetwork && typeof tokensByNetwork === 'object') ? { ...tokensByNetwork } : {};

    if ((!map[PopupState.selectedNetwork] || !Array.isArray(map[PopupState.selectedNetwork]))
        && Array.isArray(legacyTokens) && legacyTokens.length) {
      map[PopupState.selectedNetwork] = legacyTokens;
      await setLocal({ tokensByNetwork: map });
      await removeLocal('tokens');
    }

    if (typeof WalletCore.getTokensForNetwork === 'function') {
      return WalletCore.getTokensForNetwork(map, PopupState.selectedNetwork);
    }
    return Array.isArray(map[PopupState.selectedNetwork]) ? map[PopupState.selectedNetwork] : [];
  }

  async function setTokensForSelectedNetwork(tokens) {
    const { tokensByNetwork = {} } = await getLocal(['tokensByNetwork']);
    const map = (typeof WalletCore.setTokensForNetwork === 'function')
      ? WalletCore.setTokensForNetwork(tokensByNetwork, PopupState.selectedNetwork, tokens)
      : {
        ...(tokensByNetwork && typeof tokensByNetwork === 'object' ? tokensByNetwork : {}),
        [PopupState.selectedNetwork]: Array.isArray(tokens) ? tokens : [],
      };
    await setLocal({ tokensByNetwork: map });
  }

  function getTokenLogoUrls(tokenAddress, networkKey) {
    const nk = (networkKey !== undefined) ? networkKey : PopupState.selectedNetwork;
    if (!tokenAddress) return [];
    if (!String(nk).startsWith('eth-') && nk !== 'bsc') return [];
    try {
      const checksum = ethers.getAddress(tokenAddress);
      if (typeof WalletCore.getTokenLogoUrls === 'function') {
        return WalletCore.getTokenLogoUrls(checksum, nk);
      }
      const lower = checksum.toLowerCase();
      if (nk === 'bsc') {
        return [
          `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/${checksum}/logo.png`,
          `https://tokens.1inch.io/${lower}.png`,
        ];
      }
      return [
        `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${checksum}/logo.png`,
        `https://tokens.1inch.io/${lower}.png`,
      ];
    } catch {
      return [];
    }
  }

  async function loadTokenBalances(address) {
    const tokens = await getTokensForSelectedNetwork();
    const el = document.getElementById('token-list');
    el.textContent = '';

    if (!tokens.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Нет добавленных токенов';
      el.appendChild(p);
      return;
    }

    tokens.forEach(t => {
      const id = t.address.slice(2, 10);

      const item = document.createElement('div');
      item.className = 'token-item';

      const left = document.createElement('div');
      left.className = 'token-left';

      const icon = document.createElement('div');
      icon.className = 'token-icon';

      const iconImg = document.createElement('img');
      iconImg.className = 'token-icon-img';
      iconImg.alt = `${t.symbol} logo`;
      iconImg.loading = 'lazy';

      const iconFallback = document.createElement('span');
      iconFallback.className = 'token-icon-fallback';
      iconFallback.textContent = t.symbol.slice(0, 4);

      const logoUrls = getTokenLogoUrls(t.address, PopupState.selectedNetwork);
      if (logoUrls.length) {
        let logoIndex = 0;
        const tryNextLogo = () => {
          if (logoIndex >= logoUrls.length) {
            iconImg.style.display = 'none';
            iconFallback.style.display = 'inline-flex';
            return;
          }
          iconImg.src = logoUrls[logoIndex++];
        };
        iconImg.addEventListener('load', () => {
          iconImg.style.display = 'block';
          iconFallback.style.display = 'none';
        });
        iconImg.addEventListener('error', tryNextLogo);
        tryNextLogo();
      }

      icon.appendChild(iconImg);
      icon.appendChild(iconFallback);

      const info = document.createElement('div');

      const symEl = document.createElement('div');
      symEl.className = 'token-symbol';
      symEl.textContent = t.symbol;

      const addrEl = document.createElement('div');
      addrEl.className = 'token-addr';
      addrEl.textContent = t.address.slice(0, 10) + '…';

      info.appendChild(symEl);
      info.appendChild(addrEl);
      left.appendChild(icon);
      left.appendChild(info);

      const balanceEl = document.createElement('span');
      balanceEl.className = 'token-balance';
      balanceEl.id = `tb-${id}`;
      balanceEl.textContent = '…';

      const removeBtn = document.createElement('button');
      removeBtn.className = 'token-remove';
      removeBtn.title = 'Удалить';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => removeToken(t.address));

      item.appendChild(left);
      item.appendChild(balanceEl);
      item.appendChild(removeBtn);
      el.appendChild(item);
    });

    await Promise.all(tokens.map(async t => {
      const id = t.address.slice(2, 10);
      try {
        const contract = new ethers.Contract(t.address, ERC20_ABI, PopupState.provider);
        const raw = await contract.balanceOf(address);
        const formatted = _formatAmount(parseFloat(ethers.formatUnits(raw, t.decimals)));
        const balEl = document.getElementById(`tb-${id}`);
        if (balEl) balEl.textContent = `${formatted} ${t.symbol}`;
      } catch {
        const balEl = document.getElementById(`tb-${id}`);
        if (balEl) balEl.textContent = '—';
      }
    }));
  }

  function onTokenAddrChange() {
    const val = document.getElementById('token-address').value.trim();
    document.getElementById('btn-fetch-token').disabled = !ethers.isAddress(val);
  }

  async function fetchTokenInfo() {
    const addr = document.getElementById('token-address').value.trim();
    clearMessages('add-token');
    if (!ethers.isAddress(addr)) { showError('add-token', 'Неверный адрес контракта'); return; }
    setStatus('add-token', 'Загрузка информации…');
    try {
      const c = new ethers.Contract(addr, ERC20_ABI, PopupState.provider);
      const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
      document.getElementById('token-symbol').value = symbol;
      document.getElementById('token-decimals').value = decimals.toString();
      setStatus('add-token', '');
    } catch {
      setStatus('add-token', '');
      showError('add-token', 'Не удалось загрузить информацию о токене');
    }
  }

  async function addToken() {
    const addr = document.getElementById('token-address').value.trim();
    const symbol = document.getElementById('token-symbol').value.trim().toUpperCase();
    const decimals = parseInt(document.getElementById('token-decimals').value) || 18;
    clearMessages('add-token');
    if (!ethers.isAddress(addr)) { showError('add-token', 'Неверный адрес контракта'); return; }
    if (!symbol) { showError('add-token', 'Введите символ токена'); return; }

    const tokens = await getTokensForSelectedNetwork();
    if (tokens.some(t => t.address.toLowerCase() === addr.toLowerCase())) {
      showError('add-token', 'Этот токен уже добавлен'); return;
    }
    tokens.push({ address: addr, symbol, decimals });
    await setTokensForSelectedNetwork(tokens);

    document.getElementById('token-address').value = '';
    document.getElementById('token-symbol').value = '';
    document.getElementById('token-decimals').value = '18';
    document.getElementById('btn-fetch-token').disabled = true;

    if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-wallet');
    const accounts = await _getAccounts();
    const address = accounts[PopupState.activeAccountIndex]?.address;
    if (address) {
      await loadTokenBalances(address);
      if (typeof globalThis.switchWalletTab === 'function') globalThis.switchWalletTab('tokens');
    }
  }

  async function removeToken(addr) {
    const tokens = await getTokensForSelectedNetwork();
    await setTokensForSelectedNetwork(tokens.filter(t => t.address.toLowerCase() !== addr.toLowerCase()));
    const accounts = await _getAccounts();
    const address = accounts[PopupState.activeAccountIndex]?.address;
    if (address) loadTokenBalances(address);
  }

  globalThis.WolfPopupTokenState = {
    ERC20_ABI,
    getTokensForSelectedNetwork, setTokensForSelectedNetwork, getTokenLogoUrls,
    loadTokenBalances, fetchTokenInfo, addToken, removeToken, onTokenAddrChange,
  };
})();
