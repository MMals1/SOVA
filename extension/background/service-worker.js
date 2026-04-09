'use strict';

// Ethers.js нужен SW для расшифровки keystore и подписи транзакций
importScripts('../libs/ethers.umd.min.js');
importScripts('../network-config.js');
importScripts('../shared/networks.js');

// LOW-1 + LOW-10: debug flag. В production логи отключены — console.error
// может утекать диагностику (chain id, origin, params в stack trace).
// Включается через chrome.storage.local.debugSW = true.
let _debugEnabled = false;
try {
  chrome.storage.local.get(['debugSW'], ({ debugSW }) => {
    _debugEnabled = !!debugSW;
  });
} catch { /* ignore */ }
function _swLog(...args) {
  if (_debugEnabled) console.error(...args);
}

const RPC_DEFAULTS = (globalThis.WOLF_WALLET_RPC_DEFAULTS && typeof globalThis.WOLF_WALLET_RPC_DEFAULTS === 'object')
  ? globalThis.WOLF_WALLET_RPC_DEFAULTS
  : {};

function getDefaultRpcUrl(networkKey, fallback) {
  return RPC_DEFAULTS[networkKey] || fallback;
}

const WalletNetworks = (globalThis.WolfWalletNetworks && typeof globalThis.WolfWalletNetworks === 'object')
  ? globalThis.WolfWalletNetworks
  : null;

const NETWORKS = (WalletNetworks && typeof WalletNetworks.getNetworkConfigs === 'function')
  ? WalletNetworks.getNetworkConfigs(RPC_DEFAULTS)
  : {
    'eth-mainnet': { chainId: 1, defaultRpcUrl: getDefaultRpcUrl('eth-mainnet', 'https://ethereum-rpc.publicnode.com') },
    'eth-sepolia': { chainId: 11155111, defaultRpcUrl: getDefaultRpcUrl('eth-sepolia', 'https://ethereum-sepolia-rpc.publicnode.com') },
    bsc: { chainId: 56, defaultRpcUrl: getDefaultRpcUrl('bsc', 'https://bsc-rpc.publicnode.com') },
  };
const DEFAULT_NETWORK_KEY = (WalletNetworks && WalletNetworks.DEFAULT_NETWORK_KEY) || 'eth-sepolia';
const LOCK_ALARM     = 'auto-lock';
const LOCK_DELAY_MIN = 5;

// TTL для pending dApp-запросов (секунды).
const DAPP_REQUEST_TTL_MS = 60 * 1000;

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
];

// ── Единственное место в приложении где живёт расшифрованный ключ ─────────────
// Popup.js доступа к этой переменной не имеет — она изолирована в SW контексте.
// Если Chrome убивает SW в фоне — _wallet сбрасывается, пользователь должен
// разблокировать снова (стандартное поведение, как у MetaMask).
const _walletsByAddress = new Map();
let _activeWalletAddress = null;

// MED-17: LRU cap для _walletsByAddress.
// У каждого ethers.Wallet объекта ~10 KB. При 20 субаккаунтах — 200 KB в памяти SW.
// При 100+ может уже стать проблемой. Применяем LRU: при превышении
// удаляем самый старый (кроме активного).
const MAX_UNLOCKED_WALLETS = 20;

function rememberUnlockedWallet(walletKey, wallet) {
  if (_walletsByAddress.size >= MAX_UNLOCKED_WALLETS && !_walletsByAddress.has(walletKey)) {
    // Удалить самый старый кроме активного
    for (const k of _walletsByAddress.keys()) {
      if (k !== _activeWalletAddress) {
        _walletsByAddress.delete(k);
        break;
      }
    }
  }
  _walletsByAddress.set(walletKey, wallet);
}

// MED-7: LRU + TTL для connectedOrigins.
// Ограничиваем размер (100 origin'ов) и автоматически чистим записи
// старше 90 дней (по lastUsedAt). Защита от unbounded growth storage'а.
const MAX_CONNECTED_ORIGINS = 100;
const CONNECTED_ORIGIN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 дней

function enforceConnectedOriginsLimits(connectedOrigins) {
  const entries = Object.entries(connectedOrigins || {});
  const now = Date.now();
  // 1. Удаляем expired (lastUsedAt > 90 дней назад)
  const fresh = entries.filter(([_, rec]) => {
    const last = rec?.lastUsedAt || rec?.connectedAt || 0;
    return (now - last) < CONNECTED_ORIGIN_TTL_MS;
  });
  // 2. Если всё ещё > cap — оставляем top-N по lastUsedAt (LRU eviction)
  if (fresh.length > MAX_CONNECTED_ORIGINS) {
    fresh.sort((a, b) => (b[1]?.lastUsedAt || 0) - (a[1]?.lastUsedAt || 0));
    fresh.length = MAX_CONNECTED_ORIGINS;
  }
  return Object.fromEntries(fresh);
}

// ── Bruteforce protection (PERSISTENT) ──────────────────────────────────────
// Lockout state хранится в chrome.storage.local (НЕ в памяти SW), чтобы
// перезапуск SW не сбрасывал счётчик попыток. MV3 убивает SW при простое
// каждые ~30 секунд, и без persistence атакующий мог бы перезапускать SW
// между попытками подбора пароля и обнулять счётчик.
const LOCKOUT_KEY = 'security:lockout';
const MAX_LOCKOUT_MS = 15 * 60 * 1000; // 15 минут (cap при множественных неудачах)

async function getLockoutState() {
  const { [LOCKOUT_KEY]: state = { failedAttempts: 0, lockoutUntil: 0 } } =
    await chrome.storage.local.get([LOCKOUT_KEY]);
  return state;
}

async function recordFailedAttempt() {
  const state = await getLockoutState();
  const next = state.failedAttempts + 1;
  // Exponential backoff: 3 → 5 сек, 4 → 10, 5 → 20, 6 → 40, 7 → 80, ..., cap 15 мин
  const lockoutUntil = next >= 3
    ? Date.now() + Math.min(MAX_LOCKOUT_MS, 5_000 * Math.pow(2, next - 3))
    : 0;
  await chrome.storage.local.set({
    [LOCKOUT_KEY]: { failedAttempts: next, lockoutUntil },
  });
}

async function resetLockoutState() {
  await chrome.storage.local.remove([LOCKOUT_KEY]);
}

// ── Pending dApp approvals ────────────────────────────────────────────────
// В MV3 service worker может быть killed → persist'им в chrome.storage.session,
// но в memory держим резолверы (они теряются при рестарте, поэтому даём клиенту
// ошибку "request expired" если SW перезапустился).
const _pendingApprovals = new Map();
// id -> { resolve, reject, origin, method, params, createdAt, expiresAt, _windowId }

// Listener на закрытие approval window — если пользователь закрыл окно крестиком
// (не нажав ни одну кнопку), нужно отклонить pending approval, иначе оно застрянет
// до истечения TTL и следующие запросы от origin будут получать 4001.
if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener((closedWindowId) => {
    for (const [id, entry] of _pendingApprovals.entries()) {
      if (entry._windowId === closedWindowId) {
        clearTimeout(entry._timer);
        _pendingApprovals.delete(id);
        removePendingFromStorage(id).catch(() => {});
        try {
          entry.resolve({ approved: false, rejected: true, reason: 'window-closed' });
        } catch { /* ignore */ }
      }
    }
  });
}

