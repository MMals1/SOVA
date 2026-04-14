'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// sw-dapp.js — dApp approval system, sender validation, EIP-1193 dispatcher
// Depends on: sw-security.js, sw-wallet.js, sw-rpc.js
// ═══════════════════════════════════════════════════════════════════════════

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
  MessageType.UNLOCK,
  MessageType.LOCK,
  MessageType.ACTIVATE_ACCOUNT,
  MessageType.ADD_SUB_ACCOUNT,
  MessageType.RESET_LOCK_TIMER,
  MessageType.GET_WALLET_ADDRESS,
  MessageType.CHECK_WALLET_UNLOCKED,
  MessageType.NETWORK_CHANGED,
  // Signing operations — popup-инициированные транзакции (кнопка "Отправить")
  MessageType.SEND_ETH,
  MessageType.SEND_ERC20,
  // Re-auth — верификация пароля перед mainnet-транзакцией (1.1)
  MessageType.VERIFY_PASSWORD,
  // dApp approval lifecycle — отправляется из approval popup окна
  MessageType.DAPP_APPROVAL_RESPONSE,
  MessageType.DAPP_DISCONNECT_ORIGIN,
  MessageType.DAPP_GET_PENDING,
]);

// Типы сообщений которые могут приходить ТОЛЬКО из content-script
const CONTENT_SCRIPT_MESSAGE_TYPES = new Set([MessageType.DAPP_REQUEST]);

// ── Pending dApp approvals ────────────────────────────────────────────────
// В MV3 service worker может быть killed → persist'им в chrome.storage.session,
// но в memory держим резолверы (они теряются при рестарте, поэтому даём клиенту
// ошибку "request expired" если SW перезапустился).
const _pendingApprovals = new Map();
// id -> { resolve, reject, origin, method, params, createdAt, expiresAt, _windowId }

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

async function requestApproval({
  origin,
  method,
  params,
  needsUnlock = false,
  targetAccountIndex = null,
  targetAddress = null,
}) {
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
        existing.entry.resolve = (v) => {
          origResolve(v);
          resolve(v);
        };
        existing.entry.reject = (e) => {
          origReject(e);
          reject(e);
        };
      });
    }
    // Окно было закрыто (но listener onRemoved мог не сработать до нас) — cleanup
    clearTimeout(existing.entry._timer);
    _pendingApprovals.delete(existing.id);
    await removePendingFromStorage(existing.id).catch(() => {});
    try {
      existing.entry.resolve({ approved: false, rejected: true, reason: 'window-closed-stale' });
    } catch {
      /* ignore */
    }
  }

  return new Promise((resolve, reject) => {
    // Global cap (защита от multi-origin spam)
    if (_pendingApprovals.size >= MAX_PENDING_APPROVALS_GLOBAL) {
      const e = new Error(
        `Too many pending approvals (${MAX_PENDING_APPROVALS_GLOBAL} max). Try later.`,
      );
      e.code = 4001;
      reject(e);
      return;
    }

    const id = generateApprovalId();
    const createdAt = Date.now();
    const expiresAt = createdAt + DAPP_REQUEST_TTL_MS;

    const entry = {
      resolve,
      reject,
      origin,
      method,
      params,
      createdAt,
      expiresAt,
      needsUnlock,
      targetAccountIndex,
      targetAddress,
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
      id,
      origin,
      method,
      createdAt,
      expiresAt,
    });

    // Открыть popup окно для approval — сохраняем windowId в entry для refocus
    openApprovalWindow(id)
      .then((windowId) => {
        if (windowId && _pendingApprovals.has(id)) {
          _pendingApprovals.get(id)._windowId = windowId;
        }
      })
      .catch((err) => {
        _swLog('[SOVA SW] failed to open approval window', err?.message);
      });

    // Показать notification как backup
    showApprovalNotification(id, origin, method).catch(() => {});
  });
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
    } catch {
      /* ignore */
    }
    return null;
  }
}

async function persistPendingRequest(id, payload) {
  try {
    const { pendingDappRequests = {} } = await chrome.storage.session.get(['pendingDappRequests']);
    pendingDappRequests[id] = payload;
    await chrome.storage.session.set({ pendingDappRequests });
  } catch (e) {
    /* session storage may be disabled */
  }
}

async function removePendingFromStorage(id) {
  try {
    const { pendingDappRequests = {} } = await chrome.storage.session.get(['pendingDappRequests']);
    if (pendingDappRequests[id]) {
      delete pendingDappRequests[id];
      await chrome.storage.session.set({ pendingDappRequests });
    }
  } catch (e) {
    /* ignore */
  }
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
      },
    );
  } catch {
    /* ignore */
  }
}

