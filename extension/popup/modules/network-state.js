'use strict';

import { WolfPopupSharedState } from './popup-state.js';
import { WolfPopupStorage } from './storage.js';

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
const setLocal = _Storage
  ? _Storage.setLocal.bind(_Storage)
  : (data) => new Promise((r) => chrome.storage.local.set(data, r));
const removeLocal = _Storage
  ? _Storage.removeLocal.bind(_Storage)
  : (keys) => new Promise((r) => chrome.storage.local.remove(keys, r));

async function getAccountsCached() {
  if (typeof globalThis.getAccountsCached === 'function') {
    return globalThis.getAccountsCached();
  }
  const { accounts = [] } = await getLocal(['accounts']);
  return Array.isArray(accounts) ? accounts : [];
}

function getPopupProvider(rpcUrl) {
  if (typeof globalThis.getOrCreatePopupProvider === 'function') {
    return globalThis.getOrCreatePopupProvider(rpcUrl);
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

const RPC_DEFAULTS =
  globalThis.WOLF_WALLET_RPC_DEFAULTS && typeof globalThis.WOLF_WALLET_RPC_DEFAULTS === 'object'
    ? globalThis.WOLF_WALLET_RPC_DEFAULTS
    : {};
const WalletNetworks =
  globalThis.WolfWalletNetworks && typeof globalThis.WolfWalletNetworks === 'object'
    ? globalThis.WolfWalletNetworks
    : null;

function getDefaultRpcUrl(networkKey, fallback) {
  return RPC_DEFAULTS[networkKey] || fallback;
}

const NETWORKS =
  WalletNetworks && typeof WalletNetworks.getNetworkConfigs === 'function'
    ? WalletNetworks.getNetworkConfigs(RPC_DEFAULTS)
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
          defaultRpcUrl: getDefaultRpcUrl(
            'eth-sepolia',
            'https://ethereum-sepolia-rpc.publicnode.com',
          ),
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
const DEFAULT_NETWORK_KEY = (WalletNetworks && WalletNetworks.DEFAULT_NETWORK_KEY) || 'eth-sepolia';
const DEFAULT_CHAIN_KEY = (WalletNetworks && WalletNetworks.DEFAULT_CHAIN_KEY) || 'ethereum';
const NETWORK_PICKER_OPTIONS = {
  'eth-mainnet': { label: 'Ethereum Mainnet', mark: '🔷' },
  'eth-sepolia': { label: 'Ethereum Sepolia', mark: '◻️' },
  bsc: { label: 'BNB Chain', mark: '🟡' },
};
// MED-13: консолидировано в shared/rpc-hosts.js (был дублирован в popup.js).
const ALLOWED_RPC_HOSTS =
  globalThis.WolfWalletRpcHosts && Array.isArray(globalThis.WolfWalletRpcHosts.ALLOWED_RPC_HOSTS)
    ? globalThis.WolfWalletRpcHosts.ALLOWED_RPC_HOSTS
    : [];
const MAINNET_SEND_GUARD_KEY_PREFIX = 'mainnetSendGuardAccepted';
const LEGACY_MAINNET_SEND_GUARD_KEY = 'mainnetSendGuardAccepted';

// ── Network state initialization ─────────────────────────────────────────

async function initializeNetworkState() {
  const stored = await getLocal(['selectedChain', 'selectedNetwork', 'rpcByNetwork', 'rpcUrl']);

  PopupState.selectedChain =
    stored.selectedChain === DEFAULT_CHAIN_KEY ? DEFAULT_CHAIN_KEY : DEFAULT_CHAIN_KEY;
  PopupState.selectedNetwork = NETWORKS[stored.selectedNetwork]
    ? stored.selectedNetwork
    : DEFAULT_NETWORK_KEY;
  PopupState.rpcByNetwork =
    stored.rpcByNetwork && typeof stored.rpcByNetwork === 'object'
      ? { ...stored.rpcByNetwork }
      : {};

  if (stored.rpcUrl && !PopupState.rpcByNetwork[PopupState.selectedNetwork]) {
    PopupState.rpcByNetwork[PopupState.selectedNetwork] = stored.rpcUrl;
  }

  await setLocal({
    selectedChain: PopupState.selectedChain,
    selectedNetwork: PopupState.selectedNetwork,
    rpcByNetwork: PopupState.rpcByNetwork,
  });
  if (stored.rpcUrl) await removeLocal('rpcUrl');
}

function getRpcUrlForNetwork(networkKey, map) {
  const m = map !== undefined ? map : PopupState.rpcByNetwork;
  const key = NETWORKS[networkKey] ? networkKey : DEFAULT_NETWORK_KEY;
  return m?.[key] || NETWORKS[key].defaultRpcUrl;
}

function getCurrentNetworkMeta() {
  return NETWORKS[PopupState.selectedNetwork] || NETWORKS[DEFAULT_NETWORK_KEY];
}

function getNativeAssetSymbol(networkKey) {
  const k = networkKey !== undefined ? networkKey : PopupState.selectedNetwork;
  return k === 'bsc' ? 'BNB' : 'ETH';
}

function getMainnetSendGuardKey(networkKey) {
  const k = networkKey !== undefined ? networkKey : PopupState.selectedNetwork;
  return `${MAINNET_SEND_GUARD_KEY_PREFIX}:${k}`;
}

// ── Network picker UI ─────────────────────────────────────────────────────

function getNetworkPickerOption(networkKey) {
  return NETWORK_PICKER_OPTIONS[networkKey] || NETWORK_PICKER_OPTIONS[DEFAULT_NETWORK_KEY];
}

function applyNetworkPickerState(context, activeNetworkKey) {
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
  ['setup', 'wallet', 'settings'].forEach((context) => {
    const trigger = document.querySelector(`#network-picker-${context} .network-picker-trigger`);
    if (!trigger) return;
    trigger.classList.remove('pulse');
    void trigger.offsetWidth;
    trigger.classList.add('pulse');
  });
}

function updateNetworkBadge() {
  const badge = document.getElementById('network-badge');
  if (!badge) return;

  const networkMeta = getCurrentNetworkMeta();
  const isMainnet = !networkMeta.isTestnet;
  badge.classList.toggle('mainnet', isMainnet);
  badge.classList.toggle('testnet', !isMainnet);
  if (PopupState.selectedNetwork === 'eth-mainnet') {
    badge.textContent = 'MAINNET • Ethereum Mainnet';
    return;
  }
  if (PopupState.selectedNetwork === 'bsc') {
    badge.textContent = 'MAINNET • BNB Chain';
    return;
  }
  badge.textContent = 'TESTNET • Ethereum Sepolia';
}

function syncNetworkControls() {
  applyNetworkPickerState('setup', PopupState.selectedNetwork);
  applyNetworkPickerState('wallet', PopupState.selectedNetwork);
  applyNetworkPickerState('settings', PopupState.selectedNetwork);

  const useDefaultCheckbox = document.getElementById('use-default-key');
  const customField = document.getElementById('custom-key-field');
  const customRpcInput = document.getElementById('custom-rpc-url');
  const customForNetwork = PopupState.rpcByNetwork[PopupState.selectedNetwork] || '';
  const useDefault = !customForNetwork;

  if (useDefaultCheckbox) useDefaultCheckbox.checked = useDefault;
  if (customField) customField.style.display = useDefault ? 'none' : 'block';
  if (customRpcInput) {
    customRpcInput.value = customForNetwork;
    customRpcInput.placeholder = getCurrentNetworkMeta().defaultRpcUrl;
  }

  // Sync settings screen RPC fields too
  const settingsCb = document.getElementById('settings-use-default-key');
  const settingsField = document.getElementById('settings-custom-key-field');
  const settingsRpc = document.getElementById('settings-custom-rpc-url');
  if (settingsCb) settingsCb.checked = useDefault;
  if (settingsField) settingsField.style.display = useDefault ? 'none' : 'block';
  if (settingsRpc) {
    settingsRpc.value = customForNetwork;
    settingsRpc.placeholder = getCurrentNetworkMeta().defaultRpcUrl;
  }

  const balanceUnit = document.getElementById('wallet-balance-unit');
  if (balanceUnit) balanceUnit.textContent = getNativeAssetSymbol();

  updateNetworkBadge();
}

// ── Network picker interactions ───────────────────────────────────────────

function handleNetworkSelection(value) {
  if (!value) return;
  // Вызываем globalThis.setNetwork (из popup.js), а не локальную setNetwork.
  // popup.js wrapper добавляет notifyChainChangedToDapps() — без этого dApp
  // не получает chainChanged event при смене сети в кошельке.
  const fn = typeof globalThis.setNetwork === 'function' ? globalThis.setNetwork : setNetwork;
  fn(value);
}

function toggleNetworkPicker(context, event) {
  event?.stopPropagation();
  const picker = document.getElementById(`network-picker-${context}`);
  if (!picker) return;

  const shouldOpen = !picker.classList.contains('open');
  closeNetworkPickers();
  if (shouldOpen) picker.classList.add('open');
}

function closeNetworkPickers() {
  document.querySelectorAll('.network-picker.open').forEach((picker) => {
    picker.classList.remove('open');
  });
}

function selectNetworkOption(_context, value, event) {
  event?.stopPropagation();
  closeNetworkPickers();
  handleNetworkSelection(value);
}

function initNetworkPickerInteractions() {
  document.addEventListener('click', (event) => {
    if (event.target.closest('.network-picker')) return;
    closeNetworkPickers();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeNetworkPickers();
  });
}

async function setNetwork(networkKey) {
  if (!NETWORKS[networkKey] || networkKey === PopupState.selectedNetwork) return;

  const prevAddress =
    typeof globalThis.getAutoRefreshAddress === 'function'
      ? globalThis.getAutoRefreshAddress()
      : null;

  if (typeof globalThis.stopAutoRefresh === 'function') globalThis.stopAutoRefresh();

  PopupState.selectedNetwork = networkKey;
  PopupState.selectedChain = NETWORKS[networkKey].chain || DEFAULT_CHAIN_KEY;
  await setLocal({ selectedNetwork: PopupState.selectedNetwork });
  await setLocal({ selectedChain: PopupState.selectedChain });
  PopupState.provider = getPopupProvider(getRpcUrlForNetwork(PopupState.selectedNetwork));
  syncNetworkControls();
  pulseNetworkPickers();

  const bus = globalThis.WolfPopupEventBus;
  if (bus) bus.emit(bus.Events.NETWORK_CHANGED, { networkKey, meta: NETWORKS[networkKey] });

  const isVisible =
    typeof globalThis.isWalletScreenVisible === 'function' && globalThis.isWalletScreenVisible();
  if (isVisible) {
    const accounts = await getAccountsCached();
    const address = accounts[PopupState.activeAccountIndex]?.address;
    if (address && typeof globalThis.loadWalletScreen === 'function') {
      globalThis.loadWalletScreen(address);
    }
  } else if (prevAddress && typeof globalThis.startAutoRefresh === 'function') {
    globalThis.startAutoRefresh(prevAddress);
  }
}

// ── RPC key / custom URL management ──────────────────────────────────────

function _readRpcChoice() {
  const useDefault = document.getElementById('use-default-key')?.checked !== false;
  const customUrl = document.getElementById('custom-rpc-url')?.value.trim() || '';

  if (!useDefault) {
    if (!customUrl) {
      return { ok: false, error: 'Введите RPC URL или используйте встроенный ключ' };
    }
    if (!customUrl.startsWith('https://')) {
      return { ok: false, error: 'URL должен начинаться с https://' };
    }
    let urlHost;
    try {
      urlHost = new URL(customUrl).hostname;
    } catch {
      return { ok: false, error: 'Некорректный URL' };
    }
    const allowed = ALLOWED_RPC_HOSTS.some((h) => urlHost === h || urlHost.endsWith(h));
    if (!allowed) {
      return {
        ok: false,
        error:
          'Провайдер не поддерживается. Используйте Alchemy, Infura, QuikNode, DRPC, Llamanodes, Ankr, Chainstack или 1RPC.',
      };
    }
  }

  return {
    ok: true,
    useDefault,
    url: useDefault ? null : customUrl,
    networkKey: PopupState.selectedNetwork,
  };
}

async function _saveRpcChoice(choice) {
  const prevAddress =
    typeof globalThis.getAutoRefreshAddress === 'function'
      ? globalThis.getAutoRefreshAddress()
      : null;

  if (typeof globalThis.stopAutoRefresh === 'function') globalThis.stopAutoRefresh();

  if (choice.useDefault) {
    delete PopupState.rpcByNetwork[choice.networkKey];
  } else {
    PopupState.rpcByNetwork[choice.networkKey] = choice.url;
  }
  await setLocal({ rpcByNetwork: PopupState.rpcByNetwork });

  PopupState.provider = getPopupProvider(getRpcUrlForNetwork(PopupState.selectedNetwork));
  syncNetworkControls();

  const isVisible =
    typeof globalThis.isWalletScreenVisible === 'function' && globalThis.isWalletScreenVisible();
  if (prevAddress && isVisible && typeof globalThis.startAutoRefresh === 'function') {
    globalThis.startAutoRefresh(prevAddress);
  }
}

function toggleCustomKey() {
  const useDefault = document.getElementById('use-default-key').checked;
  const customField = document.getElementById('custom-key-field');
  if (customField) customField.style.display = useDefault ? 'none' : 'block';
}

// ── Etherscan V2 API key (shared across networks) ────────────────────────
// Ключ бесплатный, 5 calls/sec. Публичный rate-limited — хранится в plain
// chrome.storage.local. Используется для tx-history fallback (Blockscout
// не поддерживает BSC, а для ETH/Sepolia — опциональный upgrade).

function _readEtherscanKeyFromUi() {
  const input = document.getElementById('etherscan-api-key');
  if (!input) return '';
  return String(input.value || '').trim();
}

async function saveEtherscanKey(value) {
  const trimmed = String(value || '').trim();
  // Базовая валидация: Etherscan ключи — 34 символа alnum. Пустая строка = удалить ключ.
  if (trimmed && !/^[A-Za-z0-9]{10,64}$/.test(trimmed)) {
    return { ok: false, error: 'Некорректный Etherscan ключ (10-64 символа, буквы/цифры)' };
  }
  if (trimmed) {
    await setLocal({ etherscanApiKey: trimmed });
  } else {
    await removeLocal('etherscanApiKey');
  }
  return { ok: true };
}

async function loadEtherscanKeyIntoUi() {
  const input = document.getElementById('etherscan-api-key');
  if (!input) return;
  const { etherscanApiKey } = await getLocal(['etherscanApiKey']);
  input.value = typeof etherscanApiKey === 'string' ? etherscanApiKey : '';
}

async function getStoredEtherscanKey() {
  const { etherscanApiKey } = await getLocal(['etherscanApiKey']);
  return typeof etherscanApiKey === 'string' ? etherscanApiKey.trim() : '';
}

// ── Mainnet send guard ────────────────────────────────────────────────────

async function ensureMainnetSendGuard() {
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
      'Продолжить?',
  );

  if (ok) await setLocal({ [networkGuardKey]: true });
  return ok;
}

export const WolfPopupNetworkState = {
  NETWORKS,
  DEFAULT_NETWORK_KEY,
  DEFAULT_CHAIN_KEY,
  NETWORK_PICKER_OPTIONS,
  ALLOWED_RPC_HOSTS,
  getDefaultRpcUrl,
  initializeNetworkState,
  getRpcUrlForNetwork,
  getCurrentNetworkMeta,
  getNativeAssetSymbol,
  getMainnetSendGuardKey,
  getNetworkPickerOption,
  applyNetworkPickerState,
  syncNetworkControls,
  updateNetworkBadge,
  handleNetworkSelection,
  toggleNetworkPicker,
  closeNetworkPickers,
  selectNetworkOption,
  initNetworkPickerInteractions,
  setNetwork,
  pulseNetworkPickers,
  ensureMainnetSendGuard,
  _readRpcChoice,
  _saveRpcChoice,
  toggleCustomKey,
  // Etherscan V2 API key management
  _readEtherscanKeyFromUi,
  saveEtherscanKey,
  loadEtherscanKeyIntoUi,
  getStoredEtherscanKey,
};
globalThis.WolfPopupNetworkState = WolfPopupNetworkState;