function getActiveWallet() {
  if (!_activeWalletAddress) return null;
  return _walletsByAddress.get(_activeWalletAddress) || null;
}

function clearUnlockedWallets() {
  _walletsByAddress.clear();
  _activeWalletAddress = null;
}

// ── Sender validation helpers ───────────────────────────────────────────────
// Защита от cross-context спуфинга. Сообщения должны приходить либо из
// extension popup (без tab), либо из НАШЕГО content-script (с tab).
// Предотвращает: malicious dApp шлёт chrome.runtime.sendMessage напрямую
// через свой content script и пытается обойти approval flow.

function isFromExtensionContext(sender) {
  // Сообщения из наших extension-pages: либо основной popup (chrome.action.openPopup)
  // — у него sender.tab = undefined, либо approval window, открытое через
  // chrome.windows.create({ type:'popup', url: chrome-extension://... }) — у него
  // sender.tab ЕСТЬ, но URL вкладки — это chrome-extension://<id>/popup/...
  //
  // Отклоняем только в случае если это content-script (tab с http(s):// URL'ом).
  if (!sender) return false;
  if (sender.id !== chrome.runtime.id) return false;
  if (!sender.tab) return true; // классический popup без tab — наш
  // sender.tab есть — проверим что это наша extension page, а не веб-сайт
  const tabUrl = String(sender.tab.url || sender.url || '');
  const ourPrefix = `chrome-extension://${chrome.runtime.id}/`;
  return tabUrl.startsWith(ourPrefix);
}

function isFromOurContentScript(sender) {
  // Только наши content-script'ы на веб-страницах (http(s)://). Extension pages
  // (chrome-extension://<id>/...) — это popup/approval, не content-script.
  if (!sender || !sender.tab || !sender.tab.url) return false;
  if (sender.id !== chrome.runtime.id) return false;
  const tabUrl = String(sender.tab.url);
  const ourPrefix = `chrome-extension://${chrome.runtime.id}/`;
  if (tabUrl.startsWith(ourPrefix)) return false; // это extension page, не content-script
  return true;
}

// Типы сообщений которые могут приходить ТОЛЬКО из popup/approval context
const POPUP_ONLY_MESSAGE_TYPES = new Set([
  'unlock',
  'lock',
  'activate-account',
  'add-sub-account',
  'reset-lock-timer',
  'get-wallet-address',
  'network-changed',
  // Signing operations — popup-инициированные транзакции (кнопка "Отправить")
  'send-eth',
  'send-erc20',
  // dApp approval lifecycle — отправляется из approval popup окна
  'dapp-approval-response',
  'dapp-disconnect-origin',
  'dapp-get-pending',
]);

// Типы сообщений которые могут приходить ТОЛЬКО из content-script
const CONTENT_SCRIPT_MESSAGE_TYPES = new Set([
  'dapp-request',
]);

// ── Обработка сообщений от popup ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(result => sendResponse(result && typeof result === 'object' && ('id' in result || 'result' in result || 'error' in result)
      ? result
      : { ok: true,  ...result }))
    .catch(err   => sendResponse({ ok: false, error: err.message }));
  return true; // держим канал открытым для async ответа
});

