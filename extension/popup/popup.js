'use strict';

const RPC_DEFAULTS = (globalThis.WOLF_WALLET_RPC_DEFAULTS && typeof globalThis.WOLF_WALLET_RPC_DEFAULTS === 'object')
  ? globalThis.WOLF_WALLET_RPC_DEFAULTS
  : {};
const WalletCore = (globalThis.WolfWalletCore && typeof globalThis.WolfWalletCore === 'object')
  ? globalThis.WolfWalletCore
  : {};
const PopupStorage = (globalThis.WolfPopupStorage && typeof globalThis.WolfPopupStorage === 'object')
  ? globalThis.WolfPopupStorage
  : {
    getLocal(keys) { return new Promise((resolve) => chrome.storage.local.get(keys, resolve)); },
    setLocal(data) { return new Promise((resolve) => chrome.storage.local.set(data, resolve)); },
    removeLocal(keys) { return new Promise((resolve) => chrome.storage.local.remove(keys, resolve)); },
    getSession(keys) { return new Promise((resolve) => chrome.storage.session.get(keys, resolve)); },
    setSession(data) { return new Promise((resolve) => chrome.storage.session.set(data, resolve)); },
  };
const PopupUiMessages = (globalThis.WolfPopupUiMessages && typeof globalThis.WolfPopupUiMessages === 'object')
  ? globalThis.WolfPopupUiMessages
  : {
    showError(prefix, msg) {
      const el = document.getElementById(`${prefix}-error`);
      if (el) { el.textContent = msg; el.style.display = 'block'; }
    },
    setStatus(prefix, msg) {
      const el = document.getElementById(`${prefix}-status`);
      if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
    },
    showSuccess(prefix, msg) {
      const el = document.getElementById(`${prefix}-success`);
      if (el) { el.textContent = '✓ ' + msg; el.style.display = 'block'; }
    },
    clearMessages(prefix) {
      ['error', 'status', 'success'].forEach(type => {
        const el = document.getElementById(`${prefix}-${type}`);
        if (el) el.style.display = 'none';
      });
    },
    setLoading(btnId, loading) {
      const btn = document.getElementById(btnId);
      if (btn) btn.disabled = loading;
    },
  };
const PopupAvatar = (globalThis.WolfPopupAvatar && typeof globalThis.WolfPopupAvatar === 'object')
  ? globalThis.WolfPopupAvatar
  : {
    setAvatar() {},
  };
const PopupClipboard = (globalThis.WolfPopupClipboard && typeof globalThis.WolfPopupClipboard === 'object')
  ? globalThis.WolfPopupClipboard
  : {
    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        Object.assign(ta.style, { position: 'fixed', opacity: '0' });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      return true;
    },
  };
const PopupTemplates = (globalThis.WolfPopupTemplates && typeof globalThis.WolfPopupTemplates === 'object')
  ? globalThis.WolfPopupTemplates
  : {
    renderFeedbackMounts() {},
    renderNetworkPickers() {},
  };
const PopupState = (globalThis.WolfPopupSharedState && typeof globalThis.WolfPopupSharedState === 'object')
  ? globalThis.WolfPopupSharedState
  : {
    provider: null,
    activeAccountIndex: 0,
    selectedChain: 'ethereum',
    selectedNetwork: 'eth-sepolia',
    rpcByNetwork: {},
  };
const PopupNetworkState = (globalThis.WolfPopupNetworkState && typeof globalThis.WolfPopupNetworkState === 'object')
  ? globalThis.WolfPopupNetworkState
  : {};
const PopupTxHistory = (globalThis.WolfPopupTxHistory && typeof globalThis.WolfPopupTxHistory === 'object')
  ? globalThis.WolfPopupTxHistory
  : {};
const PopupTokenState = (globalThis.WolfPopupTokenState && typeof globalThis.WolfPopupTokenState === 'object')
  ? globalThis.WolfPopupTokenState
  : {};
const PopupSendFlow = (globalThis.WolfPopupSendFlow && typeof globalThis.WolfPopupSendFlow === 'object')
  ? globalThis.WolfPopupSendFlow
  : {};
const PopupUiState = (globalThis.WolfPopupUiState && typeof globalThis.WolfPopupUiState === 'object')
  ? globalThis.WolfPopupUiState
  : {};
const PopupEventBinder = (globalThis.WolfPopupEventBinder && typeof globalThis.WolfPopupEventBinder === 'object')
  ? globalThis.WolfPopupEventBinder
  : {};

const getLocal = PopupStorage.getLocal.bind(PopupStorage);
const setLocal = PopupStorage.setLocal.bind(PopupStorage);
const removeLocal = PopupStorage.removeLocal.bind(PopupStorage);
const getSession = PopupStorage.getSession.bind(PopupStorage);
const setSession = PopupStorage.setSession.bind(PopupStorage);

const showError = PopupUiMessages.showError.bind(PopupUiMessages);
const setStatus = PopupUiMessages.setStatus.bind(PopupUiMessages);
const showSuccess = PopupUiMessages.showSuccess.bind(PopupUiMessages);
const clearMessages = PopupUiMessages.clearMessages.bind(PopupUiMessages);
const setLoading = PopupUiMessages.setLoading.bind(PopupUiMessages);

const setAvatar = PopupAvatar.setAvatar.bind(PopupAvatar);
const copyText = PopupClipboard.copyText.bind(PopupClipboard);

function getDefaultRpcUrl(networkKey, fallback) {
  return RPC_DEFAULTS[networkKey] || fallback;
}

// ── Конфигурация ──────────────────────────────────────────────────────────────
const NETWORKS = (PopupNetworkState && PopupNetworkState.NETWORKS)
  ? PopupNetworkState.NETWORKS
  : {
    'eth-mainnet': {
      chain: 'ethereum',
      chainId: 1,
      label: 'Ethereum Mainnet',
      badge: 'Ethereum Mainnet',
      isTestnet: false,
      defaultRpcUrl: getDefaultRpcUrl('eth-mainnet', 'https://ethereum-rpc.publicnode.com'),
    },
    'eth-sepolia': {
      chain: 'ethereum',
      chainId: 11155111,
      label: 'Ethereum Sepolia',
      badge: 'Sepolia testnet',
      isTestnet: true,
      defaultRpcUrl: getDefaultRpcUrl('eth-sepolia', 'https://ethereum-sepolia-rpc.publicnode.com'),
    },
    bsc: {
      chain: 'bsc',
      chainId: 56,
      label: 'BNB Chain',
      badge: 'BNB Chain Mainnet',
      isTestnet: false,
      defaultRpcUrl: getDefaultRpcUrl('bsc', 'https://bnb-mainnet.g.alchemy.com/v2/lrmoWsP5qrMt8_aezkh4p'),
    },
  };
const DEFAULT_NETWORK_KEY = (PopupNetworkState && PopupNetworkState.DEFAULT_NETWORK_KEY)
  ? PopupNetworkState.DEFAULT_NETWORK_KEY
  : 'eth-sepolia';
const DEFAULT_CHAIN_KEY = (PopupNetworkState && PopupNetworkState.DEFAULT_CHAIN_KEY)
  ? PopupNetworkState.DEFAULT_CHAIN_KEY
  : 'ethereum';
const AUTO_LOCK_MINUTES = 5;
const TX_SYNC_STATE_KEY = 'txSyncState';
const TX_HISTORY_CACHE_KEY = 'txHistoryCache';
const TX_HISTORY_LIMIT = 1000;
const TX_PAGE_SIZE = 10;
const TX_INITIAL_MAX_COUNT = '0x3e8';
const TX_INCREMENTAL_MAX_COUNT = '0x64';
const LEGACY_MAINNET_SEND_GUARD_KEY = 'mainnetSendGuardAccepted';
const MAINNET_SEND_GUARD_KEY_PREFIX = 'mainnetSendGuardAccepted';
const NETWORK_PICKER_OPTIONS = {
  'eth-mainnet': { label: 'Ethereum Mainnet', mark: '🔷' },
  'eth-sepolia': { label: 'Ethereum Sepolia', mark: '◻️' },
  bsc: { label: 'BNB Chain', mark: '🟡' },
};

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
];

let provider = null;
let activeAccountIndex = 0;
let selectedChain = DEFAULT_CHAIN_KEY;
let selectedNetwork = DEFAULT_NETWORK_KEY;
let rpcByNetwork = {};
const AUTO_REFRESH_MIN_INTERVAL_MS = 12000;
const AUTO_REFRESH_FALLBACK_MS = 30000;

let _autoRefreshAddress = null;
let _autoRefreshBlockListener = null;
let _autoRefreshTimer = null;
let _autoRefreshInFlight = false;
let _lastAutoRefreshAt = 0;
let _accountsCache = null;
const _providerCache = new Map();
const _txLoadPromises = new Map();
const _txPaginationState = new Map();
const _txRenderedState = new Map();

// Keep module shared state in sync with popup runtime locals.
Object.defineProperties(PopupState, {
  provider: {
    configurable: true,
    get: () => provider,
    set: (value) => { provider = value; },
  },
  activeAccountIndex: {
    configurable: true,
    get: () => activeAccountIndex,
    set: (value) => { activeAccountIndex = value; },
  },
  selectedChain: {
    configurable: true,
    get: () => selectedChain,
    set: (value) => { selectedChain = value; },
  },
  selectedNetwork: {
    configurable: true,
    get: () => selectedNetwork,
    set: (value) => { selectedNetwork = value; },
  },
  rpcByNetwork: {
    configurable: true,
    get: () => rpcByNetwork,
    set: (value) => { rpcByNetwork = value; },
  },
});

