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
const PopupDappApproval = (globalThis.WolfPopupDappApproval && typeof globalThis.WolfPopupDappApproval === 'object')
  ? globalThis.WolfPopupDappApproval
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
      defaultRpcUrl: getDefaultRpcUrl('bsc', 'https://bsc-rpc.publicnode.com'),
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
  // Ограничиваем кэш — максимум 6 провайдеров (по 2 на сеть: default + custom).
  // При превышении удаляем самый старый (первый добавленный).
  if (_providerCache.size >= 6) {
    const oldest = _providerCache.keys().next().value;
    _providerCache.delete(oldest);
  }
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

// P2-6: fallback'и удалены, модули гарантированно загружены через assertModulesLoaded
async function getTokensForSelectedNetwork() {
  return PopupTokenState.getTokensForSelectedNetwork();
}

async function setTokensForSelectedNetwork(tokens) {
  return PopupTokenState.setTokensForSelectedNetwork(tokens);
}

// Мнемоника хранится только в памяти во время квиза — после прохождения обнуляется
let _pendingMnemonic  = null;
let _quizPositions    = []; // три случайных индекса [0..11]
let _pendingTx        = null; // данные транзакции, ожидающей подтверждения

// ── P2-6: Module loading assertion ──────────────────────────────────────
// Все модули должны быть загружены через popup.html ДО popup.js (см. порядок
// <script> тегов). Если модуль отсутствует — popup просто blank без объяснения,
// поэтому делаем явную проверку на старте с понятным error message.
function assertModulesLoaded() {
  const requirements = {
    WolfPopupStorage: ['getLocal', 'setLocal', 'removeLocal', 'getSession', 'setSession'],
    WolfPopupUiMessages: ['showError', 'setStatus', 'showSuccess', 'clearMessages', 'setLoading'],
    WolfPopupAvatar: ['setAvatar'],
    WolfPopupClipboard: ['copyText'],
    WolfPopupTemplates: ['renderNetworkPickers', 'renderFeedbackMounts'],
    WolfPopupSharedState: [],
    WolfPopupNetworkState: ['initializeNetworkState', 'getRpcUrlForNetwork', 'getCurrentNetworkMeta', 'setNetwork'],
    WolfPopupTxHistory: ['loadTransactions', 'fetchAlchemyTransfers', 'renderTransactions'],
    WolfPopupTokenState: ['getTokensForSelectedNetwork', 'loadTokenBalances', 'fetchTokenInfo'],
    WolfPopupSendFlow: ['sendTransaction', 'confirmSend', 'showSendScreen'],
    WolfPopupUiState: ['showScreen', 'switchTab', 'switchWalletTab'],
    WolfPopupEventBinder: ['bindDeclarativeHandlers'],
    WolfPopupDappApproval: ['getRequestIdFromUrl', 'handleRequest', 'renderConnectedSitesList'],
  };
  for (const [name, methods] of Object.entries(requirements)) {
    const mod = globalThis[name];
    if (!mod) {
      throw new Error(`Required module not loaded: ${name}. Check popup.html script order.`);
    }
    for (const m of methods) {
      if (typeof mod[m] !== 'function') {
        throw new Error(`${name}.${m} is missing or not a function`);
      }
    }
  }
}