async function handleMessage(msg, sender) {
  // ── Sender validation: гарантируем что сообщение пришло из правильного контекста ──
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    throw new Error('Invalid message format');
  }
  if (POPUP_ONLY_MESSAGE_TYPES.has(msg.type)) {
    if (!isFromExtensionContext(sender)) {
      const e = new Error(`Permission denied: '${msg.type}' must come from extension popup`);
      e.code = 4100;
      throw e;
    }
  } else if (CONTENT_SCRIPT_MESSAGE_TYPES.has(msg.type)) {
    if (!isFromOurContentScript(sender)) {
      // dapp-request — особый случай: возвращаем RPC-style envelope с ошибкой
      return rpcError(
        msg.payload?.id,
        -32603,
        'Permission denied: dapp-request must come from content script'
      );
    }
  } else {
    throw new Error(`Unknown message type: ${msg.type}`);
  }

  switch (msg.type) {

    // ── Popup ↔ SW (существующие) ───────────────────────────────────────────

    // Расшифровываем keystore и сохраняем wallet в памяти SW
    case 'unlock': {
      if (msg.accountIndex == null || typeof msg.accountIndex !== 'number')
        throw new Error('Invalid account index');
      if (!msg.password || typeof msg.password !== 'string')
        throw new Error('Invalid password');
      // Проверяем persistent lockout state (не in-memory!)
      const lockoutState = await getLockoutState();
      if (Date.now() < lockoutState.lockoutUntil) {
        const waitSec = Math.ceil((lockoutState.lockoutUntil - Date.now()) / 1000);
        throw new Error(`Подождите ${waitSec} сек`);
      }
      const { accounts } = await chrome.storage.local.get(['accounts']);
      if (!accounts?.[msg.accountIndex]?.keystore) {
        throw new Error('Аккаунт не найден');
      }
      try {
        const unlockedWallet = await ethers.Wallet.fromEncryptedJson(
          accounts[msg.accountIndex].keystore,
          msg.password
        );
        const walletKey = String(unlockedWallet.address).toLowerCase();
        rememberUnlockedWallet(walletKey, unlockedWallet); // MED-17 LRU cap
        _activeWalletAddress = walletKey;
      } catch {
        await recordFailedAttempt();
        throw new Error('Неверный пароль');
      }
      await resetLockoutState();
      await chrome.storage.session.set({ unlocked: true, unlockTime: Date.now() });
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
      // Broadcast accountsChanged всем подключённым origin'ам — теперь есть активный адрес
      broadcastAccountsChanged().catch(() => {});
      return {};
    }

    // Блокируем — обнуляем ключ из памяти
    case 'lock': {
      clearUnlockedWallets();
      await chrome.storage.session.clear();
      chrome.alarms.clear(LOCK_ALARM);
      // Broadcast: все dApp'ы теряют доступ к аккаунту
      broadcastAccountsChanged([]).catch(() => {});
      return {};
    }

    case 'activate-account': {
      if (msg.accountIndex == null || typeof msg.accountIndex !== 'number')
        throw new Error('Invalid account index');
      const { accounts } = await chrome.storage.local.get(['accounts']);
      const targetAddress = accounts?.[msg.accountIndex]?.address;
      if (!targetAddress) throw new Error('Аккаунт не найден');

      const walletKey = String(targetAddress).toLowerCase();
      if (!_walletsByAddress.has(walletKey)) {
        return { activated: false, address: targetAddress };
      }

      _activeWalletAddress = walletKey;
      await chrome.storage.session.set({ unlocked: true, unlockTime: Date.now() });
      chrome.alarms.clear(LOCK_ALARM);
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
      broadcastAccountsChanged().catch(() => {});
      return { activated: true, address: targetAddress };
    }

    // Отправка ETH — подписываем здесь, в popup приватный ключ не попадает
    case 'send-eth': {
      const activeWallet = getActiveWallet();
      if (!activeWallet) throw new Error('locked');
      if (!ethers.isAddress(msg.to)) throw new Error('Invalid address');
      if (!msg.amount || isNaN(parseFloat(msg.amount)) || parseFloat(msg.amount) <= 0)
        throw new Error('Invalid amount');
      const { rpcUrl, chainId } = await getActiveNetworkParams();
      const provider  = new ethers.JsonRpcProvider(rpcUrl, chainId);
      const connected = activeWallet.connect(provider);

      const txRequest = {
        to:      msg.to,
        value:   ethers.parseEther(msg.amount),
        chainId,
      };
      // estimateGas определяет нужный лимит автоматически
      // +20% запас на случай изменения state между оценкой и отправкой
      const estimated = await provider.estimateGas(txRequest);
      txRequest.gasLimit = estimated * 120n / 100n;

      const tx = await connected.sendTransaction(txRequest);
      return { hash: tx.hash };
    }

    // Отправка ERC-20 — то же самое
    case 'send-erc20': {
      const activeWallet = getActiveWallet();
      if (!activeWallet) throw new Error('locked');
      if (!ethers.isAddress(msg.to)) throw new Error('Invalid address');
      if (!ethers.isAddress(msg.tokenAddress)) throw new Error('Invalid token address');
      if (!msg.amount || isNaN(parseFloat(msg.amount)) || parseFloat(msg.amount) <= 0)
        throw new Error('Invalid amount');
      if (msg.decimals == null || msg.decimals < 0 || msg.decimals > 18)
        throw new Error('Invalid decimals');
      const { rpcUrl, chainId } = await getActiveNetworkParams();
      const provider  = new ethers.JsonRpcProvider(rpcUrl, chainId);
      const connected = activeWallet.connect(provider);
      const contract  = new ethers.Contract(msg.tokenAddress, ERC20_ABI, connected);
      const tx = await contract.transfer(
        msg.to,
        ethers.parseUnits(msg.amount, msg.decimals)
      );
      return { hash: tx.hash };
    }

    // Создание субаккаунта — пароль используется только для derive+encrypt,
    // _wallet основного аккаунта НЕ меняется
    case 'add-sub-account': {
      if (!msg.password || typeof msg.password !== 'string')
        throw new Error('Invalid password');
      const { accounts = [] } = await chrome.storage.local.get(['accounts']);
      if (!accounts.length || !accounts[0].keystore)
        throw new Error('No accounts found');
      let main = await ethers.Wallet.fromEncryptedJson(accounts[0].keystore, msg.password);
      if (!main.mnemonic?.phrase) {
        main = null;
        throw new Error('Кошелёк без мнемоники — субаккаунты недоступны');
      }
      const nextIdx = accounts.length;
      // MED-6: временно сохраняем phrase в локальной переменной, затем
      // обнуляем ссылку на main.mnemonic чтобы GC собрал её раньше.
      const phrase = main.mnemonic.phrase;
      const newWallet = ethers.HDNodeWallet.fromPhrase(
        phrase, null, `m/44'/60'/0'/0/${nextIdx}`
      );
      const keystore = await newWallet.encrypt(msg.password);
      // Явно очищаем ссылки на sensitive data (помогает GC)
      main.mnemonic = null;
      main = null;
      return { address: newWallet.address, keystore, index: nextIdx };
    }

    // Продление таймера автоблокировки при активности пользователя
    case 'reset-lock-timer': {
      if (!getActiveWallet()) return {};
      chrome.alarms.clear(LOCK_ALARM);
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
      return {};
    }

    case 'get-wallet-address': {
      return { address: getActiveWallet()?.address || null };
    }

    // Broadcast chainChanged когда popup меняет сеть
    case 'network-changed': {
      const chainIdHex = typeof msg.chainIdHex === 'string' ? msg.chainIdHex : null;
      if (chainIdHex) {
        broadcastChainChanged(chainIdHex).catch(() => {});
      }
      return {};
    }

    // ── Popup → SW: approval response ──────────────────────────────────────
    case 'dapp-approval-response': {
      return handleApprovalResponse(msg);
    }

    // Popup читает список pending approvals (для рендера approval-screen).
    // SECURITY (P1-5): мы НЕ восстанавливаем pending request'ы из persistent
    // storage после рестарта SW. Если SW был убит, _pendingApprovals Map пуст
    // → возвращаем expired. Это защищает от:
    //  1. Stale approval replay attack (user одобряет старый запрос)
    //  2. Утечки sensitive params (typed data, addresses, amounts) через storage
    case 'dapp-get-pending': {
      if (msg.id) {
        const entry = _pendingApprovals.get(msg.id);
        if (!entry) {
          // SW рестартовал — pending request lost. Resolve в popup как expired.
          return { request: null, reason: 'expired' };
        }
        return {
          request: {
            id: msg.id,
            origin: entry.origin,
            method: entry.method,
            params: entry.params,
            createdAt: entry.createdAt,
            expiresAt: entry.expiresAt,
            needsUnlock: entry.needsUnlock,
            targetAccountIndex: entry.targetAccountIndex,
            targetAddress: entry.targetAddress,
          },
        };
      }
      const list = [];
      for (const [id, entry] of _pendingApprovals.entries()) {
        list.push({
          id,
          origin: entry.origin,
          method: entry.method,
          params: entry.params,
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt,
          needsUnlock: entry.needsUnlock,
          targetAccountIndex: entry.targetAccountIndex,
          targetAddress: entry.targetAddress,
        });
      }
      return { pending: list };
    }

    // Popup → SW: disconnect origin (через Connected Sites экран)
    case 'dapp-disconnect-origin': {
      const origin = String(msg.origin || '').trim();
      if (!origin) throw new Error('origin required');
      const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
      if (connectedOrigins[origin]) {
        delete connectedOrigins[origin];
        await chrome.storage.local.set({ connectedOrigins });
        // Broadcast disconnect в этот конкретный origin
        broadcastToOrigin(origin, 'disconnect', null).catch(() => {});
        broadcastToOrigin(origin, 'accountsChanged', []).catch(() => {});
      }
      return { ok: true };
    }

    // ── dApp → Content Script → SW ─────────────────────────────────────────
    case 'dapp-request': {
      return handleDappRequest(msg, sender);
    }

    default:
      throw new Error(`Неизвестный тип сообщения: ${msg.type}`);
  }
}