globalThis.getAutoRefreshAddress = () => _autoRefreshAddress;
globalThis.getAccountsCached = getAccountsCached;
globalThis.setAccountsCache = setAccountsCache;

function getOrCreatePopupProvider(rpcUrl) {
  const key = String(rpcUrl || '').trim();
  if (!key) return new ethers.JsonRpcProvider(rpcUrl);
  const cached = _providerCache.get(key);
  if (cached) return cached;
  const created = new ethers.JsonRpcProvider(key);
  _providerCache.set(key, created);
  return created;
}

globalThis.getOrCreatePopupProvider = getOrCreatePopupProvider;

async function getAccountsCached(forceRefresh = false) {
  if (!forceRefresh && Array.isArray(_accountsCache)) {
    return _accountsCache;
  }
  const { accounts = [] } = await getLocal(['accounts']);
  _accountsCache = Array.isArray(accounts) ? accounts : [];
  return _accountsCache;
}

function setAccountsCache(accounts) {
  _accountsCache = Array.isArray(accounts) ? accounts : [];
}

function getTxScopeKey(address, networkKey = selectedNetwork) {
  if (typeof WalletCore.getTxScopeKey === 'function') {
    return WalletCore.getTxScopeKey(address, networkKey);
  }
  return `${networkKey}:${String(address).toLowerCase()}`;
}

function getTxExplorerBaseUrl(networkKey = selectedNetwork) {
  if (typeof WalletCore.getTxExplorerBaseUrl === 'function') {
    return WalletCore.getTxExplorerBaseUrl(networkKey);
  }
  if (networkKey === 'eth-mainnet') return 'https://etherscan.io/tx/';
  if (networkKey === 'eth-sepolia') return 'https://sepolia.etherscan.io/tx/';
  if (networkKey === 'bsc') return 'https://bscscan.com/tx/';
  return 'https://etherscan.io/tx/';
}

function getTokenLogoUrls(tokenAddress, networkKey = selectedNetwork) {
  if (!tokenAddress) return [];
  if (!String(networkKey).startsWith('eth-') && networkKey !== 'bsc') return [];
  try {
    const checksum = ethers.getAddress(tokenAddress);
    if (typeof WalletCore.getTokenLogoUrls === 'function') {
      return WalletCore.getTokenLogoUrls(checksum, networkKey);
    }
    const lower = checksum.toLowerCase();
    if (networkKey === 'bsc') {
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

async function getTokensForSelectedNetwork() {
  if (typeof PopupTokenState.getTokensForSelectedNetwork === 'function') {
    return PopupTokenState.getTokensForSelectedNetwork();
  }
  const { tokensByNetwork = {}, tokens: legacyTokens = [] } = await getLocal(['tokensByNetwork', 'tokens']);
  let map = (tokensByNetwork && typeof tokensByNetwork === 'object') ? { ...tokensByNetwork } : {};

  // Legacy migration: old global tokens -> active network tokens.
  if ((!map[selectedNetwork] || !Array.isArray(map[selectedNetwork])) && Array.isArray(legacyTokens) && legacyTokens.length) {
    map[selectedNetwork] = legacyTokens;
    await setLocal({ tokensByNetwork: map });
    await removeLocal('tokens');
  }

  if (typeof WalletCore.getTokensForNetwork === 'function') {
    return WalletCore.getTokensForNetwork(map, selectedNetwork);
  }
  return Array.isArray(map[selectedNetwork]) ? map[selectedNetwork] : [];
}

async function setTokensForSelectedNetwork(tokens) {
  if (typeof PopupTokenState.setTokensForSelectedNetwork === 'function') {
    return PopupTokenState.setTokensForSelectedNetwork(tokens);
  }
  const { tokensByNetwork = {} } = await getLocal(['tokensByNetwork']);
  const map = (typeof WalletCore.setTokensForNetwork === 'function')
    ? WalletCore.setTokensForNetwork(tokensByNetwork, selectedNetwork, tokens)
    : {
      ...(tokensByNetwork && typeof tokensByNetwork === 'object' ? tokensByNetwork : {}),
      [selectedNetwork]: Array.isArray(tokens) ? tokens : [],
    };
  await setLocal({ tokensByNetwork: map });
}

// Мнемоника хранится только в памяти во время квиза — после прохождения обнуляется
let _pendingMnemonic  = null;
let _quizPositions    = []; // три случайных индекса [0..11]
let _pendingTx        = null; // данные транзакции, ожидающей подтверждения

// ── Инициализация (с миграцией старого формата) ───────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  PopupTemplates.renderNetworkPickers({
    contexts: ['setup', 'wallet'],
    defaultNetworkKey: DEFAULT_NETWORK_KEY,
    networkKeys: ['eth-mainnet', 'eth-sepolia', 'bsc'],
    networks: NETWORKS,
    optionResolver: getNetworkPickerOption,
  });
  PopupTemplates.renderFeedbackMounts();
  bindDeclarativeHandlers();
  await initializeNetworkState();
  provider = getOrCreatePopupProvider(getRpcUrlForNetwork(selectedNetwork));
  initNetworkPickerInteractions();
  syncNetworkControls();

  // Миграция: старый формат {keystore, address} → новый {accounts: [...]}
  const legacy = await getLocal(['keystore', 'address', 'accounts', 'activeAccount']);
  if (legacy.keystore && legacy.address && !legacy.accounts) {
    await setLocal({
      accounts: [{ address: legacy.address, keystore: legacy.keystore, name: 'Account 1' }],
      activeAccount: 0,
    });
  }

  const accounts = await getAccountsCached(true);
  if (!accounts || accounts.length === 0) {
    showScreen('screen-setup');
    return;
  }

  const { activeAccount } = await getLocal(['activeAccount']);
  activeAccountIndex = (activeAccount != null && activeAccount < accounts.length) ? activeAccount : 0;

  const current = accounts[activeAccountIndex];
  const { unlocked, unlockTime } = await getSession(['unlocked', 'unlockTime']);
  const expired = !unlockTime || (Date.now() - unlockTime > AUTO_LOCK_MINUTES * 60 * 1000);

  if (!unlocked || expired) {
    setAvatar('unlock-avatar', current.address);
    document.getElementById('unlock-address').textContent = shortAddr(current.address);
    showScreen('screen-unlock');
  } else {
    if (await ensureActiveAccountInSW(current.address, activeAccountIndex)) {
      await setSession({ unlockTime: Date.now() });
      showScreen('screen-wallet');
      loadWalletScreen(current.address);
    } else {
      await chrome.storage.session.clear();
      setAvatar('unlock-avatar', current.address);
      document.getElementById('unlock-address').textContent = shortAddr(current.address);
      showScreen('screen-unlock');
    }
  }
});

