'use strict';

import { WolfPopupSharedState } from './popup-state.js';
import { WolfPopupStorage } from './storage.js';
import { WolfPopupUiMessages } from './ui-messages.js';

const PopupState = globalThis.WolfPopupSharedState || {
  provider: null,
  activeAccountIndex: 0,
  selectedChain: 'ethereum',
  selectedNetwork: 'eth-sepolia',
  rpcByNetwork: {},
};
const WalletCore =
  globalThis.WolfWalletCore && typeof globalThis.WolfWalletCore === 'object'
    ? globalThis.WolfWalletCore
    : {};

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
const _Clipboard = globalThis.WolfPopupClipboard;
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
const clearMessages = _UiMessages
  ? _UiMessages.clearMessages.bind(_UiMessages)
  : (p) => {
      ['error', 'status', 'success'].forEach((t) => {
        const el = document.getElementById(`${p}-${t}`);
        if (el) el.style.display = 'none';
      });
    };

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

/**
 * Return the list of user-added ERC-20 tokens for the currently
 * selected network.  Migrates legacy flat `tokens` storage on first call.
 * @returns {Promise<Array<{address: string, symbol: string, decimals: number}>>}
 */
async function getTokensForSelectedNetwork() {
  const { tokensByNetwork = {}, tokens: legacyTokens = [] } = await getLocal([
    'tokensByNetwork',
    'tokens',
  ]);
  const map = tokensByNetwork && typeof tokensByNetwork === 'object' ? { ...tokensByNetwork } : {};

  if (
    (!map[PopupState.selectedNetwork] || !Array.isArray(map[PopupState.selectedNetwork])) &&
    Array.isArray(legacyTokens) &&
    legacyTokens.length
  ) {
    map[PopupState.selectedNetwork] = legacyTokens;
    await setLocal({ tokensByNetwork: map });
    await removeLocal('tokens');
  }

  if (typeof WalletCore.getTokensForNetwork === 'function') {
    return WalletCore.getTokensForNetwork(map, PopupState.selectedNetwork);
  }
  return Array.isArray(map[PopupState.selectedNetwork]) ? map[PopupState.selectedNetwork] : [];
}

/**
 * Persist the token list for the currently selected network.
 * @param {Array<{address: string, symbol: string, decimals: number}>} tokens
 * @returns {Promise<void>}
 */
async function setTokensForSelectedNetwork(tokens) {
  const { tokensByNetwork = {} } = await getLocal(['tokensByNetwork']);
  const map =
    typeof WalletCore.setTokensForNetwork === 'function'
      ? WalletCore.setTokensForNetwork(tokensByNetwork, PopupState.selectedNetwork, tokens)
      : {
          ...(tokensByNetwork && typeof tokensByNetwork === 'object' ? tokensByNetwork : {}),
          [PopupState.selectedNetwork]: Array.isArray(tokens) ? tokens : [],
        };
  await setLocal({ tokensByNetwork: map });
}

/**
 * Return an ordered list of logo URLs to try for a given token address.
 * Falls back to Trust Wallet + 1inch CDN.
 * @param {string} tokenAddress — checksummed or lowercase ERC-20 address
 * @param {string} [networkKey] — defaults to the currently selected network
 * @returns {string[]}
 */