// ── dApp request entrypoint ───────────────────────────────────────────────
async function handleDappRequest(msg, sender) {
  const payload = msg.payload || {};
  const id = payload.id;
  const method = payload.method;
  const params = Array.isArray(payload.params) ? payload.params : [];

  // Проверка origin sender'а — защита от спуфинга.
  let origin = String(msg.origin || '').trim();
  try {
    if (sender && sender.tab && sender.tab.url) {
      const senderOrigin = new URL(sender.tab.url).origin;
      if (origin && senderOrigin !== origin) {
        return rpcError(id, -32603, 'Origin mismatch');
      }
      origin = senderOrigin;
    } else if (sender && sender.origin) {
      origin = sender.origin;
    }
  } catch { /* fallthrough */ }

  if (!origin || !/^https?:\/\//.test(origin)) {
    return rpcError(id, -32603, 'Invalid origin');
  }

  try {
    const result = await dispatchDappMethod(origin, method, params);
    return rpcResult(id, result);
  } catch (err) {
    const code = (err && typeof err.code === 'number') ? err.code : 4100;
    const message = (err && err.message) || 'Unknown error';
    return rpcError(id, code, message);
  }
}

function rpcResult(id, result) {
  return { id, result };
}
function rpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { id, error: err };
}

// ── Dispatcher EIP-1193 методов ───────────────────────────────────────────
async function dispatchDappMethod(origin, method, params) {
  // Сначала — публичные read-only методы, которые не требуют подключения
  switch (method) {
    case 'eth_chainId': {
      const { chainId } = await getActiveNetworkParams();
      return '0x' + chainId.toString(16);
    }
    case 'net_version': {
      const { chainId } = await getActiveNetworkParams();
      return String(chainId);
    }
    case 'eth_blockNumber': {
      return proxyRpc('eth_blockNumber', []);
    }
    case 'eth_getBalance': {
      return proxyRpc('eth_getBalance', params);
    }
    case 'eth_call': {
      return proxyRpc('eth_call', params);
    }
    case 'eth_estimateGas': {
      return proxyRpc('eth_estimateGas', params);
    }
    case 'eth_gasPrice': {
      return proxyRpc('eth_gasPrice', []);
    }
    case 'eth_feeHistory': {
      return proxyRpc('eth_feeHistory', params);
    }
    case 'eth_getCode': {
      return proxyRpc('eth_getCode', params);
    }
    case 'eth_getStorageAt': {
      return proxyRpc('eth_getStorageAt', params);
    }
    case 'eth_getTransactionByHash': {
      return proxyRpc('eth_getTransactionByHash', params);
    }
    case 'eth_getTransactionReceipt': {
      return proxyRpc('eth_getTransactionReceipt', params);
    }
    case 'eth_getTransactionCount': {
      return proxyRpc('eth_getTransactionCount', params);
    }
    case 'eth_getBlockByNumber': {
      return proxyRpc('eth_getBlockByNumber', params);
    }
    case 'eth_getBlockByHash': {
      return proxyRpc('eth_getBlockByHash', params);
    }
  }

  // eth_accounts — не требует popup approval.
  // Возвращает ТЕКУЩИЙ АКТИВНЫЙ аккаунт (а не весь granted список),
  // отфильтрованный по тому что origin имеет к нему доступ.
  // Это MetaMask-like поведение: переключение аккаунта в кошельке
  // автоматически отражается в dApp'е.
  if (method === 'eth_accounts') {
    const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
    const record = connectedOrigins[origin];
    if (!record || !Array.isArray(record.addresses) || record.addresses.length === 0) {
      return [];
    }
    // Обновляем lastUsedAt
    record.lastUsedAt = Date.now();
    connectedOrigins[origin] = record;
    await chrome.storage.local.set({ connectedOrigins });

    // Если кошелёк заблокирован — ничего не возвращаем (MetaMask поведение)
    if (!_activeWalletAddress) return [];

    // Если активный аккаунт в granted списке — возвращаем его
    const activeLower = _activeWalletAddress.toLowerCase();
    const matched = record.addresses.find((a) => a.toLowerCase() === activeLower);
    if (matched) return [matched];

    // Активный не в granted — возвращаем пустой массив (dApp увидит как disconnect)
    return [];
  }

  // wallet_getPermissions (минимальный EIP-2255)
  if (method === 'wallet_getPermissions') {
    const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
    const record = connectedOrigins[origin];
    if (!record) return [];
    return [{
      invoker: origin,
      parentCapability: 'eth_accounts',
      caveats: [{ type: 'filterResponse', value: record.addresses }],
    }];
  }

  // wallet_revokePermissions (EIP-2255 — site-initiated disconnect)
  // dApp может попросить кошелёк отозвать разрешение, что эквивалентно
  // тому что пользователь сделал бы в "Connected Sites".
  // Это БЕЗОПАСНО без popup approval — клиент только отказывается от собственного доступа.
  if (method === 'wallet_revokePermissions') {
    const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
    if (connectedOrigins[origin]) {
      delete connectedOrigins[origin];
      await chrome.storage.local.set({ connectedOrigins });
      // Broadcast disconnect/accountsChanged этому origin'у
      broadcastToOrigin(origin, 'accountsChanged', []).catch(() => {});
      broadcastToOrigin(origin, 'disconnect', null).catch(() => {});
      appendAuditLog({ type: 'dapp-revoke', origin, source: 'site' });
    }
    return null;
  }

  // ── Методы, требующие popup approval ─────────────────────────────────────

  if (method === 'eth_requestAccounts') {
    return handleEthRequestAccounts(origin);
  }
  if (method === 'personal_sign') {
    return handlePersonalSign(origin, params);
  }
  if (method === 'eth_signTypedData_v4') {
    return handleSignTypedDataV4(origin, params);
  }
  if (method === 'eth_sendTransaction') {
    return handleEthSendTransaction(origin, params);
  }

  // ── Явно отклоняемые методы (для better error message) ──────────────────
  const refused = {
    'eth_sign': 'eth_sign is deprecated and unsafe. Use personal_sign or eth_signTypedData_v4.',
    'eth_sendRawTransaction': 'Pre-signed transactions are not accepted.',
    'eth_signTypedData': 'Only eth_signTypedData_v4 is supported.',
    'eth_signTypedData_v1': 'Only eth_signTypedData_v4 is supported.',
    'eth_signTypedData_v3': 'Only eth_signTypedData_v4 is supported.',
    'eth_getEncryptionPublicKey': 'Encryption methods are not supported.',
    'eth_decrypt': 'Encryption methods are not supported.',
  };
  if (refused[method]) {
    const err = new Error(refused[method]);
    err.code = 4200; // unsupported method
    throw err;
  }

  // P2-1: WHITELIST вместо blacklist. Все методы которые мы знаем —
  // обработаны выше в switch-case или if-блоках. Если до сюда дошли —
  // метод неизвестен и должен быть отклонён, даже если начинается с eth_.
  // Это защищает от:
  //  1. Будущих методов, которые могут быть добавлены в RPC и быть unsafe
  //  2. Provider-specific методов (alchemy_*, parity_*, debug_*) которые
  //     могут проксировать sensitive операции
  //  3. Опечаток (eth_sigh вместо eth_sign) которые попадали бы в proxy
  const err = new Error(`Method not supported: ${method}`);
  err.code = 4200;
  throw err;
}

// ── Read-only RPC proxy ───────────────────────────────────────────────────
async function proxyRpc(method, params) {
  const { rpcUrl, chainId } = await getActiveNetworkParams();
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
  try {
    return await provider.send(method, params);
  } catch (err) {
    const e = new Error(err.message || 'RPC error');
    e.code = -32603;
    throw e;
  }
}