// ── Инициализация (с миграцией старого формата) ───────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // P2-6: Assert все модули загружены ДО любой бизнес-логики.
  // Если упало — показываем понятный error overlay.
  try {
    assertModulesLoaded();
  } catch (e) {
    console.error('[SOVA bootstrap]', e);
    document.body.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'padding:24px;color:#f87171;font-family:monospace;';
    const title = document.createElement('h2');
    title.textContent = 'Ошибка инициализации SOVA Wallet';
    const msg = document.createElement('p');
    msg.style.cssText = 'margin-top:12px;font-size:13px;color:#888';
    msg.textContent = e.message;
    overlay.appendChild(title);
    overlay.appendChild(msg);
    document.body.appendChild(overlay);
    return;
  }

  // LOW-14: Весь init обёрнут в try/catch. Если что-то упадёт —
  // показываем error overlay вместо blank popup.
  try {
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
    PopupNetworkState.loadEtherscanKeyIntoUi().catch(() => {});

    // ── dApp approval mode: открыты с ?request=<id> в URL ──────────────
    const dappRequestId = PopupDappApproval.getRequestIdFromUrl();
    if (dappRequestId) {
      showScreen('screen-dapp-approval');
      PopupDappApproval.handleRequest(dappRequestId);
      return;
    }

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
    if (!current?.address) {
      console.error('[popup] stored account has no address', { activeAccountIndex, total: accounts.length });
      showScreen('screen-setup');
      return;
    }
    const currentName = current.name || `Account ${activeAccountIndex + 1}`;
    const { unlocked, unlockTime } = await getSession(['unlocked', 'unlockTime']);
    const expired = !unlockTime || (Date.now() - unlockTime > AUTO_LOCK_MINUTES * 60 * 1000);

    const goToUnlockFor = (acctName, acctAddress, statusText) => {
      setAvatar('unlock-avatar', acctAddress);
      document.getElementById('unlock-address').textContent = `${acctName} · ${shortAddr(acctAddress)}`;
      document.getElementById('unlock-password').value = '';
      clearMessages('unlock');
      if (statusText) setStatus('unlock', statusText);
      showScreen('screen-unlock');
      setTimeout(() => document.getElementById('unlock-password')?.focus(), 50);
    };

    if (!unlocked || expired) {
      goToUnlockFor(currentName, current.address, expired && unlocked ? 'Сессия истекла — войдите снова' : null);
    } else {
      if (await ensureActiveAccountInSW(current.address, activeAccountIndex)) {
        await setSession({ unlockTime: Date.now() });
        showScreen('screen-wallet');
        loadWalletScreen(current.address);
      } else {
        await chrome.storage.session.clear();
        goToUnlockFor(currentName, current.address, 'Сессия обновлена — введите пароль');
      }
    }
  } catch (initErr) {
    // LOW-14: error overlay. Без этого popup остаётся blank.
    console.error('[SOVA popup init]', initErr);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'padding:24px;color:#f87171;font-family:monospace;';
    const title = document.createElement('h2');
    title.textContent = 'Ошибка инициализации';
    const msg = document.createElement('p');
    msg.style.cssText = 'margin-top:12px;font-size:13px;color:#888;word-break:break-all;';
    msg.textContent = initErr.message || String(initErr);
    overlay.appendChild(title);
    overlay.appendChild(msg);
    document.body.appendChild(overlay);
  }
});

// P2-6: fallback удалён, PopupEventBinder загружен из modules/event-binder.js
function bindDeclarativeHandlers() {
  return PopupEventBinder.bindDeclarativeHandlers();
}

// P2-6: fallback'и удалены — все функции делегированы модулям
async function initializeNetworkState() {
  return PopupNetworkState.initializeNetworkState();
}

function getRpcUrlForNetwork(networkKey, map = rpcByNetwork) {
  return PopupNetworkState.getRpcUrlForNetwork(networkKey, map);
}

function getCurrentNetworkMeta() {
  return PopupNetworkState.getCurrentNetworkMeta();
}

function getNativeAssetSymbol(networkKey = selectedNetwork) {
  return PopupNetworkState.getNativeAssetSymbol(networkKey);
}

function getMainnetSendGuardKey(networkKey = selectedNetwork) {
  return PopupNetworkState.getMainnetSendGuardKey(networkKey);
}

// ── Навигация ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  return PopupUiState.showScreen(id);
}

function switchTab(tab) {
  return PopupUiState.switchTab(tab);
}