function getTokenLogoUrls(tokenAddress, networkKey) {
  const nk = networkKey !== undefined ? networkKey : PopupState.selectedNetwork;
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

/**
 * Fetch on-chain balances for all added tokens and render them
 * into the `#token-list` DOM container.
 * @param {string} address — the wallet address to query balances for
 * @returns {Promise<void>}
 */
async function loadTokenBalances(address) {
  const tokens = await getTokensForSelectedNetwork();
  const el = document.getElementById('token-list');

  if (!tokens.length) {
    // ВАЖНО: popup.html содержит initial placeholder <p class="empty">Загрузка…</p>
    // Нужно ВСЕГДА обновлять текст на "Нет добавленных токенов",
    // иначе пользователь видит вечную "Загрузка..." (bug fix).
    const existing = el.querySelector('.empty');
    if (existing) {
      existing.textContent = 'Нет добавленных токенов';
    } else {
      el.textContent = '';
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Нет добавленных токенов';
      el.appendChild(p);
    }
    return;
  }

  // Если набор токенов не изменился — обновляем только цифры
  const existingIds = [...el.querySelectorAll('.token-balance')].map((b) => b.id);
  const newIds = tokens.map((t) => `tb-${t.address.slice(2, 10)}`);
  const canUpdateInPlace =
    existingIds.length === newIds.length && existingIds.every((id, i) => id === newIds[i]);

  if (canUpdateInPlace) {
    await Promise.all(
      tokens.map(async (t) => {
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
      }),
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  tokens.forEach((t) => {
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

    const iconFallback = document.createElement('span');
    iconFallback.className = 'token-icon-fallback';
    iconFallback.textContent = t.symbol.slice(0, 4);

    const logoUrls = getTokenLogoUrls(t.address, PopupState.selectedNetwork);
    if (logoUrls.length) {
      // MED-9: timeout 3 сек на каждую попытку. Раньше slow CDN мог
      // подвесить иконку на минуты — теперь fail-fast и переход к fallback.
      const LOGO_LOAD_TIMEOUT_MS = 3000;
      let logoIndex = 0;
      let loadTimer = null;
      const clearLoadTimer = () => {
        if (loadTimer) {
          clearTimeout(loadTimer);
          loadTimer = null;
        }
      };
      const tryNextLogo = () => {
        clearLoadTimer();
        if (logoIndex >= logoUrls.length) {
          iconImg.style.display = 'none';
          iconFallback.style.display = 'inline-flex';
          return;
        }
        loadTimer = setTimeout(() => {
          tryNextLogo();
        }, LOGO_LOAD_TIMEOUT_MS);
        iconImg.src = logoUrls[logoIndex++];
      };
      iconImg.addEventListener('load', () => {
        clearLoadTimer();
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

    const addrLabel = document.createElement('span');
    addrLabel.textContent = `contract: ${t.address.slice(0, 6)}…${t.address.slice(-4)}`;
    addrEl.appendChild(addrLabel);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'token-copy-btn';
    copyBtn.textContent = 'copy';
    copyBtn.title = t.address;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_Clipboard) _Clipboard.copyText(t.address);
      copyBtn.textContent = '✓';
      setTimeout(() => {
        copyBtn.textContent = 'copy';
      }, 1000);
    });
    addrEl.appendChild(copyBtn);

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
    fragment.appendChild(item);
  });

  el.textContent = '';
  el.appendChild(fragment);

  await Promise.all(
    tokens.map(async (t) => {
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
    }),
  );
}

/**
 * Enable / disable the “Fetch” button based on the token address input validity.
 */
function onTokenAddrChange() {
  const val = document.getElementById('token-address').value.trim();
  document.getElementById('btn-fetch-token').disabled = !ethers.isAddress(val);
}

/**
 * Query on-chain `symbol()` and `decimals()` for an ERC-20 contract
 * and populate the add-token form fields.
 * @returns {Promise<void>}
 */
async function fetchTokenInfo() {
  const addr = document.getElementById('token-address').value.trim();
  clearMessages('add-token');
  if (!ethers.isAddress(addr)) {
    showError('add-token', 'Неверный адрес контракта');
    return;
  }
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

/**
 * Validate form inputs, add a new ERC-20 token to the per-network
 * token list, persist, and refresh the wallet screen.
 * @returns {Promise<void>}
 */
async function addToken() {
  const addr = document.getElementById('token-address').value.trim();
  const symbol = document.getElementById('token-symbol').value.trim().toUpperCase();
  const decimals = parseInt(document.getElementById('token-decimals').value) || 18;
  clearMessages('add-token');
  if (!ethers.isAddress(addr)) {
    showError('add-token', 'Неверный адрес контракта');
    return;
  }
  if (!symbol) {
    showError('add-token', 'Введите символ токена');
    return;
  }

  const tokens = await getTokensForSelectedNetwork();
  if (tokens.some((t) => t.address.toLowerCase() === addr.toLowerCase())) {
    showError('add-token', 'Этот токен уже добавлен');
    return;
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

/**
 * Remove a token by contract address from the current network’s list
 * and re-render token balances.
 * @param {string} addr — the ERC-20 contract address to remove
 * @returns {Promise<void>}
 */
async function removeToken(addr) {
  const tokens = await getTokensForSelectedNetwork();
  await setTokensForSelectedNetwork(
    tokens.filter((t) => t.address.toLowerCase() !== addr.toLowerCase()),
  );
  const accounts = await _getAccounts();
  const address = accounts[PopupState.activeAccountIndex]?.address;
  if (address) loadTokenBalances(address);
}

export const WolfPopupTokenState = {
  ERC20_ABI,
  getTokensForSelectedNetwork,
  setTokensForSelectedNetwork,
  getTokenLogoUrls,
  loadTokenBalances,
  fetchTokenInfo,
  addToken,
  removeToken,
  onTokenAddrChange,
};
globalThis.WolfPopupTokenState = WolfPopupTokenState;