// ── eth_requestAccounts ───────────────────────────────────────────────────
async function handleEthRequestAccounts(origin) {
  // Если уже подключён — возвращаем сразу (но с проверкой unlock-состояния)
  const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
  if (connectedOrigins[origin] && Array.isArray(connectedOrigins[origin].addresses) && connectedOrigins[origin].addresses.length > 0) {
    const addresses = connectedOrigins[origin].addresses;

    // Если SW был убит / auto-lock сработал → _walletsByAddress пуст.
    // Нужно открыть approval-окно чтобы user ввёл пароль.
    if (!_activeWalletAddress) {
      const { accounts = [] } = await chrome.storage.local.get(['accounts']);
      // Находим индекс первого granted адреса в storage.accounts
      const firstGrantedLower = addresses[0].toLowerCase();
      const targetIndex = accounts.findIndex((a) => a.address.toLowerCase() === firstGrantedLower);
      if (targetIndex === -1) {
        const e = new Error('Granted address not found in wallet');
        e.code = 4100;
        throw e;
      }
      const approved = await requestApproval({
        origin,
        method: 'eth_requestAccounts',
        params: [{ requiresUnlock: true }],
        needsUnlock: true,
        targetAccountIndex: targetIndex,
        targetAddress: addresses[0],
      });
      if (!approved || approved.rejected) {
        const e = new Error('User rejected the request');
        e.code = 4001;
        throw e;
      }
      // После unlock — возвращаем granted addresses
    }

    connectedOrigins[origin].lastUsedAt = Date.now();
    await chrome.storage.local.set({ connectedOrigins });
    return addresses;
  }

  // Проверяем что у пользователя вообще есть wallet
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  if (!accounts.length) {
    const e = new Error('No accounts in wallet. Create one in SOVA first.');
    e.code = 4100;
    throw e;
  }

  // Открываем popup approval
  const approved = await requestApproval({
    origin,
    method: 'eth_requestAccounts',
    params: [],
  });

  if (!approved || approved.rejected) {
    const e = new Error('User rejected the request');
    e.code = 4001;
    throw e;
  }

  const selectedAddresses = Array.isArray(approved.addresses) && approved.addresses.length > 0
    ? approved.addresses
    : [accounts[0].address];

  // Получаем текущий chainId
  const { chainId } = await getActiveNetworkParams();

  let updated = { ...connectedOrigins };
  updated[origin] = {
    addresses: selectedAddresses,
    chainId,
    connectedAt: Date.now(),
    lastUsedAt: Date.now(),
    permissions: ['eth_accounts'],
  };
  // MED-7: LRU + TTL enforcement — не даём storage бесконтрольно расти
  updated = enforceConnectedOriginsLimits(updated);
  await chrome.storage.local.set({ connectedOrigins: updated });

  // Log в audit
  appendAuditLog({
    type: 'dapp-connect',
    origin,
    addresses: selectedAddresses,
  });

  // Broadcast connect event в этот origin
  broadcastToOrigin(origin, 'connect', { chainId: '0x' + chainId.toString(16) }).catch(() => {});
  broadcastToOrigin(origin, 'accountsChanged', selectedAddresses).catch(() => {});

  return selectedAddresses;
}