function switchWalletTab(tab) {
  return PopupUiState.switchWalletTab(tab);
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

    // Опционально: сохраняем Etherscan V2 ключ, если пользователь ввёл его
    // в setup-форме. Ключ бесплатный, нужен для истории транзакций на BSC
    // и опционально даёт более полную историю на других сетях.
    await PopupNetworkState.saveEtherscanKey(PopupNetworkState._readEtherscanKeyFromUi());

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

    // Опционально: сохраняем Etherscan V2 ключ, если пользователь ввёл его
    await PopupNetworkState.saveEtherscanKey(PopupNetworkState._readEtherscanKeyFromUi());

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

  // MED-11: address null-check. Если accounts пусты или index out-of-bounds,
  // не крешим с "Cannot read properties of undefined", а возвращаемся в setup.
  const accounts = await getAccountsCached();
  const acct = accounts[activeAccountIndex];
  if (!acct?.address) {
    console.error('[popup] active account missing after unlock', { activeAccountIndex, total: accounts.length });
    showScreen('screen-setup');
    return;
  }
  showScreen('screen-wallet');
  loadWalletScreen(acct.address);
}

// ── Экран кошелька ────────────────────────────────────────────────────────────
async function loadWalletScreen(address) {
  // MED-11: defensive — не пытаемся что-либо показывать без адреса.
  if (!address) {
    console.error('[popup] loadWalletScreen called without address');
    showScreen('screen-setup');
    return;
  }
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
  setBalanceRefreshIndicator(true);
  try {
    await Promise.all([
      loadBalance(address),
      loadTokenBalances(address),
      loadTransactions(address),
    ]);
  } finally {
    _autoRefreshInFlight = false;
    setBalanceRefreshIndicator(false);
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
      formatAmount(parseFloat(ethers.formatEther(wei)));
  } catch {
    document.getElementById('wallet-balance').textContent = '—';
  }
}

function setBalanceRefreshIndicator(active) {
  const el = document.getElementById('balance-refresh-indicator');
  if (el) el.classList.toggle('active', !!active);
  setTxRefreshIndicator(active);
}

async function refreshBalance() {
  const accounts = await getAccountsCached();
  const address = accounts[activeAccountIndex]?.address;
  if (!address) return;
  _autoRefreshAddress = address.toLowerCase();
  setBalanceRefreshIndicator(true);

  // Балансы обновляем сразу, а транзакции — в фоне, чтобы UI реагировал быстрее.
  try {
    await Promise.all([
      loadBalance(address),
      loadTokenBalances(address),
    ]);
    loadTransactions(address);
  } finally {
    setBalanceRefreshIndicator(false);
  }
}

// ── ERC-20 токены (P2-6: fallback'и удалены, делегируются в PopupTokenState) ──
async function loadTokenBalances(address) {
  return PopupTokenState.loadTokenBalances(address);
}

function onTokenAddrChange() {
  return PopupTokenState.onTokenAddrChange();
}

async function fetchTokenInfo() {
  return PopupTokenState.fetchTokenInfo();
}

async function addToken() {
  return PopupTokenState.addToken();
}

async function removeToken(addr) {
  return PopupTokenState.removeToken(addr);
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

  const targetAccount = accounts[idx];
  const targetAddress = targetAccount.address;
  const targetName = targetAccount.name || `Account ${idx + 1}`;

  if (await ensureActiveAccountInSW(targetAddress, idx)) {
    showScreen('screen-wallet');
    loadWalletScreen(targetAddress);
    return;
  }

  // SW потерял этот кошелёк (Chrome убил SW, или другой keystore).
  // Чистим устаревший session-флаг и показываем unlock screen
  // с ЯВНЫМ указанием какой именно аккаунт разблокируем.
  await chrome.storage.session.clear();

  setAvatar('unlock-avatar', targetAddress);
  document.getElementById('unlock-address').textContent = `${targetName} · ${shortAddr(targetAddress)}`;
  document.getElementById('unlock-password').value = '';
  clearMessages('unlock');
  setStatus('unlock', `Введите пароль для ${targetName}`);
  showScreen('screen-unlock');
  // Фокусируем поле ввода пароля, чтобы пользователь сразу мог печатать
  setTimeout(() => document.getElementById('unlock-password')?.focus(), 50);
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
  // P2-5: invalidate accounts cache, иначе renderAccountMenu вернёт стейл данные
  // (без только что добавленного субаккаунта)
  setAccountsCache(accounts);

  document.getElementById('add-account-password').value = '';
  setLoading('btn-add-account', false);
  setStatus('add-account', '');
  showScreen('screen-wallet');
  loadWalletScreen(result.address);
}