// ── Listener на закрытие approval window ─────────────────────────────────
// Если пользователь закрыл окно крестиком (не нажав ни одну кнопку),
// нужно отклонить pending approval, иначе оно застрянет до истечения TTL
// и следующие запросы от origin будут получать 4001.
if (typeof chrome !== 'undefined' && chrome.windows && chrome.windows.onRemoved) {
  chrome.windows.onRemoved.addListener((closedWindowId) => {
    for (const [id, entry] of _pendingApprovals.entries()) {
      if (entry._windowId === closedWindowId) {
        clearTimeout(entry._timer);
        _pendingApprovals.delete(id);
        removePendingFromStorage(id).catch(() => {});
        try {
          entry.resolve({ approved: false, rejected: true, reason: 'window-closed' });
        } catch {
          /* ignore */
        }
      }
    }
  });
}

// ── Handler functions (loaded from handlers/*.js via importScripts) ──────
// handleEthRequestAccounts(origin)     → handlers/eth-request-accounts.js
// handlePersonalSign(origin, params)   → handlers/personal-sign.js
// handleSignTypedDataV4(origin, params)→ handlers/sign-typed-data.js
// handleEthSendTransaction(origin, params) → handlers/send-transaction.js

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

    // Активный не в granted, но dApp подключил конкретный адрес
    // (например через "сменить аккаунт"). Возвращаем granted адрес —
    // без этого ethers.getSigner(addr) получит [] и бросит "invalid account".
    // Подпись всё равно проверит wallet availability в handlePersonalSign/handleEthSendTransaction.
    return [record.addresses[0]];
  }

  // wallet_getPermissions (минимальный EIP-2255)
  if (method === 'wallet_getPermissions') {
    const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
    const record = connectedOrigins[origin];
    if (!record) return [];
    return [
      {
        invoker: origin,
        parentCapability: 'eth_accounts',
        caveats: [{ type: 'filterResponse', value: record.addresses }],
      },
    ];
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
      broadcastToOrigin(origin, BroadcastEvent.ACCOUNTS_CHANGED, []).catch(() => {});
      broadcastToOrigin(origin, BroadcastEvent.DISCONNECT, null).catch(() => {});
      appendAuditLog({ type: 'dapp-revoke', origin, source: 'site' });
    }
    return null;
  }

  // wallet_switchEthereumChain (EIP-3326) — dApp просит переключить сеть.
  // Не требует popup approval — wallet просто переключается если сеть поддерживается.
  if (method === 'wallet_switchEthereumChain') {
    const requestedChainId = params?.[0]?.chainId;
    if (!requestedChainId) {
      const e = new Error('Missing chainId parameter');
      e.code = 4100;
      throw e;
    }
    const numericChainId =
      typeof requestedChainId === 'string'
        ? parseInt(requestedChainId, 16)
        : Number(requestedChainId);

    // Найти networkKey по chainId в NETWORKS
    let targetNetworkKey = null;
    for (const [key, cfg] of Object.entries(NETWORKS)) {
      if (cfg.chainId === numericChainId) {
        targetNetworkKey = key;
        break;
      }
    }
    if (!targetNetworkKey) {
      const e = new Error(`Unrecognized chain ID: ${requestedChainId}`);
      e.code = 4902; // EIP-3326: chain not added
      throw e;
    }

    // Переключить сеть (та же логика что popup использует)
    const { selectedNetwork } = await chrome.storage.local.get(['selectedNetwork']);
    if (selectedNetwork !== targetNetworkKey) {
      await chrome.storage.local.set({
        selectedNetwork: targetNetworkKey,
        selectedChain: NETWORKS[targetNetworkKey].chain || 'ethereum',
      });
      // Broadcast chainChanged всем подключённым dApp'ам
      const chainIdHex = '0x' + numericChainId.toString(16);
      broadcastChainChanged(chainIdHex).catch(() => {});
    }
    return null; // success
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
    eth_sign: 'eth_sign is deprecated and unsafe. Use personal_sign or eth_signTypedData_v4.',
    eth_sendRawTransaction: 'Pre-signed transactions are not accepted.',
    eth_signTypedData: 'Only eth_signTypedData_v4 is supported.',
    eth_signTypedData_v1: 'Only eth_signTypedData_v4 is supported.',
    eth_signTypedData_v3: 'Only eth_signTypedData_v4 is supported.',
    eth_getEncryptionPublicKey: 'Encryption methods are not supported.',
    eth_decrypt: 'Encryption methods are not supported.',
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