// ── personal_sign ─────────────────────────────────────────────────────────
// LOW-3: Принимаем оба порядка параметров:
//   [message, address]  — стандарт EIP-191 / EIP-1193
//   [address, message]  — MetaMask legacy convention
// Это намеренное решение для максимальной совместимости с dApp'ами.
// Определяем порядок по тому, какой из двух параметров является валидным адресом.
async function handlePersonalSign(origin, params) {
  let data, address;
  if (params.length < 2) {
    const e = new Error('personal_sign requires [message, address]');
    e.code = 4100;
    throw e;
  }
  if (ethers.isAddress(params[0])) {
    address = params[0]; data = params[1];
  } else if (ethers.isAddress(params[1])) {
    data = params[0]; address = params[1];
  } else {
    const e = new Error('personal_sign: no valid address in params');
    e.code = 4100;
    throw e;
  }

  await ensureConnectedOriginHasAddress(origin, address);

  // Проверяем есть ли нужный кошелёк в памяти SW.
  // Если нет — approval-экран покажет поле ввода пароля.
  const needsUnlock = !getWalletForAddress(address);
  let targetAccountIndex = null;
  if (needsUnlock) {
    const { accounts = [] } = await chrome.storage.local.get(['accounts']);
    targetAccountIndex = accounts.findIndex((a) => a.address.toLowerCase() === address.toLowerCase());
    if (targetAccountIndex === -1) {
      const e = new Error('Address not found in wallet');
      e.code = 4100;
      throw e;
    }
  }

  // Декодируем сообщение для отображения
  let displayMessage = data;
  try {
    if (typeof data === 'string' && data.startsWith('0x')) {
      const bytes = ethers.getBytes(data);
      displayMessage = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  } catch { /* keep raw */ }

  const approved = await requestApproval({
    origin,
    method: 'personal_sign',
    params: [{ message: displayMessage, rawMessage: data, address }],
    needsUnlock,
    targetAccountIndex,
    targetAddress: address,
  });
  if (!approved || approved.rejected) {
    const e = new Error('User rejected the request');
    e.code = 4001;
    throw e;
  }

  // После approval — кошелёк должен быть разблокирован
  const activeWallet = getWalletForAddress(address);
  if (!activeWallet) {
    const e = new Error('Wallet still locked after approval');
    e.code = -32603;
    throw e;
  }

  const signature = await activeWallet.signMessage(
    typeof data === 'string' && data.startsWith('0x') ? ethers.getBytes(data) : data
  );

  appendAuditLog({ type: 'dapp-sign', origin, method: 'personal_sign', address });
  return signature;
}

// ── eth_signTypedData_v4 ──────────────────────────────────────────────────
async function handleSignTypedDataV4(origin, params) {
  if (params.length < 2) {
    const e = new Error('eth_signTypedData_v4 requires [address, typedData]');
    e.code = 4100;
    throw e;
  }
  const address = params[0];
  let typedDataRaw = params[1];
  if (!ethers.isAddress(address)) {
    const e = new Error('Invalid address');
    e.code = 4100;
    throw e;
  }
  let typedData;
  try {
    typedData = typeof typedDataRaw === 'string' ? JSON.parse(typedDataRaw) : typedDataRaw;
  } catch {
    const e = new Error('Invalid typed data JSON');
    e.code = 4100;
    throw e;
  }
  if (!typedData || !typedData.types || !typedData.domain || !typedData.primaryType || !typedData.message) {
    const e = new Error('Malformed EIP-712 payload');
    e.code = 4100;
    throw e;
  }

  await ensureConnectedOriginHasAddress(origin, address);

  // P2-4: HARD BLOCK при chainId mismatch (раньше был только warning).
  // Атакующий dApp может попросить подпись для другой сети, которую потом
  // replay'ит против user'а. Защита: не показываем approval вообще,
  // возвращаем error 4901 (Chain not configured) — стандартный EIP-1193 код.
  const { chainId: currentChainId } = await getActiveNetworkParams();
  const domainChainIdRaw = typedData.domain.chainId;
  if (domainChainIdRaw != null) {
    let domainChainId;
    if (typeof domainChainIdRaw === 'number') {
      domainChainId = domainChainIdRaw;
    } else if (typeof domainChainIdRaw === 'string') {
      domainChainId = domainChainIdRaw.startsWith('0x')
        ? parseInt(domainChainIdRaw, 16)
        : parseInt(domainChainIdRaw, 10);
    } else if (typeof domainChainIdRaw === 'bigint') {
      domainChainId = Number(domainChainIdRaw);
    } else {
      domainChainId = NaN;
    }
    if (!Number.isFinite(domainChainId)) {
      const e = new Error(`Invalid domain.chainId in typed data: ${domainChainIdRaw}`);
      e.code = 4100;
      throw e;
    }
    if (domainChainId !== Number(currentChainId)) {
      const e = new Error(
        `Chain ID mismatch: typed data requires chainId ${domainChainId}, ` +
        `but wallet is on ${currentChainId}. Switch network in SOVA wallet first.`
      );
      e.code = 4901; // EIP-1193: Chain not configured
      throw e;
    }
  }

  const needsUnlock = !getWalletForAddress(address);
  let targetAccountIndex = null;
  if (needsUnlock) {
    const { accounts = [] } = await chrome.storage.local.get(['accounts']);
    targetAccountIndex = accounts.findIndex((a) => a.address.toLowerCase() === address.toLowerCase());
    if (targetAccountIndex === -1) {
      const e = new Error('Address not found in wallet');
      e.code = 4100;
      throw e;
    }
  }

  const approved = await requestApproval({
    origin,
    method: 'eth_signTypedData_v4',
    params: [{
      address,
      typedData,
      currentChainId,
    }],
    needsUnlock,
    targetAccountIndex,
    targetAddress: address,
  });
  if (!approved || approved.rejected) {
    const e = new Error('User rejected the request');
    e.code = 4001;
    throw e;
  }

  const activeWallet = getWalletForAddress(address);
  if (!activeWallet) {
    const e = new Error('Wallet still locked after approval');
    e.code = -32603;
    throw e;
  }

  // ethers v6: wallet.signTypedData(domain, types, value)
  // EIP712Domain тип исключается из types (ethers сам его добавляет)
  const types = { ...typedData.types };
  delete types.EIP712Domain;
  const signature = await activeWallet.signTypedData(typedData.domain, types, typedData.message);

  appendAuditLog({ type: 'dapp-sign', origin, method: 'eth_signTypedData_v4', address });
  return signature;
}

// ── eth_sendTransaction ───────────────────────────────────────────────────
async function handleEthSendTransaction(origin, params) {
  if (!params.length || !params[0] || typeof params[0] !== 'object') {
    const e = new Error('eth_sendTransaction requires a transaction object');
    e.code = 4100;
    throw e;
  }
  const txInput = params[0];
  const fromRaw = txInput.from;
  if (!ethers.isAddress(fromRaw)) {
    const e = new Error('Invalid from address');
    e.code = 4100;
    throw e;
  }
  await ensureConnectedOriginHasAddress(origin, fromRaw);

  const needsUnlock = !getWalletForAddress(fromRaw);
  let targetAccountIndex = null;
  if (needsUnlock) {
    const { accounts = [] } = await chrome.storage.local.get(['accounts']);
    targetAccountIndex = accounts.findIndex((a) => a.address.toLowerCase() === fromRaw.toLowerCase());
    if (targetAccountIndex === -1) {
      const e = new Error('From address not found in wallet');
      e.code = 4100;
      throw e;
    }
  }

  const { rpcUrl, chainId } = await getActiveNetworkParams();
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);

  // Normalize tx request
  const txRequest = {};
  if (txInput.to) {
    if (!ethers.isAddress(txInput.to)) {
      const e = new Error('Invalid to address');
      e.code = 4100;
      throw e;
    }
    txRequest.to = txInput.to;
  }
  if (txInput.value != null) {
    txRequest.value = toBigIntHex(txInput.value);
  }
  if (txInput.data != null && txInput.data !== '0x') {
    txRequest.data = txInput.data;
  } else if (txInput.input != null && txInput.input !== '0x') {
    txRequest.data = txInput.input;
  }
  txRequest.chainId = chainId;

  // Gas estimate — работает без приватного ключа (provider достаточно)
  let gasEstimate;
  try {
    gasEstimate = await provider.estimateGas({ ...txRequest, from: fromRaw });
  } catch (err) {
    const e = new Error(`Gas estimation failed: ${err.message}`);
    e.code = -32603;
    throw e;
  }
  const gasLimit = txInput.gas ? toBigIntHex(txInput.gas) : (gasEstimate * 120n / 100n);
  txRequest.gasLimit = gasLimit;

  // Fee data
  let feeData;
  try {
    feeData = await provider.getFeeData();
  } catch { feeData = null; }

  // Preview — возможно RPC ошибка, но мы продолжаем с estimate'ом
  const previewGas = feeData
    ? (feeData.maxFeePerGas || feeData.gasPrice || 0n)
    : 0n;
  const previewFeeWei = gasLimit * previewGas;

  // Show approval (с unlock-экраном если wallet locked)
  const approved = await requestApproval({
    origin,
    method: 'eth_sendTransaction',
    params: [{
      from: fromRaw,
      to: txRequest.to || null,
      value: txRequest.value ? ('0x' + txRequest.value.toString(16)) : '0x0',
      data: txRequest.data || '0x',
      gasLimit: '0x' + gasLimit.toString(16),
      gasEstimate: '0x' + gasEstimate.toString(16),
      feeWei: '0x' + previewFeeWei.toString(16),
      chainId,
    }],
    needsUnlock,
    targetAccountIndex,
    targetAddress: fromRaw,
  });
  if (!approved || approved.rejected) {
    const e = new Error('User rejected the request');
    e.code = 4001;
    throw e;
  }

  // После approval — fetch wallet (должен быть уже unlocked после inline password prompt)
  const activeWallet = getWalletForAddress(fromRaw);
  if (!activeWallet) {
    const e = new Error('Wallet still locked after approval');
    e.code = -32603;
    throw e;
  }
  const connected = activeWallet.connect(provider);

  const tx = await connected.sendTransaction(txRequest);

  appendAuditLog({
    type: 'dapp-send',
    origin,
    from: fromRaw,
    to: txRequest.to || null,
    hash: tx.hash,
  });

  return tx.hash;
}

// ── Helpers: approval lifecycle ───────────────────────────────────────────

// MED-4: Криптостойкая генерация approval ID.
// Раньше: `appr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
//   — ~36 бит энтропии, угадываемо через repeated sendMessage.
// Теперь: 128 бит через crypto.getRandomValues. Невозможно угадать.
function generateApprovalId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `appr-${hex}`;
}