// P2-6: fallback удалён, модуль PopupTxHistory гарантированно загружен
// (см. assertModulesLoaded в bootstrap)
async function loadTransactions(address) {
  return PopupTxHistory.loadTransactions(address);
}

// P2-6: tx-history функции делегированы PopupTxHistory модулю
function setTxRefreshIndicator(active) {
  return PopupTxHistory.setTxRefreshIndicator(active);
}

function renderTransactions(el, address, txs, networkKey = selectedNetwork) {
  return PopupTxHistory.renderTransactions(el, address, txs, networkKey);
}

function updateTxPaginationUI(scopeKey, totalTxs, currentPage, totalPages) {
  return PopupTxHistory.updateTxPaginationUI(scopeKey, totalTxs, currentPage, totalPages);
}

async function changeTxPage(delta) {
  return PopupTxHistory.changeTxPage(delta);
}

async function copyTxHash(hash, buttonEl) {
  return PopupTxHistory.copyTxHash(hash, buttonEl);
}

async function fetchAlchemyTransfers(address, direction, opts = {}) {
  return PopupTxHistory.fetchAlchemyTransfers(address, direction, opts);
}

// ── Отправка транзакции (P2-6: делегировано в PopupSendFlow) ─────────────
async function showSendScreen() {
  return PopupSendFlow.showSendScreen();
}

function resetSendFlowUI({ clearInputs = false } = {}) {
  return PopupSendFlow.resetSendFlowUI({ clearInputs });
}

async function sendTransaction() {
  return PopupSendFlow.sendTransaction();
}

async function confirmSend() {
  return PopupSendFlow.confirmSend();
}