function bindDeclarativeHandlers() {
  if (typeof PopupEventBinder.bindDeclarativeHandlers === 'function') {
    return PopupEventBinder.bindDeclarativeHandlers();
  }
  const parseArgs = (argsRaw, event) => {
    const raw = String(argsRaw || '').trim();
    if (!raw) return [];

    return raw.split(',').map((part) => {
      const token = part.trim();
      if (token === 'event') return event;
      if (token === 'true') return true;
      if (token === 'false') return false;
      if (token === 'null') return null;
      if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);

      const quoted = token.match(/^['"](.*)['"]$/);
      if (quoted) return quoted[1];

      return token;
    });
  };

  const bindAttribute = (attrName, eventName) => {
    document.querySelectorAll(`[${attrName}]`).forEach((el) => {
      const expr = (el.getAttribute(attrName) || '').trim();
      if (!expr) return;

      const enterGuard = expr.match(/^if\s*\(\s*event\.key\s*===\s*['"]Enter['"]\s*\)\s*([A-Za-z_$][\w$]*)\(\s*\)\s*$/);
      if (enterGuard) {
        const fnName = enterGuard[1];
        el.addEventListener(eventName, (event) => {
          if (event.key !== 'Enter') return;
          const fn = globalThis[fnName];
          if (typeof fn === 'function') fn();
        });
        return;
      }

      const call = expr.match(/^([A-Za-z_$][\w$]*)\((.*)\)\s*$/);
      if (!call) return;

      const fnName = call[1];
      const argsRaw = call[2];
      el.addEventListener(eventName, (event) => {
        const fn = globalThis[fnName];
        if (typeof fn !== 'function') return;
        const args = parseArgs(argsRaw, event);
        fn(...args);
      });
    });
  };

  bindAttribute('data-onclick', 'click');
  bindAttribute('data-onchange', 'change');
  bindAttribute('data-oninput', 'input');
  bindAttribute('data-onkeydown', 'keydown');
}

async function initializeNetworkState() {
  if (typeof PopupNetworkState.initializeNetworkState === 'function') {
    return PopupNetworkState.initializeNetworkState();
  }
  const stored = await getLocal(['selectedChain', 'selectedNetwork', 'rpcByNetwork', 'rpcUrl']);

  selectedChain = stored.selectedChain === DEFAULT_CHAIN_KEY ? DEFAULT_CHAIN_KEY : DEFAULT_CHAIN_KEY;
  selectedNetwork = NETWORKS[stored.selectedNetwork] ? stored.selectedNetwork : DEFAULT_NETWORK_KEY;
  rpcByNetwork = (stored.rpcByNetwork && typeof stored.rpcByNetwork === 'object')
    ? { ...stored.rpcByNetwork }
    : {};

  // Миграция legacy-ключа: старый единый rpcUrl -> rpcByNetwork для выбранной сети.
  if (stored.rpcUrl && !rpcByNetwork[selectedNetwork]) {
    rpcByNetwork[selectedNetwork] = stored.rpcUrl;
  }

  await setLocal({
    selectedChain,
    selectedNetwork,
    rpcByNetwork,
  });
  if (stored.rpcUrl) {
    await removeLocal('rpcUrl');
  }
}

function getRpcUrlForNetwork(networkKey, map = rpcByNetwork) {
  if (typeof PopupNetworkState.getRpcUrlForNetwork === 'function') {
    return PopupNetworkState.getRpcUrlForNetwork(networkKey, map);
  }
  const key = NETWORKS[networkKey] ? networkKey : DEFAULT_NETWORK_KEY;
  return map?.[key] || NETWORKS[key].defaultRpcUrl;
}

function getCurrentNetworkMeta() {
  if (typeof PopupNetworkState.getCurrentNetworkMeta === 'function') {
    return PopupNetworkState.getCurrentNetworkMeta();
  }
  return NETWORKS[selectedNetwork] || NETWORKS[DEFAULT_NETWORK_KEY];
}

function getNativeAssetSymbol(networkKey = selectedNetwork) {
  if (typeof PopupNetworkState.getNativeAssetSymbol === 'function') {
    return PopupNetworkState.getNativeAssetSymbol(networkKey);
  }
  return networkKey === 'bsc' ? 'BNB' : 'ETH';
}

function getMainnetSendGuardKey(networkKey = selectedNetwork) {
  if (typeof PopupNetworkState.getMainnetSendGuardKey === 'function') {
    return PopupNetworkState.getMainnetSendGuardKey(networkKey);
  }
  return `${MAINNET_SEND_GUARD_KEY_PREFIX}:${networkKey}`;
}

// ── Навигация ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  if (typeof PopupUiState.showScreen === 'function') {
    return PopupUiState.showScreen(id);
  }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('acct-menu')?.classList.add('hidden');
  closeNetworkPickers();
  if (id !== 'screen-wallet') stopAutoRefresh();
}

// ── Переключение табов Setup ──────────────────────────────────────────────────
function switchTab(tab) {
  if (typeof PopupUiState.switchTab === 'function') {
    return PopupUiState.switchTab(tab);
  }
  document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tabs [data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// ── Переключение вкладок кошелька ─────────────────────────────────────────────
function switchWalletTab(tab) {
  if (typeof PopupUiState.switchWalletTab === 'function') {
    return PopupUiState.switchWalletTab(tab);
  }
  document.querySelectorAll('.wallet-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.wallet-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.wallet-tabs [data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`wallet-tab-${tab}`).classList.add('active');

  const appRoot = document.getElementById('app');
  appRoot?.classList.add('owl-state-tokens');
  appRoot?.classList.remove('owl-state-history');

  const logoImg = document.querySelector('.global-avatar img');
  if (logoImg) {
    if (logoImg.getAttribute('src') !== 'logo_new.png') {
      logoImg.setAttribute('src', 'logo_new.png');
    }
    logoImg.dataset.state = 'tokens';
  }
}

// ── Валидация пароля (только для создания/импорта, не для unlock) ──────────────
function _validatePassword(password) {
  if (password.length < 8)        return 'Пароль минимум 8 символов';
  if (!/[A-Z]/.test(password))    return 'Нужна хотя бы одна заглавная буква';
  if (!/[a-z]/.test(password))    return 'Нужна хотя бы одна строчная буква';
  if (!/[0-9]/.test(password))    return 'Нужна хотя бы одна цифра';
  return null;
}

// ── Создание кошелька ─────────────────────────────────────────────────────────
async function createWallet() {
  const password = document.getElementById('create-password').value;
  clearMessages('create');
  const pwErr = _validatePassword(password);
  if (pwErr) { showError('create', pwErr); return; }

  // Читаем выбор API ключа
  const rpcChoice = _readRpcChoice();
  if (!rpcChoice.ok) { showError('create', rpcChoice.error); return; }

  setLoading('btn-create', true);
  setStatus('create', 'Генерация ключей…');

  try {
    const wallet   = ethers.Wallet.createRandom();
    const mnemonic = wallet.mnemonic.phrase;

    setStatus('create', 'Шифрование keystore…');
    const keystore = await wallet.encrypt(password);

    const accounts = await getAccountsCached(true);
    accounts.push({ address: wallet.address, keystore, name: `Account ${accounts.length + 1}` });
    setAccountsCache(accounts);
    activeAccountIndex = accounts.length - 1;
    await setLocal({ accounts, activeAccount: activeAccountIndex });

    // Сохраняем RPC URL и обновляем провайдер
    await _saveRpcChoice(rpcChoice);

    // Разблокируем SW — wallet живёт там, а не в popup
    await sendToSW({ type: 'unlock', password, accountIndex: activeAccountIndex });

    _pendingMnemonic = mnemonic; // сохраняем для квиза
    document.getElementById('mnemonic-display').textContent = mnemonic;
    clearMessages('create');
    showScreen('screen-mnemonic');

  } catch (e) {
    showError('create', 'Ошибка: ' + e.message);
  } finally {
    setLoading('btn-create', false);
    setStatus('create', '');
  }
}

// ── Импорт кошелька ───────────────────────────────────────────────────────────
async function importWallet() {
  const mnemonic = document.getElementById('import-mnemonic').value.trim();
  const password = document.getElementById('import-password').value;
  clearMessages('import');
  if (!mnemonic) { showError('import', 'Введите мнемоническую фразу'); return; }
  const pwErr = _validatePassword(password);
  if (pwErr) { showError('import', pwErr); return; }

  // Читаем выбор API ключа
  const rpcChoice = _readRpcChoice();
  if (!rpcChoice.ok) { showError('import', rpcChoice.error); return; }

  setLoading('btn-import', true);
  setStatus('import', 'Проверка фразы…');

  try {
    let wallet;
    try {
      wallet = ethers.Wallet.fromPhrase(mnemonic);
    } catch {
      showError('import', 'Неверная мнемоническая фраза');
      return;
    }

    setStatus('import', 'Шифрование keystore…');
    const keystore = await wallet.encrypt(password);

    const accounts = await getAccountsCached(true);
    accounts.push({ address: wallet.address, keystore, name: `Account ${accounts.length + 1}` });
    setAccountsCache(accounts);
    activeAccountIndex = accounts.length - 1;
    await setLocal({ accounts, activeAccount: activeAccountIndex });

    // Сохраняем RPC URL и обновляем провайдер
    await _saveRpcChoice(rpcChoice);

    // Разблокируем SW — wallet живёт там, а не в popup
    await sendToSW({ type: 'unlock', password, accountIndex: activeAccountIndex });

    clearMessages('import');
    showScreen('screen-wallet');
    loadWalletScreen(wallet.address);

  } catch (e) {
    showError('import', 'Ошибка: ' + e.message);
  } finally {
    setLoading('btn-import', false);
    setStatus('import', '');
  }
}

// ── Разблокировка ─────────────────────────────────────────────────────────────
// Пароль уходит в SW, там расшифровывается keystore и wallet остаётся в SW памяти.
// Popup НЕ получает приватный ключ — только подтверждение успеха/ошибки.
async function unlockWallet() {
  const password = document.getElementById('unlock-password').value;
  clearMessages('unlock');
  if (!password) { showError('unlock', 'Введите пароль'); return; }

  setLoading('btn-unlock', true);
  setStatus('unlock', 'Проверка пароля…');

  const result = await sendToSW({ type: 'unlock', password, accountIndex: activeAccountIndex });

  if (!result?.ok) {
    showError('unlock', 'Неверный пароль');
    setLoading('btn-unlock', false);
    setStatus('unlock', '');
    return;
  }

  document.getElementById('unlock-password').value = '';
  clearMessages('unlock');
  setLoading('btn-unlock', false);
  setStatus('unlock', '');

  const accounts = await getAccountsCached();
  showScreen('screen-wallet');
  loadWalletScreen(accounts[activeAccountIndex].address);
}

// ── Экран кошелька ────────────────────────────────────────────────────────────
async function loadWalletScreen(address) {
  sendToSW({ type: 'reset-lock-timer' });
  setAvatar('wallet-avatar', address); // header-avatar не существует в HTML — убран

  const accounts = await getAccountsCached();
  const acctName = accounts[activeAccountIndex]?.name || `Account ${activeAccountIndex + 1}`;
  document.getElementById('header-acct-name').textContent = acctName;
  document.getElementById('wallet-address').textContent = shortAddr(address);
  updateNetworkBadge();

  loadBalance(address);
  loadTokenBalances(address);
  loadTransactions(address);
  startAutoRefresh(address);
  switchWalletTab('tokens');
}

function isWalletScreenVisible() {
  return document.getElementById('screen-wallet')?.classList.contains('active');
}

async function refreshActiveAccountData(force = false) {
  if (_autoRefreshInFlight) return;
  if (!isWalletScreenVisible()) return;

  const now = Date.now();
  if (!force && (now - _lastAutoRefreshAt) < AUTO_REFRESH_MIN_INTERVAL_MS) return;

  const accounts = await getAccountsCached();
  const address = accounts[activeAccountIndex]?.address;
  if (!address || address.toLowerCase() !== _autoRefreshAddress) return;

  _autoRefreshInFlight = true;
  _lastAutoRefreshAt = now;
  try {
    await Promise.all([
      loadBalance(address),
      loadTokenBalances(address),
      loadTransactions(address),
    ]);
  } finally {
    _autoRefreshInFlight = false;
  }
}

function stopAutoRefresh() {
  if (provider && _autoRefreshBlockListener) {
    provider.off('block', _autoRefreshBlockListener);
  }
  if (_autoRefreshTimer) {
    clearInterval(_autoRefreshTimer);
  }
  _autoRefreshAddress = null;
  _autoRefreshBlockListener = null;
  _autoRefreshTimer = null;
  _autoRefreshInFlight = false;
  _lastAutoRefreshAt = 0;
}

function startAutoRefresh(address) {
  stopAutoRefresh();
  if (!provider || !address) return;

  _autoRefreshAddress = address.toLowerCase();
  _autoRefreshBlockListener = () => {
    refreshActiveAccountData(false);
  };

  // Для HTTP RPC ethers сам опрашивает блоки и эмитит событие block.
  provider.on('block', _autoRefreshBlockListener);

  // Fallback на случай, если провайдер/узел не отдают block-события стабильно.
  _autoRefreshTimer = setInterval(() => {
    refreshActiveAccountData(true);
  }, AUTO_REFRESH_FALLBACK_MS);
}

async function loadBalance(address) {
  try {
    const wei = await provider.getBalance(address);
    document.getElementById('wallet-balance').textContent =
      parseFloat(ethers.formatEther(wei)).toFixed(6);
  } catch {
    document.getElementById('wallet-balance').textContent = '—';
  }
}

async function refreshBalance() {
  const accounts = await getAccountsCached();
  const address = accounts[activeAccountIndex]?.address;
  if (!address) return;
  document.getElementById('wallet-balance').textContent = '…';
  _autoRefreshAddress = address.toLowerCase();

  // Балансы обновляем сразу, а транзакции — в фоне, чтобы UI реагировал быстрее.
  await Promise.all([
    loadBalance(address),
    loadTokenBalances(address),
  ]);
  loadTransactions(address);
}

// ── ERC-20 токены ─────────────────────────────────────────────────────────────
async function loadTokenBalances(address) {
  if (typeof PopupTokenState.loadTokenBalances === 'function') {
    return PopupTokenState.loadTokenBalances(address);
  }
  const tokens = await getTokensForSelectedNetwork();
  const el = document.getElementById('token-list');
  el.textContent = ''; // безопасная очистка — без innerHTML

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

    // Левая часть: иконка + название
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
    iconFallback.textContent = t.symbol.slice(0, 4); // textContent — XSS невозможен

    const logoUrls = getTokenLogoUrls(t.address, selectedNetwork);
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
    symEl.textContent = t.symbol; // textContent — XSS невозможен

    const addrEl = document.createElement('div');
    addrEl.className = 'token-addr';
    addrEl.textContent = t.address.slice(0, 10) + '…'; // textContent — XSS невозможен

    info.appendChild(symEl);
    info.appendChild(addrEl);
    left.appendChild(icon);
    left.appendChild(info);

    // Баланс
    const balanceEl = document.createElement('span');
    balanceEl.className = 'token-balance';
    balanceEl.id = `tb-${id}`;
    balanceEl.textContent = '…';

    // Кнопка удаления — addEventListener вместо onclick в строке
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
      const contract  = new ethers.Contract(t.address, ERC20_ABI, provider);
      const raw       = await contract.balanceOf(address);
      const formatted = formatAmount(parseFloat(ethers.formatUnits(raw, t.decimals)));
      const balEl = document.getElementById(`tb-${id}`);
      if (balEl) balEl.textContent = `${formatted} ${t.symbol}`;
    } catch {
      const balEl = document.getElementById(`tb-${id}`);
      if (balEl) balEl.textContent = '—';
    }
  }));
}

function onTokenAddrChange() {
  if (typeof PopupTokenState.onTokenAddrChange === 'function') {
    return PopupTokenState.onTokenAddrChange();
  }
  const val = document.getElementById('token-address').value.trim();
  document.getElementById('btn-fetch-token').disabled = !ethers.isAddress(val);
}

async function fetchTokenInfo() {
  if (typeof PopupTokenState.fetchTokenInfo === 'function') {
    return PopupTokenState.fetchTokenInfo();
  }
  const addr = document.getElementById('token-address').value.trim();
  clearMessages('add-token');
  if (!ethers.isAddress(addr)) { showError('add-token', 'Неверный адрес контракта'); return; }
  setStatus('add-token', 'Загрузка информации…');
  try {
    const c = new ethers.Contract(addr, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
    document.getElementById('token-symbol').value   = symbol;
    document.getElementById('token-decimals').value = decimals.toString();
    setStatus('add-token', '');
  } catch {
    setStatus('add-token', '');
    showError('add-token', 'Не удалось загрузить информацию о токене');
  }
}

async function addToken() {
  if (typeof PopupTokenState.addToken === 'function') {
    return PopupTokenState.addToken();
  }
  const addr     = document.getElementById('token-address').value.trim();
  const symbol   = document.getElementById('token-symbol').value.trim().toUpperCase();
  const decimals = parseInt(document.getElementById('token-decimals').value) || 18;
  clearMessages('add-token');
  if (!ethers.isAddress(addr)) { showError('add-token', 'Неверный адрес контракта'); return; }
  if (!symbol)                 { showError('add-token', 'Введите символ токена');     return; }

  const tokens = await getTokensForSelectedNetwork();
  if (tokens.some(t => t.address.toLowerCase() === addr.toLowerCase())) {
    showError('add-token', 'Этот токен уже добавлен'); return;
  }
  tokens.push({ address: addr, symbol, decimals });
  await setTokensForSelectedNetwork(tokens);

  document.getElementById('token-address').value  = '';
  document.getElementById('token-symbol').value   = '';
  document.getElementById('token-decimals').value = '18';
  document.getElementById('btn-fetch-token').disabled = true;

  showScreen('screen-wallet');
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (address) { loadTokenBalances(address); switchWalletTab('tokens'); }
}

async function removeToken(addr) {
  if (typeof PopupTokenState.removeToken === 'function') {
    return PopupTokenState.removeToken(addr);
  }
  const tokens = await getTokensForSelectedNetwork();
  await setTokensForSelectedNetwork(tokens.filter(t => t.address.toLowerCase() !== addr.toLowerCase()));
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (address) loadTokenBalances(address);
}

// ── Переключатель аккаунтов ───────────────────────────────────────────────────
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
  const { accounts = [] } = await getLocal(['accounts']);
  const listEl = document.getElementById('acct-list');
  listEl.textContent = ''; // безопасная очистка

  accounts.forEach((acct, i) => {
    const item = document.createElement('div');
    item.className = 'acct-item' + (i === activeAccountIndex ? ' active' : '');
    item.addEventListener('click', () => switchAccount(i)); // addEventListener вместо onclick в строке

    const avatarEl = document.createElement('div');
    avatarEl.className = 'avatar avatar-sm';
    avatarEl.id = `acct-av-${i}`;

    const infoEl = document.createElement('div');
    infoEl.style.flex = '1';

    const nameEl = document.createElement('div');
    nameEl.className = 'acct-item-name';
    nameEl.textContent = acct.name; // textContent — XSS невозможен

    const addrEl = document.createElement('div');
    addrEl.className = 'acct-item-addr';
    addrEl.textContent = shortAddr(acct.address); // textContent — XSS невозможен

    infoEl.appendChild(nameEl);
    infoEl.appendChild(addrEl);
    item.appendChild(avatarEl);
    item.appendChild(infoEl);

    if (i === activeAccountIndex) {
      const check = document.createElement('span');
      check.className = 'acct-item-check';
      check.textContent = '✓';
      item.appendChild(check);
    }

    listEl.appendChild(item);
  });

  accounts.forEach((_, i) => setAvatar(`acct-av-${i}`, accounts[i].address));
}

async function switchAccount(idx) {
  const { accounts = [] } = await getLocal(['accounts']);
  if (idx >= accounts.length) return;

  activeAccountIndex = idx;
  await setLocal({ activeAccount: idx });
  stopAutoRefresh();

  const targetAddress = accounts[idx].address;
  if (await ensureActiveAccountInSW(targetAddress, idx)) {
    showScreen('screen-wallet');
    loadWalletScreen(targetAddress);
    return;
  }

  setAvatar('unlock-avatar', targetAddress);
  document.getElementById('unlock-address').textContent = shortAddr(targetAddress);
  document.getElementById('unlock-password').value = '';
  clearMessages('unlock');
  showScreen('screen-unlock');
}

// ── Добавить субаккаунт ───────────────────────────────────────────────────────
// Деривация и шифрование нового аккаунта происходят в SW
async function addSubAccount() {
  const password = document.getElementById('add-account-password').value;
  clearMessages('add-account');
  if (!password) { showError('add-account', 'Введите пароль'); return; }

  setLoading('btn-add-account', true);
  setStatus('add-account', 'Создание субаккаунта…');

  const result = await sendToSW({ type: 'add-sub-account', password });

  if (!result?.ok) {
    const msg = result?.error?.includes('password') || result?.error?.includes('пароль')
      ? 'Неверный пароль'
      : (result?.error || 'Ошибка');
    showError('add-account', msg);
    setLoading('btn-add-account', false);
    setStatus('add-account', '');
    return;
  }

  const { accounts = [] } = await getLocal(['accounts']);
  accounts.push({ address: result.address, keystore: result.keystore, name: `Account ${result.index + 1}` });
  activeAccountIndex = result.index;
  await setLocal({ accounts, activeAccount: result.index });

  document.getElementById('add-account-password').value = '';
  setLoading('btn-add-account', false);
  setStatus('add-account', '');
  showScreen('screen-wallet');
  loadWalletScreen(result.address);
}

async function loadTransactions(address) {
  if (typeof PopupTxHistory.loadTransactions === 'function') {
    return PopupTxHistory.loadTransactions(address);
  }
  const scopeKey = getTxScopeKey(address);
  if (_txLoadPromises.has(scopeKey)) {
    return _txLoadPromises.get(scopeKey);
  }

  const run = (async () => {
  const el = document.getElementById('tx-list');
  setTxRefreshIndicator(true);

  try {
    const { [TX_SYNC_STATE_KEY]: syncState = {}, [TX_HISTORY_CACHE_KEY]: txCache = {} } =
      await getLocal([TX_SYNC_STATE_KEY, TX_HISTORY_CACHE_KEY]);

    const accountSync = syncState?.[scopeKey] || {};
    const cachedTxs = Array.isArray(txCache?.[scopeKey]) ? txCache[scopeKey] : [];

    const hasCheckpoint = Number.isInteger(accountSync.lastProcessedBlock) && accountSync.lastProcessedBlock >= 0;
    const fromBlockHex = hasCheckpoint
      ? `0x${(accountSync.lastProcessedBlock + 1).toString(16)}`
      : '0x0';

    // Мгновенно показываем кэш, чтобы список не исчезал во время обновления.
    if (cachedTxs.length) {
      renderTransactions(el, address, cachedTxs, selectedNetwork);
    } else if (!el.children.length) {
      const loadingEl = document.createElement('p');
      loadingEl.className = 'empty';
      loadingEl.textContent = 'Загрузка…';
      el.textContent = '';
      el.appendChild(loadingEl);
    }

    // После первичной загрузки читаем только «хвост» новых блоков.
    const maxCount = hasCheckpoint ? TX_INCREMENTAL_MAX_COUNT : TX_INITIAL_MAX_COUNT;

    let [sentRes, recvRes] = await Promise.all([
      fetchAlchemyTransfers(address, 'from', { fromBlock: fromBlockHex, maxCount }),
      fetchAlchemyTransfers(address, 'to', { fromBlock: fromBlockHex, maxCount }),
    ]);

    // Явно проверяем JSON-RPC ошибки
    if (sentRes.error) throw new Error(sentRes.error.message || 'Alchemy error (from)');
    if (recvRes.error) throw new Error(recvRes.error.message || 'Alchemy error (to)');

    let sent = sentRes.result?.transfers || [];
    let recv = recvRes.result?.transfers || [];

    // Если checkpoint есть, но кэш пропал (например, из-за гонки/старого состояния),
    // делаем один полный запрос, чтобы не терять уже существующую историю в UI.
    if (hasCheckpoint && !cachedTxs.length && (sent.length + recv.length === 0)) {
      [sentRes, recvRes] = await Promise.all([
        fetchAlchemyTransfers(address, 'from', { fromBlock: '0x0', maxCount: TX_INITIAL_MAX_COUNT }),
        fetchAlchemyTransfers(address, 'to', { fromBlock: '0x0', maxCount: TX_INITIAL_MAX_COUNT }),
      ]);
      if (sentRes.error) throw new Error(sentRes.error.message || 'Alchemy error (from)');
      if (recvRes.error) throw new Error(recvRes.error.message || 'Alchemy error (to)');
      sent = sentRes.result?.transfers || [];
      recv = recvRes.result?.transfers || [];
    }

    // Объединяем новые tx, затем мержим с кэшем аккаунта.
    const freshSeen = new Set();
    const fresh = [...sent, ...recv]
      .filter(tx => {
        if (freshSeen.has(tx.hash)) return false;
        freshSeen.add(tx.hash);
        return true;
      })
      .sort((a, b) => (parseInt(b.blockNum, 16) || 0) - (parseInt(a.blockNum, 16) || 0));

    const mergedSeen = new Set();
    const baseForMerge = (hasCheckpoint && fresh.length === 0 && cachedTxs.length > 0)
      ? cachedTxs
      : [...fresh, ...cachedTxs];
    const merged = baseForMerge
      .filter(tx => {
        if (mergedSeen.has(tx.hash)) return false;
        mergedSeen.add(tx.hash);
        return true;
      })
      .sort((a, b) => (parseInt(b.blockNum, 16) || 0) - (parseInt(a.blockNum, 16) || 0))
      .slice(0, TX_HISTORY_LIMIT);

    renderTransactions(el, address, merged, selectedNetwork);

    const maxMergedBlock = merged.reduce(
      (acc, tx) => Math.max(acc, parseInt(tx.blockNum, 16) || -1),
      -1
    );
    const nextCheckpoint = Math.max(
      hasCheckpoint ? accountSync.lastProcessedBlock : -1,
      maxMergedBlock,
    );

    const nextSyncState = { ...syncState };
    nextSyncState[scopeKey] = {
      lastProcessedBlock: nextCheckpoint,
      updatedAt: new Date().toISOString(),
    };

    const nextCache = { ...txCache };
    nextCache[scopeKey] = merged;

    await setLocal({
      [TX_SYNC_STATE_KEY]: nextSyncState,
      [TX_HISTORY_CACHE_KEY]: nextCache,
    });

  } catch (e) {
    console.error('[loadTransactions]', e);
    // Если на экране уже есть предыдущий список, не затираем его при ошибке.
    const hasRenderedTx = el.querySelector('.tx');
    if (!hasRenderedTx) {
      el.textContent = '';
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Не удалось загрузить транзакции'; // ошибка НЕ выводится в DOM
      el.appendChild(p);
    }
  } finally {
    setTxRefreshIndicator(false);
  }
  })();

  _txLoadPromises.set(scopeKey, run);
  try {
    await run;
  } finally {
    _txLoadPromises.delete(scopeKey);
  }
}

function setTxRefreshIndicator(active) {
  if (typeof PopupTxHistory.setTxRefreshIndicator === 'function') {
    return PopupTxHistory.setTxRefreshIndicator(active);
  }
  const el = document.getElementById('tx-refresh-indicator');
  if (!el) return;
  el.classList.toggle('active', !!active);
}

function renderTransactions(el, address, txs, networkKey = selectedNetwork) {
  if (typeof PopupTxHistory.renderTransactions === 'function') {
    return PopupTxHistory.renderTransactions(el, address, txs, networkKey);
  }
  el.textContent = '';
  const scopeKey = getTxScopeKey(address, networkKey);
  const allTxs = Array.isArray(txs) ? txs : [];
  _txRenderedState.set(scopeKey, {
    address,
    networkKey,
    txs: allTxs,
  });

  const totalPages = typeof WalletCore.getTotalPages === 'function'
    ? WalletCore.getTotalPages(allTxs.length, TX_PAGE_SIZE)
    : Math.max(1, Math.ceil(allTxs.length / TX_PAGE_SIZE));
  const requestedPage = _txPaginationState.get(scopeKey) || 1;
  const currentPage = typeof WalletCore.clampPage === 'function'
    ? WalletCore.clampPage(requestedPage, totalPages)
    : Math.min(totalPages, Math.max(1, requestedPage));
  _txPaginationState.set(scopeKey, currentPage);

  updateTxPaginationUI(scopeKey, allTxs.length, currentPage, totalPages);

  if (!allTxs.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Транзакций пока нет';
    el.appendChild(p);
    return;
  }

  const pageTxs = typeof WalletCore.paginateItems === 'function'
    ? WalletCore.paginateItems(allTxs, currentPage, TX_PAGE_SIZE).items
    : allTxs.slice((currentPage - 1) * TX_PAGE_SIZE, currentPage * TX_PAGE_SIZE);

  pageTxs.forEach(tx => {
    const isOut  = tx.from?.toLowerCase() === address.toLowerCase();
    const peerLabel = isOut ? 'to' : 'from';
    const peerAddress = isOut ? tx.to : tx.from;
    const safePeer = peerAddress || 'unknown';
    const amount = tx.value != null ? formatAmount(parseFloat(tx.value)) : '?';
    const asset  = tx.asset || 'ETH';
    const txHash = tx.hash || '';

    const txEl = document.createElement('div');
    txEl.className = 'tx';

    const leftEl = document.createElement('div');
    leftEl.className = 'tx-left';

    const dirEl = document.createElement('span');
    dirEl.className = `tx-dir ${isOut ? 'out' : 'in'}`;
    dirEl.textContent = `${isOut ? '↗ out' : '↙ in'}`;

    const peerEl = document.createElement('div');
    peerEl.className = 'tx-peer';
    peerEl.title = `${peerLabel}: ${safePeer}`;
    peerEl.textContent = `${peerLabel}: ${shortAddr(safePeer)}`;

    const hashRowEl = document.createElement('div');
    hashRowEl.className = 'tx-hash-row';

    const linkEl = document.createElement('a');
    linkEl.className = 'tx-link';
    linkEl.href = `${getTxExplorerBaseUrl(networkKey)}${encodeURIComponent(txHash)}`;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.title = txHash;
    linkEl.textContent = txHash
      ? `${txHash.slice(0, 6)}…${txHash.slice(-4)}`
      : 'hash: n/a';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'tx-copy';
    copyBtn.textContent = 'copy';
    copyBtn.title = 'Скопировать хэш';
    copyBtn.disabled = !txHash;
    copyBtn.addEventListener('click', () => copyTxHash(txHash, copyBtn));

    leftEl.appendChild(dirEl);
    leftEl.appendChild(peerEl);
    hashRowEl.appendChild(linkEl);
    hashRowEl.appendChild(copyBtn);
    leftEl.appendChild(hashRowEl);

    const amountEl = document.createElement('span');
    amountEl.className = `tx-amount ${isOut ? 'out' : 'inc'}`;
    amountEl.textContent = `${isOut ? '−' : '+'}${amount} ${asset}`;

    txEl.appendChild(leftEl);
    txEl.appendChild(amountEl);
    el.appendChild(txEl);
  });
}

function updateTxPaginationUI(scopeKey, totalTxs, currentPage, totalPages) {
  if (typeof PopupTxHistory.updateTxPaginationUI === 'function') {
    return PopupTxHistory.updateTxPaginationUI(scopeKey, totalTxs, currentPage, totalPages);
  }
  const container = document.getElementById('tx-pagination');
  const prevBtn = document.getElementById('tx-page-prev');
  const nextBtn = document.getElementById('tx-page-next');
  const info = document.getElementById('tx-page-info');
  if (!container || !prevBtn || !nextBtn || !info) return;

  if (!totalTxs) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  info.textContent = `Страница ${currentPage} / ${totalPages} • ${totalTxs} tx`;

  container.dataset.scopeKey = scopeKey;
}

async function changeTxPage(delta) {
  if (typeof PopupTxHistory.changeTxPage === 'function') {
    return PopupTxHistory.changeTxPage(delta);
  }
  if (!delta) return;

  const { accounts = [] } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (!address) return;

  const scopeKey = getTxScopeKey(address);
  const rendered = _txRenderedState.get(scopeKey);
  if (!rendered || !Array.isArray(rendered.txs) || rendered.txs.length === 0) return;

  const totalPages = Math.max(1, Math.ceil(rendered.txs.length / TX_PAGE_SIZE));
  const currentPage = _txPaginationState.get(scopeKey) || 1;
  const nextPage = Math.min(totalPages, Math.max(1, currentPage + delta));
  if (nextPage === currentPage) return;

  _txPaginationState.set(scopeKey, nextPage);
  const el = document.getElementById('tx-list');
  if (!el) return;
  renderTransactions(el, rendered.address, rendered.txs, rendered.networkKey);
}

async function copyTxHash(hash, buttonEl) {
  if (typeof PopupTxHistory.copyTxHash === 'function') {
    return PopupTxHistory.copyTxHash(hash, buttonEl);
  }
  if (!hash) return;
  const prevText = buttonEl?.textContent || 'copy';
  await copyText(hash);
  if (!buttonEl) return;
  buttonEl.textContent = 'copied';
  setTimeout(() => {
    buttonEl.textContent = prevText;
  }, 1000);
}

async function fetchAlchemyTransfers(address, direction, opts = {}) {
  if (typeof PopupTxHistory.fetchAlchemyTransfers === 'function') {
    return PopupTxHistory.fetchAlchemyTransfers(address, direction, opts);
  }
  // Берём актуальную сеть и её RPC из storage (учитывая кастомный URL для конкретной сети).
  const stored = await getLocal(['selectedNetwork', 'rpcByNetwork']);
  const networkKey = NETWORKS[stored.selectedNetwork] ? stored.selectedNetwork : selectedNetwork;
  const activeUrl = getRpcUrlForNetwork(networkKey, stored.rpcByNetwork || rpcByNetwork);

  const body = {
    id: 1, jsonrpc: '2.0',
    method: 'alchemy_getAssetTransfers',
    params: [{
      fromBlock:        '0x0',
      toBlock:          opts.toBlock || 'latest',
      category:         ['external', 'erc20'],
      withMetadata:     false,
      excludeZeroValue: true,
      maxCount:         opts.maxCount || '0x14',
      [direction === 'from' ? 'fromAddress' : 'toAddress']: address,
    }],
  };
  body.params[0].fromBlock = opts.fromBlock || '0x0';
  const res = await fetch(activeUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Отправка транзакции ───────────────────────────────────────────────────────
async function showSendScreen() {
  if (typeof PopupSendFlow.showSendScreen === 'function') {
    return PopupSendFlow.showSendScreen();
  }
  const tokens = await getTokensForSelectedNetwork();
  const select = document.getElementById('send-asset');
  select.textContent = ''; // безопасная очистка
  const nativeSymbol = getNativeAssetSymbol();

  // ETH — статичная опция
  const ethOpt = document.createElement('option');
  ethOpt.value = 'ETH';
  ethOpt.textContent = `${nativeSymbol} (Native)`;
  select.appendChild(ethOpt);

  // ERC-20 токены — value и textContent отдельно, не через шаблон
  tokens.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.address;           // setAttribute безопасен для value
    opt.textContent = `${t.symbol} (ERC-20)`; // textContent — XSS невозможен
    select.appendChild(opt);
  });

  resetSendFlowUI({ clearInputs: true });

  showScreen('screen-send');
}

function resetSendFlowUI({ clearInputs = false } = {}) {
  if (typeof PopupSendFlow.resetSendFlowUI === 'function') {
    return PopupSendFlow.resetSendFlowUI({ clearInputs });
  }
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

// Подпись и отправка транзакции — приватный ключ остаётся в SW, сюда не приходит
// Шаг 1: валидация, оценка газа, показ экрана подтверждения
async function sendTransaction() {
  if (typeof PopupSendFlow.sendTransaction === 'function') {
    return PopupSendFlow.sendTransaction();
  }
  const { accounts = [] } = await getLocal(['accounts']);
  const activeAddress = accounts[activeAccountIndex]?.address;
  if (!activeAddress || !(await ensureActiveAccountInSW(activeAddress, activeAccountIndex))) {
    await handleSWLocked();
    return;
  }

  const to     = document.getElementById('send-to').value.trim();
  const amount = document.getElementById('send-amount').value.trim();
  const asset  = document.getElementById('send-asset').value;

  clearMessages('send');
  clearMessages('confirm');
  if (!ethers.isAddress(to))              { showError('send', 'Неверный адрес получателя'); return; }
  if (!amount || parseFloat(amount) <= 0) { showError('send', 'Введите корректную сумму');  return; }
  if (!(await ensureMainnetSendGuard())) return;

  setLoading('btn-send', true);
  setStatus('send', 'Оценка газа…');

  try {
    const nativeSymbol = getNativeAssetSymbol();
    let gasEstimateWei, assetLabel, token;

    if (asset === 'ETH') {
      assetLabel = nativeSymbol;
      const txRequest = {
        to,
        value: ethers.parseEther(amount),
        chainId: getCurrentNetworkMeta().chainId,
      };
      gasEstimateWei = await provider.estimateGas(txRequest);
    } else {
      const tokens = await getTokensForSelectedNetwork();
      token = tokens.find(t => t.address.toLowerCase() === asset.toLowerCase());
      if (!token) { showError('send', 'Токен не найден'); return; }
      assetLabel = token.symbol;
      const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
      const { accounts } = await getLocal(['accounts']);
      const from = accounts[activeAccountIndex]?.address;
      const data = contract.interface.encodeFunctionData('transfer', [
        to, ethers.parseUnits(amount, token.decimals),
      ]);
      gasEstimateWei = await provider.estimateGas({ from, to: token.address, data });
    }

    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    const gasCostWei = gasEstimateWei * gasPrice;
    const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));

    // Для ETH: итого = сумма + газ; для ERC-20: итого газ отдельно
    const totalText = asset === 'ETH'
      ? `${formatAmount(parseFloat(amount) + gasCostEth)} ${nativeSymbol}`
      : `${amount} ${assetLabel} + ${formatAmount(gasCostEth)} ${nativeSymbol} (газ)`;

    _pendingTx = { to, amount, asset, token: token || null };

    document.getElementById('confirm-to').textContent = to;
    document.getElementById('confirm-amount').textContent = `${amount}`;
    document.getElementById('confirm-asset').textContent = assetLabel;
    document.getElementById('confirm-gas-estimate').textContent = `~${formatAmount(gasCostEth)} ${nativeSymbol}`;
    document.getElementById('confirm-total').textContent = totalText;

    clearMessages('send');
    showScreen('screen-confirm-tx');

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
  if (typeof PopupSendFlow.confirmSend === 'function') {
    return PopupSendFlow.confirmSend();
  }
  if (!_pendingTx) { showScreen('screen-send'); return; }
  sendToSW({ type: 'reset-lock-timer' });
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
        decimals:     token.decimals,
      });
    }

    if (!result?.ok) {
      if (result?.error === 'locked') { _pendingTx = null; await handleSWLocked(); return; }
      let errMsg = 'Ошибка отправки';
      if (result?.error?.includes('insufficient funds')) errMsg = 'Недостаточно средств';
      else if (result?.error?.includes('nonce'))         errMsg = 'Ошибка nonce — попробуйте ещё раз';
      showError('confirm', errMsg);
      return;
    }

    _pendingTx = null;
    showSuccess('confirm', `Отправлено! ${result.hash.slice(0, 20)}…`);

    setTimeout(async () => {
      showScreen('screen-wallet');
      const { accounts } = await getLocal(['accounts']);
      loadWalletScreen(accounts[activeAccountIndex].address);
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
  if (typeof PopupSendFlow.cancelSend === 'function') {
    return PopupSendFlow.cancelSend();
  }
  _pendingTx = null;
  showScreen('screen-send');
}

// ── Копирование адреса ────────────────────────────────────────────────────────
async function copyAddress() {
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (!address) return;

  await copyText(address);

  // Сохраняем дочерние узлы (SVG) без использования innerHTML
  const btn = document.querySelector('.copy-btn');
  const originalNodes = Array.from(btn.childNodes).map(n => n.cloneNode(true));
  btn.textContent = '';
  const tick = document.createElement('span');
  tick.style.cssText = 'font-size:12px;color:#4ade80';
  tick.textContent = '✓';
  btn.appendChild(tick);
  setTimeout(() => {
    btn.textContent = '';
    originalNodes.forEach(n => btn.appendChild(n)); // восстанавливаем без innerHTML
  }, 1500);
}

// ── Мнемоника ─────────────────────────────────────────────────────────────────
function copyMnemonic() {
  copyText(document.getElementById('mnemonic-display').textContent).catch(() => {});
}

// Пользователь нажал "Я сохранил" → показываем квиз
function confirmMnemonic() {
  if (!_pendingMnemonic) {
    // Не должно происходить, но на всякий случай
    showScreen('screen-setup');
    return;
  }
  _quizPositions = _pickQuizPositions();
  _renderQuiz();
  showScreen('screen-quiz');
}

// Выбираем 3 случайных уникальных позиции из 12, сортируем по возрастанию
function _pickQuizPositions() {
  const positions = new Set();
  while (positions.size < 3) {
    positions.add(Math.floor(Math.random() * 12));
  }
  return Array.from(positions).sort((a, b) => a - b);
}

// Рисуем три поля ввода — createElement, без innerHTML
function _renderQuiz() {
  const container = document.getElementById('quiz-inputs');
  container.textContent = '';
  clearMessages('quiz');

  _quizPositions.forEach((pos, i) => {
    const field = document.createElement('div');
    field.className = 'field';

    const lbl = document.createElement('label');
    lbl.textContent = `Слово #${pos + 1}`;

    const inp = document.createElement('input');
    inp.type          = 'text';
    inp.id            = `quiz-inp-${i}`;
    inp.placeholder   = `Введите слово #${pos + 1}`;
    inp.autocomplete  = 'off';
    inp.spellcheck    = false;
    // Enter на последнем поле → проверяем
    if (i === 2) inp.addEventListener('keydown', e => { if (e.key === 'Enter') verifyQuiz(); });

    field.appendChild(lbl);
    field.appendChild(inp);
    container.appendChild(field);
  });

  // Фокус на первое поле
  document.getElementById('quiz-inp-0')?.focus();
}

// Проверяем ответы
async function verifyQuiz() {
  if (!_pendingMnemonic) { showScreen('screen-setup'); return; }
  clearMessages('quiz');

  const words = _pendingMnemonic.split(' ');
  let allCorrect = true;

  _quizPositions.forEach((pos, i) => {
    const inp = document.getElementById(`quiz-inp-${i}`);
    if (!inp) { allCorrect = false; return; } // null-guard на случай если DOM не готов
    const entered = inp.value.trim().toLowerCase();
    const correct = words[pos].toLowerCase();

    if (entered === correct) {
      inp.style.borderColor = '#4ade80'; // зелёный
    } else {
      inp.style.borderColor = '#ef4444'; // красный
      allCorrect = false;
    }
  });

  if (!allCorrect) {
    showError('quiz', 'Одно или несколько слов неверны — проверьте фразу и попробуйте снова');
    return;
  }

  // Квиз пройден — обнуляем мнемонику из памяти
  _pendingMnemonic = null;
  _quizPositions   = [];

  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  showScreen('screen-wallet');
  if (address) loadWalletScreen(address);
}

// Кнопка "Посмотреть снова" — возврат к экрану с фразой
function backToMnemonic() {
  // Сбрасываем цвета полей и ошибку
  _quizPositions.forEach((_, i) => {
    const inp = document.getElementById(`quiz-inp-${i}`);
    if (inp) inp.style.borderColor = '';
  });
  clearMessages('quiz');
  showScreen('screen-mnemonic');
}

// ── Блокировка / сброс ────────────────────────────────────────────────────────
async function lockWallet() {
  // SW обнуляет _wallet и очищает session storage
  await sendToSW({ type: 'lock' });
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  setAvatar('unlock-avatar', address);
  document.getElementById('unlock-address').textContent = shortAddr(address);
  showScreen('screen-unlock');
}

async function resetWallet() {
  const ok = confirm(
    'Удалить кошелёк с этого устройства?\n\n' +
    'Восстановить можно только по мнемонической фразе.'
  );
  if (!ok) return;
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  activeAccountIndex = 0;
  showScreen('screen-setup');
}

// ── Форматирование чисел ────────────────────────────────────────────────────
// Показывает ровно столько знаков, сколько нужно, без хвостовых нулей:
//   200        → "200"
//   1.5        → "1.5"
//   0.001234   → "0.001234"
//   0.00000001 → "< 0.000001"
function formatAmount(value) {
  if (typeof WalletCore.formatAmount === 'function') {
    return WalletCore.formatAmount(value);
  }
  if (value === 0) return '0';
  const abs = Math.abs(value);
  let s;
  if      (abs >= 1000)    s = value.toFixed(2);
  else if (abs >= 1)       s = value.toFixed(4);
  else if (abs >= 0.000001) s = value.toFixed(6);
  else                     return '< 0.000001';
  // Убираем хвостовые нули и лишнюю точку
  return s.replace(/\.?0+$/, '');
}
// ── Вспомогательные функции ───────────────────────────────────────────────────
function shortAddr(addr) {
  if (typeof WalletCore.shortAddr === 'function') {
    return WalletCore.shortAddr(addr);
  }
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

// ── Выбор API ключа ───────────────────────────────────────────────────────────
// Провайдеры, разрешённые CSP в manifest.json (connect-src).
// При добавлении нового провайдера — обновить оба места одновременно.
const ALLOWED_RPC_HOSTS = [
  'eth-mainnet.g.alchemy.com',
  'eth-sepolia.g.alchemy.com',
  '.g.alchemy.com',
  '.infura.io',
  '.quiknode.pro',
  '.publicnode.com',
];

// Читает состояние чекбокса и поля ввода на экране setup.
// Возвращает { ok, url, useDefault } или { ok: false, error }
function _readRpcChoice() {
  if (typeof PopupNetworkState._readRpcChoice === 'function') {
    return PopupNetworkState._readRpcChoice();
  }
  const useDefault = document.getElementById('use-default-key')?.checked !== false;
  const customUrl  = document.getElementById('custom-rpc-url')?.value.trim() || '';

  if (!useDefault) {
    if (!customUrl) {
      return { ok: false, error: 'Введите RPC URL или используйте встроенный ключ' };
    }
    if (!customUrl.startsWith('https://')) {
      return { ok: false, error: 'URL должен начинаться с https://' };
    }
    let urlHost;
    try { urlHost = new URL(customUrl).hostname; }
    catch { return { ok: false, error: 'Некорректный URL' }; }
    const allowed = ALLOWED_RPC_HOSTS.some(h => urlHost === h || urlHost.endsWith(h));
    if (!allowed) {
      return { ok: false, error: 'Провайдер не поддерживается. Используйте Alchemy, Infura или QuikNode.' };
    }
  }

  return { ok: true, useDefault, url: useDefault ? null : customUrl, networkKey: selectedNetwork };
}

// Сохраняет выбор в хранилище и обновляет провайдер
async function _saveRpcChoice(choice) {
  if (typeof PopupNetworkState._saveRpcChoice === 'function') {
    return PopupNetworkState._saveRpcChoice(choice);
  }
  const prevAddress = _autoRefreshAddress;
  stopAutoRefresh();

  if (choice.useDefault) {
    delete rpcByNetwork[choice.networkKey];
  } else {
    rpcByNetwork[choice.networkKey] = choice.url;
  }
  await setLocal({ rpcByNetwork });

  // Обновляем провайдер сразу по активной сети
  provider = getOrCreatePopupProvider(getRpcUrlForNetwork(selectedNetwork));
  syncNetworkControls();

  // Переподписываем автообновление на новый провайдер.
  if (prevAddress && isWalletScreenVisible()) {
    startAutoRefresh(prevAddress);
  }
}

// Показывает/скрывает поле кастомного URL при переключении чекбокса
function toggleCustomKey() {
  if (typeof PopupNetworkState.toggleCustomKey === 'function') {
    return PopupNetworkState.toggleCustomKey();
  }
  const useDefault  = document.getElementById('use-default-key').checked;
  const customField = document.getElementById('custom-key-field');
  if (customField) customField.style.display = useDefault ? 'none' : 'block';
}

function updateNetworkBadge() {
  if (typeof PopupNetworkState.updateNetworkBadge === 'function') {
    return PopupNetworkState.updateNetworkBadge();
  }
  const badge = document.getElementById('network-badge');
  if (!badge) return;

  const networkMeta = getCurrentNetworkMeta();
  const isMainnet = !networkMeta.isTestnet;
  badge.classList.toggle('mainnet', isMainnet);
  badge.classList.toggle('testnet', !isMainnet);
  if (selectedNetwork === 'eth-mainnet') {
    badge.textContent = 'MAINNET • Ethereum Mainnet';
    return;
  }
  if (selectedNetwork === 'bsc') {
    badge.textContent = 'MAINNET • BNB Chain';
    return;
  }
  badge.textContent = 'TESTNET • Ethereum Sepolia';
}

async function ensureMainnetSendGuard() {
  if (typeof PopupNetworkState.ensureMainnetSendGuard === 'function') {
    return PopupNetworkState.ensureMainnetSendGuard();
  }
  const networkMeta = getCurrentNetworkMeta();
  if (networkMeta.isTestnet) return true;
  const networkGuardKey = getMainnetSendGuardKey();

  const { [networkGuardKey]: acceptedByNetwork, [LEGACY_MAINNET_SEND_GUARD_KEY]: acceptedLegacy } =
    await getLocal([networkGuardKey, LEGACY_MAINNET_SEND_GUARD_KEY]);
  if (acceptedByNetwork) return true;

  if (acceptedLegacy) {
    await setLocal({ [networkGuardKey]: true });
    return true;
  }

  const ok = confirm(
    `Вы отправляете транзакцию в ${networkMeta.label}.\n\n` +
    'Это реальная сеть и комиссия оплачивается реальными средствами.\n\n' +
    'Продолжить?'
  );

  if (ok) await setLocal({ [networkGuardKey]: true });
  return ok;
}

function syncNetworkControls() {
  if (typeof PopupNetworkState.syncNetworkControls === 'function') {
    return PopupNetworkState.syncNetworkControls();
  }
  applyNetworkPickerState('setup', selectedNetwork);
  applyNetworkPickerState('wallet', selectedNetwork);

  const useDefaultCheckbox = document.getElementById('use-default-key');
  const customField = document.getElementById('custom-key-field');
  const customRpcInput = document.getElementById('custom-rpc-url');
  const customForNetwork = rpcByNetwork[selectedNetwork] || '';
  const useDefault = !customForNetwork;

  if (useDefaultCheckbox) useDefaultCheckbox.checked = useDefault;
  if (customField) customField.style.display = useDefault ? 'none' : 'block';
  if (customRpcInput) {
    customRpcInput.value = customForNetwork;
    customRpcInput.placeholder = getCurrentNetworkMeta().defaultRpcUrl;
  }

  const balanceUnit = document.getElementById('wallet-balance-unit');
  if (balanceUnit) {
    balanceUnit.textContent = getNativeAssetSymbol();
  }

  updateNetworkBadge();
}

function getNetworkPickerOption(networkKey) {
  if (typeof PopupNetworkState.getNetworkPickerOption === 'function') {
    return PopupNetworkState.getNetworkPickerOption(networkKey);
  }
  return NETWORK_PICKER_OPTIONS[networkKey] || NETWORK_PICKER_OPTIONS[DEFAULT_NETWORK_KEY];
}

function applyNetworkPickerState(context, activeNetworkKey) {
  if (typeof PopupNetworkState.applyNetworkPickerState === 'function') {
    return PopupNetworkState.applyNetworkPickerState(context, activeNetworkKey);
  }
  const picker = document.getElementById(`network-picker-${context}`);
  if (!picker) return;

  const markEl = document.getElementById(`network-picker-mark-${context}`);
  const labelEl = document.getElementById(`network-picker-label-${context}`);
  const option = getNetworkPickerOption(activeNetworkKey);
  if (markEl) markEl.textContent = option.mark;
  if (labelEl) labelEl.textContent = option.label;

  picker.querySelectorAll('[data-network-option]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.networkOption === activeNetworkKey);
  });
}

function pulseNetworkPickers() {
  if (typeof PopupNetworkState.pulseNetworkPickers === 'function') {
    return PopupNetworkState.pulseNetworkPickers();
  }
  ['setup', 'wallet'].forEach((context) => {
    const trigger = document.querySelector(`#network-picker-${context} .network-picker-trigger`);
    if (!trigger) return;
    trigger.classList.remove('pulse');
    // Force reflow so repeated selections can replay animation.
    void trigger.offsetWidth;
    trigger.classList.add('pulse');
  });
}

function handleNetworkSelection(value) {
  if (typeof PopupNetworkState.handleNetworkSelection === 'function') {
    return PopupNetworkState.handleNetworkSelection(value);
  }
  if (!value) return;
  setNetwork(value);
}

function toggleNetworkPicker(context, event) {
  if (typeof PopupNetworkState.toggleNetworkPicker === 'function') {
    return PopupNetworkState.toggleNetworkPicker(context, event);
  }
  event?.stopPropagation();
  const picker = document.getElementById(`network-picker-${context}`);
  if (!picker) return;

  const shouldOpen = !picker.classList.contains('open');
  closeNetworkPickers();
  if (shouldOpen) picker.classList.add('open');
}

function closeNetworkPickers() {
  if (typeof PopupNetworkState.closeNetworkPickers === 'function') {
    return PopupNetworkState.closeNetworkPickers();
  }
  document.querySelectorAll('.network-picker.open').forEach((picker) => {
    picker.classList.remove('open');
  });
}

function selectNetworkOption(_context, value, event) {
  if (typeof PopupNetworkState.selectNetworkOption === 'function') {
    return PopupNetworkState.selectNetworkOption(_context, value, event);
  }
  event?.stopPropagation();
  closeNetworkPickers();
  handleNetworkSelection(value);
}

function initNetworkPickerInteractions() {
  if (typeof PopupNetworkState.initNetworkPickerInteractions === 'function') {
    return PopupNetworkState.initNetworkPickerInteractions();
  }
  document.addEventListener('click', (event) => {
    if (event.target.closest('.network-picker')) return;
    closeNetworkPickers();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNetworkPickers();
  });
}

async function setNetwork(networkKey) {
  if (typeof PopupNetworkState.setNetwork === 'function') {
    return PopupNetworkState.setNetwork(networkKey);
  }
  if (!NETWORKS[networkKey] || networkKey === selectedNetwork) return;

  const prevAddress = _autoRefreshAddress;
  stopAutoRefresh();

  selectedNetwork = networkKey;
  selectedChain = NETWORKS[networkKey].chain || DEFAULT_CHAIN_KEY;
  await setLocal({ selectedNetwork });
  await setLocal({ selectedChain });
  provider = getOrCreatePopupProvider(getRpcUrlForNetwork(selectedNetwork));
  syncNetworkControls();
  pulseNetworkPickers();

  if (isWalletScreenVisible()) {
    const { accounts = [] } = await getLocal(['accounts']);
    const address = accounts[activeAccountIndex]?.address;
    if (address) loadWalletScreen(address);
  } else if (prevAddress) {
    startAutoRefresh(prevAddress);
  }
}

// Отправляем сообщение в service worker и ждём ответа
function sendToSW(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

async function isActiveAccountUnlocked(expectedAddress) {
  if (!expectedAddress) return false;
  const result = await sendToSW({ type: 'get-wallet-address' });
  if (!result?.ok || !result.address) return false;
  return String(result.address).toLowerCase() === String(expectedAddress).toLowerCase();
}

async function ensureActiveAccountInSW(expectedAddress, accountIndex) {
  if (!expectedAddress || accountIndex == null) return false;
  if (await isActiveAccountUnlocked(expectedAddress)) return true;

  const activated = await sendToSW({ type: 'activate-account', accountIndex });
  if (!activated?.ok || !activated.activated) return false;
  return isActiveAccountUnlocked(expectedAddress);
}

// SW был убит Chrome (потерял _wallet) — сессия устарела, нужно разблокировать снова
async function handleSWLocked() {
  await chrome.storage.session.clear();
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  setAvatar('unlock-avatar', address);
  document.getElementById('unlock-address').textContent = shortAddr(address);
  showScreen('screen-unlock');
}