// MED-3: Per-origin rate limiting для pending approvals.
// Защита от DoS spam: malicious dApp не может открыть десятки approval-окон.
// Но логика не должна превращаться в UX ловушку: если у origin уже есть
// pending approval, мы **НЕ отклоняем новый запрос silent**'ом, а:
//   1. Приводим existing approval window в фокус (bring-to-front)
//   2. Возвращаем тот же Promise — dApp получит результат когда user ответит
//   3. Если existing window уже закрыт — удаляем pending и создаём новый
//
// Это даёт:
//   - Rate limit работает (один approval, одно окно)
//   - UX не ломается если окно потерялось/пользователь кликнул несколько раз
//   - Dedup: кнопка connect нажатая 5 раз не создаст 5 popup'ов
const MAX_PENDING_APPROVALS_GLOBAL = 20;

function findPendingByOrigin(origin) {
  for (const [id, entry] of _pendingApprovals.entries()) {
    if (entry.origin === origin) return { id, entry };
  }
  return null;
}

async function _refocusApprovalWindow(windowId) {
  if (!windowId || typeof chrome === 'undefined' || !chrome.windows) return false;
  try {
    // Проверим что окно ещё живо
    const w = await chrome.windows.get(windowId).catch(() => null);
    if (!w) return false;
    await chrome.windows.update(windowId, { focused: true, drawAttention: true });
    return true;
  } catch {
    return false;
  }
}

async function requestApproval({ origin, method, params, needsUnlock = false, targetAccountIndex = null, targetAddress = null }) {
  // Проверка на existing pending ДО Promise executor — чтобы не терять async контекст.
  const existing = findPendingByOrigin(origin);
  if (existing) {
    // Попытка refocus'а существующего окна
    const refocused = await _refocusApprovalWindow(existing.entry._windowId);
    if (refocused) {
      // Окно живо — возвращаем ТОТ ЖЕ promise. dApp получит результат когда
      // пользователь ответит на уже существующий approval.
      return new Promise((resolve, reject) => {
        // Chain onto the existing entry's resolve/reject
        const origResolve = existing.entry.resolve;
        const origReject = existing.entry.reject;
        existing.entry.resolve = (v) => { origResolve(v); resolve(v); };
        existing.entry.reject = (e) => { origReject(e); reject(e); };
      });
    }
    // Окно было закрыто (но listener onRemoved мог не сработать до нас) — cleanup
    clearTimeout(existing.entry._timer);
    _pendingApprovals.delete(existing.id);
    await removePendingFromStorage(existing.id).catch(() => {});
    try {
      existing.entry.resolve({ approved: false, rejected: true, reason: 'window-closed-stale' });
    } catch { /* ignore */ }
  }

  return new Promise((resolve, reject) => {
    // Global cap (защита от multi-origin spam)
    if (_pendingApprovals.size >= MAX_PENDING_APPROVALS_GLOBAL) {
      const e = new Error(`Too many pending approvals (${MAX_PENDING_APPROVALS_GLOBAL} max). Try later.`);
      e.code = 4001;
      reject(e);
      return;
    }

    const id = generateApprovalId();
    const createdAt = Date.now();
    const expiresAt = createdAt + DAPP_REQUEST_TTL_MS;

    const entry = {
      resolve, reject, origin, method, params, createdAt, expiresAt,
      needsUnlock, targetAccountIndex, targetAddress,
      _windowId: null,
    };

    // TTL taimer
    const timer = setTimeout(async () => {
      if (_pendingApprovals.has(id)) {
        _pendingApprovals.delete(id);
        await removePendingFromStorage(id);
        const e = new Error('Request expired (60s timeout)');
        e.code = 4001;
        reject(e);
      }
    }, DAPP_REQUEST_TTL_MS);

    entry._timer = timer;
    _pendingApprovals.set(id, entry);

    // Persist ТОЛЬКО метаданные (для cleanup и timeout tracking).
    // SECURITY (P1-5): НЕ персистим params, needsUnlock, targetAddress.
    // Эти данные могут содержать sensitive payloads (typed data, transfer
    // amounts, addresses). Если SW рестартанет, popup получит 'expired'
    // и попросит dApp повторить запрос — params никогда не утекают в storage.
    persistPendingRequest(id, {
      id, origin, method, createdAt, expiresAt,
    });

    // Открыть popup окно для approval — сохраняем windowId в entry для refocus
    openApprovalWindow(id).then((windowId) => {
      if (windowId && _pendingApprovals.has(id)) {
        _pendingApprovals.get(id)._windowId = windowId;
      }
    }).catch((err) => {
      _swLog('[SOVA SW] failed to open approval window', err?.message);
    });

    // Показать notification как backup
    showApprovalNotification(id, origin, method).catch(() => {});
  });
}

async function handleApprovalResponse(msg) {
  const id = msg.id;
  if (!id) throw new Error('id required');
  const entry = _pendingApprovals.get(id);
  if (!entry) {
    // Уже истёк или таковой не было
    return { ok: false, reason: 'not-found' };
  }
  clearTimeout(entry._timer);
  _pendingApprovals.delete(id);
  await removePendingFromStorage(id);

  if (msg.approved) {
    entry.resolve({
      approved: true,
      rejected: false,
      addresses: msg.addresses,
    });
  } else {
    entry.resolve({
      approved: false,
      rejected: true,
      reason: msg.reason || 'user-rejected',
    });
  }
  return { ok: true };
}

async function persistPendingRequest(id, payload) {
  try {
    const { pendingDappRequests = {} } = await chrome.storage.session.get(['pendingDappRequests']);
    pendingDappRequests[id] = payload;
    await chrome.storage.session.set({ pendingDappRequests });
  } catch (e) { /* session storage may be disabled */ }
}

async function removePendingFromStorage(id) {
  try {
    const { pendingDappRequests = {} } = await chrome.storage.session.get(['pendingDappRequests']);
    if (pendingDappRequests[id]) {
      delete pendingDappRequests[id];
      await chrome.storage.session.set({ pendingDappRequests });
    }
  } catch (e) { /* ignore */ }
}

async function openApprovalWindow(id) {
  // В MV3 SW не может вызвать chrome.action.openPopup без user gesture,
  // поэтому открываем отдельное окно. Возвращаем windowId чтобы можно было
  // refocus'ить (если пользователь снова нажмёт connect в dApp).
  const url = chrome.runtime.getURL(`popup/popup.html?request=${encodeURIComponent(id)}`);
  try {
    const created = await chrome.windows.create({
      url,
      type: 'popup',
      width: 400,
      height: 620,
      focused: true,
    });
    return created?.id || null;
  } catch (err) {
    // Fallback — обновляем badge, чтобы пользователь кликнул сам
    try {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f5a623' });
    } catch { /* ignore */ }
    return null;
  }
}