function cancelSend() {
  return PopupSendFlow.cancelSend();
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

// LOW-15: Выбираем 5 случайных уникальных позиций из 12 (было 3).
// 5 из 12 → ~5% шанс угадать все (1/C(12,5)≈0.13%, фактически ниже
// из-за порядка). 3 из 12 было слишком мало для security.
const QUIZ_WORD_COUNT = 5;
function _pickQuizPositions() {
  const positions = new Set();
  while (positions.size < QUIZ_WORD_COUNT) {
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
    if (i === QUIZ_WORD_COUNT - 1) inp.addEventListener('keydown', e => { if (e.key === 'Enter') verifyQuiz(); });

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
  const acct = accounts[activeAccountIndex];
  const address = acct?.address;
  const name = acct?.name || `Account ${activeAccountIndex + 1}`;
  setAvatar('unlock-avatar', address);
  document.getElementById('unlock-address').textContent = address ? `${name} · ${shortAddr(address)}` : '';
  document.getElementById('unlock-password').value = '';
  clearMessages('unlock');
  showScreen('screen-unlock');
  setTimeout(() => document.getElementById('unlock-password')?.focus(), 50);
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

// ── RPC hosts whitelist (MED-13: консолидировано в shared/rpc-hosts.js) ─
// Раньше дублировалось тут и в network-state.js. Теперь оба импортируют
// из единого источника правды WolfWalletRpcHosts.
const ALLOWED_RPC_HOSTS = (globalThis.WolfWalletRpcHosts && Array.isArray(globalThis.WolfWalletRpcHosts.ALLOWED_RPC_HOSTS))
  ? globalThis.WolfWalletRpcHosts.ALLOWED_RPC_HOSTS
  : [];

// ── Network functions (P2-6: делегированы в PopupNetworkState) ────────────
function _readRpcChoice() {
  return PopupNetworkState._readRpcChoice();
}

async function _saveRpcChoice(choice) {
  return PopupNetworkState._saveRpcChoice(choice);
}

function toggleCustomKey() {
  return PopupNetworkState.toggleCustomKey();
}

// Etherscan V2 API key (shared) — для tx-history fallback. См. network-state.js.
async function saveEtherscanKeyFromInput() {
  const input = document.getElementById('etherscan-api-key');
  if (!input) return;
  const res = await PopupNetworkState.saveEtherscanKey(input.value || '');
  if (!res.ok) {
    console.warn('[popup] saveEtherscanKey:', res.error);
  }
  // После сохранения — перезагружаем историю текущего аккаунта.
  const accounts = await getAccountsCached();
  const acct = accounts[activeAccountIndex];
  if (acct?.address && typeof globalThis.loadTransactions === 'function') {
    await globalThis.loadTransactions(acct.address);
  }
}
globalThis.saveEtherscanKeyFromInput = saveEtherscanKeyFromInput;

function updateNetworkBadge() {
  return PopupNetworkState.updateNetworkBadge();
}

async function ensureMainnetSendGuard() {
  return PopupNetworkState.ensureMainnetSendGuard();
}

function syncNetworkControls() {
  return PopupNetworkState.syncNetworkControls();
}

function getNetworkPickerOption(networkKey) {
  return PopupNetworkState.getNetworkPickerOption(networkKey);
}

function applyNetworkPickerState(context, activeNetworkKey) {
  return PopupNetworkState.applyNetworkPickerState(context, activeNetworkKey);
}

function pulseNetworkPickers() {
  return PopupNetworkState.pulseNetworkPickers();
}

function handleNetworkSelection(value) {
  return PopupNetworkState.handleNetworkSelection(value);
}

function toggleNetworkPicker(context, event) {
  return PopupNetworkState.toggleNetworkPicker(context, event);
}

function closeNetworkPickers() {
  return PopupNetworkState.closeNetworkPickers();
}

function selectNetworkOption(_context, value, event) {
  return PopupNetworkState.selectNetworkOption(_context, value, event);
}

function initNetworkPickerInteractions() {
  return PopupNetworkState.initNetworkPickerInteractions();
}

async function setNetwork(networkKey) {
  const result = await PopupNetworkState.setNetwork(networkKey);
  notifyChainChangedToDapps(networkKey);
  return result;
}

// Broadcast chainChanged всем подключённым dApp'ам через service worker.
function notifyChainChangedToDapps(networkKey) {
  const cfg = NETWORKS[networkKey];
  if (!cfg) return;
  const chainIdHex = '0x' + Number(cfg.chainId).toString(16);
  try {
    chrome.runtime.sendMessage({ type: 'network-changed', chainIdHex }, () => {
      // Игнорируем lastError — broadcast идёт fire-and-forget
      if (chrome.runtime.lastError) { /* noop */ }
    });
  } catch { /* ignore */ }
}

// Открыть экран Connected Sites и отрендерить список
async function openConnectedSites() {
  document.getElementById('acct-menu')?.classList.add('hidden');
  showScreen('screen-connected-sites');
  PopupDappApproval.renderConnectedSitesList('connected-sites-list');
}
globalThis.openConnectedSites = openConnectedSites;

// Отправляем сообщение в service worker и ждём ответа.
// Таймаут 15 сек — защита от зависания если SW умер или не отвечает.
function sendToSW(msg) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: 'Service Worker не отвечает (timeout)' });
    }, 15000);
    chrome.runtime.sendMessage(msg, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
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
  const acct = accounts[activeAccountIndex];
  const address = acct?.address;
  const name = acct?.name || `Account ${activeAccountIndex + 1}`;
  setAvatar('unlock-avatar', address);
  document.getElementById('unlock-address').textContent = address ? `${name} · ${shortAddr(address)}` : '';
  document.getElementById('unlock-password').value = '';
  clearMessages('unlock');
  setStatus('unlock', 'Сессия обновлена — введите пароль');
  showScreen('screen-unlock');
  setTimeout(() => document.getElementById('unlock-password')?.focus(), 50);
}