async function showApprovalNotification(id, origin, method) {
  // Notification — это запасной канал (основное уведомление это отдельное окно
  // через chrome.windows.create). Если notifications не работают — молча скипаем.
  try {
    if (!chrome.notifications || typeof chrome.notifications.create !== 'function') return;
    const iconUrl = chrome.runtime.getURL('icons/icon128.png');
    // Используем callback-форму и проверяем lastError, чтобы не было uncaught promise
    chrome.notifications.create(
      `sova-approval-${id}`,
      {
        type: 'basic',
        iconUrl,
        title: 'SOVA Wallet — подтверждение',
        message: `${origin} запрашивает: ${method}`,
        priority: 2,
      },
      () => {
        if (chrome.runtime.lastError) {
          // Тихо игнорируем — approval window уже открыт параллельно
        }
      }
    );
  } catch { /* ignore */ }
}

// ── Wallet lookup ─────────────────────────────────────────────────────────
function getWalletForAddress(address) {
  if (!address) return null;
  const key = String(address).toLowerCase();
  return _walletsByAddress.get(key) || null;
}

async function ensureConnectedOriginHasAddress(origin, address) {
  const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
  const record = connectedOrigins[origin];
  if (!record || !Array.isArray(record.addresses)) {
    const e = new Error('Origin not connected. Call eth_requestAccounts first.');
    e.code = 4100;
    throw e;
  }
  const match = record.addresses.some((a) => a.toLowerCase() === String(address).toLowerCase());
  if (!match) {
    const e = new Error('Address is not permitted for this origin');
    e.code = 4100;
    throw e;
  }
  record.lastUsedAt = Date.now();
  connectedOrigins[origin] = record;
  await chrome.storage.local.set({ connectedOrigins });
  return record;
}

// ── Broadcast events to dApps (via content scripts) ──────────────────────
async function broadcastToOrigin(origin, event, data) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url) continue;
      try {
        const tabOrigin = new URL(tab.url).origin;
        if (tabOrigin !== origin) continue;
        chrome.tabs.sendMessage(tab.id, { type: 'dapp-event', event, data }, () => {
          if (chrome.runtime.lastError) { /* tab might not have content script */ }
        });
      } catch { /* invalid URL */ }
    }
  } catch (err) {
    _swLog('[SOVA SW] broadcastToOrigin failed', err?.message);
  }
}

async function broadcastToAllConnected(event, data) {
  const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
  for (const origin of Object.keys(connectedOrigins)) {
    broadcastToOrigin(origin, event, data).catch(() => {});
  }
}

async function broadcastChainChanged(chainIdHex) {
  return broadcastToAllConnected('chainChanged', chainIdHex);
}

async function broadcastAccountsChanged(explicitAddresses) {
  const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
  for (const [origin, record] of Object.entries(connectedOrigins)) {
    let addrs;
    if (explicitAddresses !== undefined) {
      // Явная перезапись (например из lock → [] для всех origin'ов)
      addrs = explicitAddresses;
    } else if (!_activeWalletAddress) {
      // Кошелёк залочен — dApp видит disconnect
      addrs = [];
    } else {
      // Возвращаем активный аккаунт, если он в granted списке для этого origin'а
      const activeLower = _activeWalletAddress.toLowerCase();
      const matched = (record.addresses || []).find((a) => a.toLowerCase() === activeLower);
      addrs = matched ? [matched] : [];
    }
    broadcastToOrigin(origin, 'accountsChanged', addrs).catch(() => {});
  }
}

// ── Audit log ─────────────────────────────────────────────────────────────
// MED-8: cap 500 записей + TTL 30 дней.
// Раньше cap был 1000 (200 KB при ~200 bytes/запись). Теперь меньше + TTL.
const AUDIT_LOG_MAX = 500;
const AUDIT_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

async function appendAuditLog(entry) {
  try {
    const { auditLog = [] } = await chrome.storage.local.get(['auditLog']);
    const now = Date.now();
    const record = { timestamp: now, ...entry };
    auditLog.push(record);
    // Удаляем записи старше TTL
    const cutoff = now - AUDIT_LOG_TTL_MS;
    const filtered = auditLog.filter(r => (r.timestamp || 0) >= cutoff);
    // Cap по размеру (LRU — удаляем самые старые)
    while (filtered.length > AUDIT_LOG_MAX) filtered.shift();
    await chrome.storage.local.set({ auditLog: filtered });
  } catch (err) {
    _swLog('[SOVA SW] auditLog append failed', err?.message);
  }
}

// ── Utility ───────────────────────────────────────────────────────────────
function toBigIntHex(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') {
    if (value.startsWith('0x')) return BigInt(value);
    if (/^\d+$/.test(value)) return BigInt(value);
  }
  // LOW-4: truncate — value может быть огромной строкой (dApp-controlled input)
  const preview = String(value).slice(0, 64);
  throw new Error(`Cannot convert to bigint: ${preview}${String(value).length > 64 ? '…' : ''}`);
}

async function getActiveNetworkParams() {
  const { selectedNetwork, rpcByNetwork, rpcUrl } = await chrome.storage.local.get([
    'selectedNetwork',
    'rpcByNetwork',
    'rpcUrl',
  ]);

  const networkKey = NETWORKS[selectedNetwork] ? selectedNetwork : DEFAULT_NETWORK_KEY;
  const fallbackMap = (rpcByNetwork && typeof rpcByNetwork === 'object') ? rpcByNetwork : {};
  const legacyRpcUrl = networkKey === 'bsc' ? null : rpcUrl;
  const activeRpcUrl = fallbackMap[networkKey] || legacyRpcUrl || NETWORKS[networkKey].defaultRpcUrl;
  const chainId = NETWORKS[networkKey].chainId;

  return { rpcUrl: activeRpcUrl, chainId };
}

// ── Автоблокировка + cleanup истёкших pending requests ────────────────────
const PENDING_CLEANUP_ALARM = 'cleanup-pending';
chrome.alarms.create(PENDING_CLEANUP_ALARM, { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === LOCK_ALARM) {
    clearUnlockedWallets();            // ключи уничтожены
    chrome.storage.session.clear();    // popup увидит что сессия сброшена
    broadcastAccountsChanged([]).catch(() => {});
  } else if (alarm.name === PENDING_CLEANUP_ALARM) {
    // Cleanup истёкших pending dApp requests из session storage.
    // Защита от накопления stale entries при множественных SW restart'ах.
    try {
      const { pendingDappRequests = {} } = await chrome.storage.session.get(['pendingDappRequests']);
      const now = Date.now();
      const cleaned = {};
      for (const [id, req] of Object.entries(pendingDappRequests)) {
        if (req.expiresAt > now) cleaned[id] = req;
      }
      await chrome.storage.session.set({ pendingDappRequests: cleaned });
    } catch (e) { /* session storage may be unavailable */ }
  }
});

chrome.runtime.onInstalled.addListener(() => {
  // Очищаем остаточные alarm'ы — новый создастся при unlock
  chrome.alarms.clear(LOCK_ALARM);
  // Очищаем pending dApp requests — они уже истекли к моменту install/update
  chrome.storage.session.remove(['pendingDappRequests']).catch(() => {});
});

// ── Clear notification click ──────────────────────────────────────────────
if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('sova-approval-')) {
      const id = notificationId.substring('sova-approval-'.length);
      openApprovalWindow(id).catch(() => {});
      chrome.notifications.clear(notificationId);
    }
  });
}
