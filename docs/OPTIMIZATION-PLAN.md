# SOVA Wallet — План оптимизации и исправления ошибок

**Версия:** 1.0
**Дата:** 2026-04-08
**Контекст:** план составлен по результатам аудита (`AUDIT-REPORT.md` от 2026-04-08), который выявил 60 findings разной критичности.

Этот документ — **actionable плейбук** с конкретными задачами, оценками времени, зависимостями и критериями готовности. Он не дублирует `RECOMMENDATIONS.md` (это стратегический верхнеуровневый документ), а является практическим руководством для следующих 4-6 недель работы.

---

## Краткая сводка

| Phase       | Срок            | Объём задач            | Объём времени | Цель                          | Статус    |
| ----------- | --------------- | ---------------------- | ------------- | ----------------------------- | --------- |
| **Phase 1** | 2 дня           | 5 CRITICAL fixes       | ~12 часов     | Безопасность для публикации   | ✅ v1.1.1 |
| **Phase 2** | 1 неделя        | 8 HIGH severity        | ~20 часов     | Закрыть exploit'абельные баги | ✅ v1.2.0 |
| **Phase 3** | 2 недели        | 17 MEDIUM + 2 LOW      | ~30 часов     | Defense in depth, hardening   | ✅ v1.3.0 |
| **Phase 4** | По возможности  | 8 LOW fixes            | ~10 часов     | Качество кода, документация   | ✅ v1.5.0 |
| **Phase 5** | Следующий major | Архитектурный refactor | ~40 часов     | Декомпозиция popup.js, TS, CI | pending   |

**Общая оценка:** ~120 часов инженерной работы. Phase 1–4 завершены (v1.5.0). Оставшиеся LOW (2, 5, 6, 7, 13) и Phase 5 — по возможности.

---

## Phase 1: Critical security fixes (2 дня) ✅ ЗАВЕРШЕНО 2026-04-08

### Цель

Закрыть все CRITICAL находки. Без этих фиксов **публикация в Chrome Web Store недопустима** — публичная атака на любого пользователя расширения становится технически возможной.

> ✅ **СТАТУС:** Все 5 CRITICAL fixes выполнены 2026-04-08 + бонусом HIGH-2.
> Manifest version → 1.1.1. 251/251 unit+integration тестов passing.
> Detailed log см. в `AUDIT-REPORT.md` §0.

### Задачи

#### P1-1. Удалить hardcoded Alchemy API key из network-config.js ✅ DONE

**Файл:** `extension/network-config.js`
**Найдено:** CRIT-1 в `AUDIT-REPORT.md`
**Время:** 30 минут (без учёта revoke ключа в Alchemy dashboard)

**Шаги:**

1. Открыть Alchemy dashboard, **немедленно отозвать ключ `REDACTED_REVOKED_KEY`**. Создать новый ключ для личного использования (не для распространения).
2. Заменить содержимое `network-config.js`:
   ```js
   'use strict';
   globalThis.WOLF_WALLET_RPC_DEFAULTS = {
     'eth-mainnet': 'https://ethereum-rpc.publicnode.com',
     'eth-sepolia': 'https://ethereum-sepolia-rpc.publicnode.com',
     bsc: 'https://bsc-rpc.publicnode.com',
   };
   ```
3. В `popup.html` добавить новое поле в **setup screen** для Alchemy API key (опционально). Сохранять в `chrome.storage.local.alchemyApiKey`.
4. В `network-state.js` `getRpcUrlForNetwork()` использовать пользовательский ключ если задан:
   ```js
   if (alchemyKey && !rpcByNetwork[networkKey]) {
     return `https://${networkKey === 'bsc' ? 'bnb-mainnet' : networkKey}.g.alchemy.com/v2/${alchemyKey}`;
   }
   ```
5. **Очистить git history** от старого ключа: `git filter-repo --replace-text` или явно перезаписать commit с ключом. Это destructive — спросить разрешения.

**Acceptance criteria:**

- ✅ `grep -r 'lrmoWsP5qrMt8' /Users/musamalsagov/Desktop/wallet/` returns 0 matches
- ✅ Tests pass: `npm test`
- ✅ Manual test на Sepolia с дефолтными publicnode RPC — работает
- ✅ Manual test с user-provided Alchemy key — работает

---

#### P1-2. Sender origin validation для всех internal-сообщений ✅ DONE

**Файл:** `extension/background/service-worker.js`
**Найдено:** CRIT-2
**Время:** 3 часа

**Шаги:**

1. Добавить helper-функции в начало `service-worker.js`:

   ```js
   function isFromExtensionContext(sender) {
     // Popup и approval window открыты как chrome-extension://<id>/popup/popup.html
     // Они не имеют sender.tab. Content-script (даже наш) имеет sender.tab.
     if (!sender) return false;
     if (sender.id !== chrome.runtime.id) return false;
     if (sender.tab) return false;
     return true;
   }

   function isFromOurContentScript(sender) {
     return !!(sender && sender.tab && sender.tab.url && sender.id === chrome.runtime.id);
   }
   ```

2. В начале `handleMessage`, перед switch:

   ```js
   const POPUP_ONLY_TYPES = new Set([
     'unlock',
     'lock',
     'activate-account',
     'add-sub-account',
     'reset-lock-timer',
     'get-wallet-address',
     'network-changed',
     'dapp-approval-response',
     'dapp-disconnect-origin',
     'dapp-get-pending',
   ]);
   const CONTENT_SCRIPT_TYPES = new Set(['dapp-request']);

   if (POPUP_ONLY_TYPES.has(msg.type)) {
     if (!isFromExtensionContext(sender)) {
       const e = new Error('Permission denied: this message must come from extension popup');
       e.code = 4100;
       throw e;
     }
   } else if (CONTENT_SCRIPT_TYPES.has(msg.type)) {
     if (!isFromOurContentScript(sender)) {
       return rpcError(msg.payload?.id, -32603, 'Permission denied: must come from content script');
     }
   } else {
     // Unknown message type — reject
     throw new Error(`Unknown message type: ${msg.type}`);
   }
   ```

3. **Обновить `chrome.runtime.onMessage` listener** чтобы передавать `sender` в handleMessage (это уже сделано).

4. **Тесты:** новый файл `tests/integration/message-sender-validation.test.js`:
   ```js
   describe('SW message sender validation', () => {
     it('rejects unlock from content-script context', async () => {
       const fakeSender = { id: chrome.runtime.id, tab: { url: 'https://evil.com' } };
       const result = await sendMessage(
         { type: 'unlock', accountIndex: 0, password: 'x' },
         fakeSender,
       );
       expect(result.error).toMatch(/Permission denied/);
     });
     // ... аналогично для всех POPUP_ONLY_TYPES
   });
   ```

**Acceptance criteria:**

- ✅ Все 10 POPUP_ONLY_TYPES возвращают `Permission denied` если вызваны не из extension context
- ✅ `dapp-request` корректно работает (он в CONTENT_SCRIPT_TYPES)
- ✅ Existing `npm test` passes
- ✅ E2E тест `tests/e2e/dapp-demo.spec.js` (если есть) проходит

---

#### P1-3. Persistent bruteforce protection (lockout state) ✅ DONE

**Файл:** `extension/background/service-worker.js`
**Найдено:** CRIT-3
**Время:** 2 часа

**Шаги:**

1. Удалить in-memory переменные `_failedAttempts`, `_lockoutUntil`.
2. Создать helper'ы:

   ```js
   const LOCKOUT_KEY = 'security:lockout';
   const MAX_LOCKOUT_MS = 15 * 60 * 1000; // 15 минут вместо 60 сек

   async function getLockoutState() {
     const { [LOCKOUT_KEY]: state = { failedAttempts: 0, lockoutUntil: 0 } } =
       await chrome.storage.local.get([LOCKOUT_KEY]);
     return state;
   }

   async function recordFailedAttempt() {
     const state = await getLockoutState();
     const next = state.failedAttempts + 1;
     const lockoutUntil =
       next >= 3 ? Date.now() + Math.min(MAX_LOCKOUT_MS, 5_000 * Math.pow(2, next - 3)) : 0;
     await chrome.storage.local.set({
       [LOCKOUT_KEY]: { failedAttempts: next, lockoutUntil },
     });
   }

   async function resetLockoutState() {
     await chrome.storage.local.remove([LOCKOUT_KEY]);
   }
   ```

3. Заменить в `unlock` case:

   ```js
   case 'unlock': {
     // ... validation ...
     const { lockoutUntil } = await getLockoutState();
     if (Date.now() < lockoutUntil) {
       const waitSec = Math.ceil((lockoutUntil - Date.now()) / 1000);
       throw new Error(`Подождите ${waitSec} сек`);
     }
     try {
       const unlockedWallet = await ethers.Wallet.fromEncryptedJson(...);
       // ...
       await resetLockoutState();
     } catch {
       await recordFailedAttempt();
       throw new Error('Неверный пароль');
     }
     // ...
   }
   ```

4. **Backoff schedule (exponential):**
   - 3 failures → 5 sec
   - 4 failures → 10 sec
   - 5 failures → 20 sec
   - 6 failures → 40 sec
   - 7 failures → 80 sec
   - 8 failures → 160 sec
   - 9+ failures → 15 min (cap)

5. **Тесты:** обновить `tests/unit/service-worker-unlock.test.js`:
   ```js
   it('persists lockout across SW restart', async () => {
     await mockSWHandle('unlock', { accountIndex: 0, password: 'wrong' });
     await mockSWHandle('unlock', { accountIndex: 0, password: 'wrong' });
     await mockSWHandle('unlock', { accountIndex: 0, password: 'wrong' });
     // 3 failures → lockout active
     mockSWRestart(); // simulates SW kill
     const result = await mockSWHandle('unlock', { accountIndex: 0, password: 'correct' });
     expect(result.error).toMatch(/Подождите/);
   });
   ```

**Acceptance criteria:**

- ✅ После SW restart lockout сохраняется
- ✅ Exponential backoff работает (cap 15 мин)
- ✅ Reset после успешного unlock'а

---

#### P1-4. `Object.defineProperty` configurable: false ✅ DONE

**Файл:** `extension/inpage/provider.js`
**Найдено:** CRIT-4
**Время:** 5 минут

**Шаги:**

```js
// Lines 222-227, 234-240
if (!window.ethereum) {
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    configurable: false, // ← было true
    writable: false,
  });
}

Object.defineProperty(window, 'sova', {
  value: provider,
  configurable: false, // ← было true
  writable: false,
});
```

**Acceptance criteria:**

- ✅ `delete window.sova` бросает ошибку (или silently fails)
- ✅ Demo страница всё ещё работает
- ✅ MetaMask coexistence по-прежнему функционирует

---

#### P1-5. Не персистить sensitive данные approval requests ✅ DONE

**Файл:** `extension/background/service-worker.js`
**Найдено:** CRIT-5
**Время:** 2 часа

**Шаги:**

1. Изменить `persistPendingRequest` чтобы хранить **только** метаданные:

   ```js
   async function persistPendingRequest(id, payload) {
     try {
       const { pendingDappRequests = {} } = await chrome.storage.session.get([
         'pendingDappRequests',
       ]);
       // Только метаданные. params НЕ персистим (могут содержать sensitive typed data).
       pendingDappRequests[id] = {
         id: payload.id,
         origin: payload.origin,
         method: payload.method,
         createdAt: payload.createdAt,
         expiresAt: payload.expiresAt,
       };
       await chrome.storage.session.set({ pendingDappRequests });
     } catch {}
   }
   ```

2. В `dapp-get-pending` handler — если pending не найден в `_pendingApprovals` Map (т.е. SW рестартанул), возвращать `expired`:

   ```js
   case 'dapp-get-pending': {
     if (msg.id) {
       const entry = _pendingApprovals.get(msg.id);
       if (!entry) {
         // SW рестартанул — pending lost. Возвращаем явный сигнал.
         return { request: null, reason: 'expired' };
       }
       return { request: { /* full data из in-memory entry */ } };
     }
   }
   ```

3. В `dapp-approval.js` обработать `reason: 'expired'` — показать сообщение «Запрос истёк, повторите действие в dApp» и закрыть окно.

4. Добавить cleanup job:
   ```js
   chrome.alarms.create('cleanup-pending', { periodInMinutes: 5 });
   chrome.alarms.onAlarm.addListener(async (alarm) => {
     if (alarm.name !== 'cleanup-pending') return;
     const { pendingDappRequests = {} } = await chrome.storage.session.get(['pendingDappRequests']);
     const now = Date.now();
     const cleaned = Object.fromEntries(
       Object.entries(pendingDappRequests).filter(([_, req]) => req.expiresAt > now),
     );
     await chrome.storage.session.set({ pendingDappRequests: cleaned });
   });
   ```

**Acceptance criteria:**

- ✅ После SW restart старые pending requests автоматически expired
- ✅ User видит понятное сообщение «Запрос истёк»
- ✅ В session storage не остаются params/typed data

---

### Phase 1 acceptance

После выполнения Phase 1:

1. **Manual smoke test:**
   - Create / unlock / send 0.0001 Sepolia ETH через popup — ✅
   - Connect через demo dApp / `eth_requestAccounts` → approval popup → одобрить → ✅
   - `personal_sign` через demo dApp → ✅
   - `eth_sendTransaction` через demo dApp на Sepolia → ✅
   - 5 раз подряд ввести неверный пароль → lockout → закрыть popup → подождать SW kill → открыть → lockout всё ещё активен → ✅
   - Попытаться `chrome.runtime.sendMessage({type: 'unlock', ...})` из console любой web-страницы → reject ✅

2. **Tests:**
   - `npm test` — все unit/integration тесты passing
   - `npm run test:e2e` — все e2e tests passing

3. **Code review:** один или два разработчика review всех изменений

4. **Bump version:** manifest.json `1.1.0 → 1.1.1` (security patch)

---

## Phase 2: HIGH severity (1 неделя) ✅ ЗАВЕРШЕНО 2026-04-08

> ✅ **СТАТУС:** Все 8 HIGH severity fixes выполнены 2026-04-08.
> Manifest version → 1.2.0. 251/251 unit+integration тестов passing.
> popup.js: 2240 → **1263 строк** (−977, −44%) благодаря P2-6.

### Цель

Закрыть все 8 HIGH severity findings. Это эксплуатируемые баги, которые в комбинации с CRITICAL'ами могли бы быть использованы.

### Задачи

#### P2-1. RPC method whitelist вместо blacklist ✅ DONE

**Файл:** `extension/background/service-worker.js`
**Найдено:** HIGH-1
**Время:** 1 час

См. AUDIT-REPORT.md HIGH-1 fix code.

**Acceptance:** все методы кроме whitelist'а возвращают `4200 Method not supported`.

---

#### P2-2. Sender validation в content-script.js ✅ DONE (бонус Phase 1)

**Файл:** `extension/content/content-script.js`
**Найдено:** HIGH-2
**Время:** 30 минут

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  // Only accept messages from our own extension service worker
  if (sender && sender.id !== chrome.runtime.id) return;
  if (sender && sender.tab) return; // не от content-script
  // ... rest
});
```

**Acceptance:** content script игнорирует сообщения с tab или с другого extension id.

---

#### P2-3. Заменить `innerHTML` на DOM API в dapp-approval.js ✅ DONE

**Файл:** `extension/popup/modules/dapp-approval.js`
**Найдено:** HIGH-3
**Время:** 2 часа

Найти все 6 мест с `innerHTML`:

- `addrRow.innerHTML = ...` (lines 138, 174)
- `warn.innerHTML = ...` (lines 121, 156, 180, 308)

Заменить на createElement + textContent. Пример:

```js
function buildAddressRow(addressString) {
  const row = document.createElement('div');
  row.className = 'dapp-kv';
  const k = document.createElement('span');
  k.className = 'dapp-k';
  k.textContent = 'Подписать от';
  const v = document.createElement('span');
  v.className = 'dapp-v mono';
  v.textContent = shortAddr(addressString);
  row.appendChild(k);
  row.appendChild(v);
  return row;
}
```

**Acceptance:** `grep 'innerHTML' extension/popup/modules/dapp-approval.js` — только в случаях где данные явно сгенерированы и безопасны (например, очистка `body.innerHTML = ''`).

---

#### P2-4. EIP-712 chainId mismatch — hard block ✅ DONE

**Файл:** `extension/background/service-worker.js`
**Найдено:** HIGH-4
**Время:** 1 час

В `handleSignTypedDataV4`, после вычисления `chainMismatch`:

```js
if (chainMismatch) {
  const e = new Error(
    `chainId mismatch: typed data is for chain ${domainChainId}, ` +
      `but wallet is on ${currentChainId}. Switch network in wallet first.`,
  );
  e.code = 4901; // Chain not configured
  throw e;
}
```

Удалить `chainMismatch` flag из approval params (больше не нужен).

В `dapp-approval.js` `renderSignTypedData` — удалить блок «danger warning», т.к. до approval теперь не дойдёт.

**Acceptance:**

- Тест: dApp шлёт typed data с domain.chainId=1 когда wallet на chainId=11155111 → запрос отклонён с code 4901 без открытия approval popup'а

---

#### P2-5. Invalidate `_accountsCache` после `addSubAccount` ✅ DONE

**Файл:** `extension/popup/popup.js:1158-1162`
**Найдено:** HIGH-5
**Время:** 5 минут

```js
await setLocal({ accounts, activeAccount: result.index });
setAccountsCache(accounts); // ← добавить
```

Также проверить **все** места которые модифицируют `chrome.storage.local.accounts`:

- `addSubAccount` ✅
- legacy migration в DOMContentLoaded
- `resetWallet` (если очищает storage)

**Acceptance:** после добавления субаккаунта меню аккаунтов сразу показывает новый аккаунт.

---

#### P2-6. Удалить delegation fallback chains в popup.js ✅ DONE (popup.js: 2240 → 1263 строк)

**Файл:** `extension/popup/popup.js`
**Найдено:** HIGH-6
**Время:** 4 часа (рискованно, нужны тесты)

**Подэтапы:**

1. Создать manifest зависимостей в начале `popup.js`:

   ```js
   function assertModulesLoaded() {
     const requirements = {
       PopupStorage: ['getLocal', 'setLocal', 'removeLocal', 'getSession', 'setSession'],
       PopupUiMessages: ['showError', 'setStatus', 'showSuccess', 'clearMessages', 'setLoading'],
       PopupAvatar: ['setAvatar'],
       PopupClipboard: ['copyText'],
       PopupTemplates: ['renderNetworkPickers', 'renderFeedbackMounts'],
       PopupSharedState: [],
       PopupNetworkState: [
         'initializeNetworkState',
         'getRpcUrlForNetwork',
         'getCurrentNetworkMeta',
         'setNetwork',
         '_readRpcChoice',
         '_saveRpcChoice',
         'NETWORKS',
         'DEFAULT_NETWORK_KEY',
       ],
       PopupTxHistory: ['loadTransactions', 'fetchAlchemyTransfers', 'renderTransactions'],
       PopupTokenState: [
         'getTokensForSelectedNetwork',
         'setTokensForSelectedNetwork',
         'loadTokenBalances',
         'fetchTokenInfo',
         'addToken',
         'removeToken',
       ],
       PopupSendFlow: [
         'sendTransaction',
         'confirmSend',
         'cancelSend',
         'showSendScreen',
         'resetSendFlowUI',
       ],
       PopupUiState: ['showScreen', 'switchTab', 'switchWalletTab'],
       PopupEventBinder: ['bindDeclarativeHandlers'],
       PopupDappApproval: ['getRequestIdFromUrl', 'handleRequest', 'renderConnectedSitesList'],
     };
     for (const [name, methods] of Object.entries(requirements)) {
       const mod = globalThis['Wolf' + name];
       if (!mod) {
         throw new Error(`Required module not loaded: Wolf${name}. Check popup.html script order.`);
       }
       for (const m of methods) {
         if (
           typeof mod[m] !== 'function' &&
           typeof mod[m] !== 'object' &&
           typeof mod[m] !== 'string'
         ) {
           throw new Error(`Wolf${name}.${m} is missing or wrong type`);
         }
       }
     }
   }
   ```

2. В `DOMContentLoaded` callback:

   ```js
   try {
     assertModulesLoaded();
   } catch (e) {
     document.body.innerHTML = `<div style="padding:24px;color:#f87171">
       <h2>Ошибка инициализации</h2><p>${e.message}</p>
     </div>`;
     console.error(e);
     return;
   }
   ```

3. **Постепенно** удалять fallback'и. Начать с самых маленьких:
   - `showScreen` (~10 строк fallback) → удалить
   - `bindDeclarativeHandlers` → удалить
   - `getNetworkConfigs` / `getRpcUrlForNetwork` → удалить
   - `loadTransactions`, `loadTokenBalances` → удалить (~50 строк каждый)
   - `sendTransaction`, `confirmSend` → удалить (~80 строк каждый)

4. После каждого удаления — `npm test` + manual smoke test.

**Risk:** удаление fallback'а может выявить случай где модуль на самом деле не вызывается → runtime error в продакшне. Поэтому делать постепенно с тестами.

**Acceptance:**

- `popup.js` уменьшается с 2240 до **примерно 1500-1600** строк
- Все тесты проходят
- Manual smoke test всех сценариев

---

#### P2-7. Сузить `host_permissions` ✅ DONE

**Файл:** `extension/manifest.json`
**Найдено:** HIGH-7
**Время:** 30 минут

```json
"host_permissions": [
  "https://*.g.alchemy.com/*",
  "https://*.infura.io/*",
  "https://*.quiknode.pro/*",
  "https://*.publicnode.com/*",
  "https://*.drpc.org/*",
  "https://*.llamarpc.com/*",
  "https://*.ankr.com/*",
  "https://*.chainstack.com/*",
  "https://*.1rpc.io/*"
]
```

Удалить:

- ❌ `https://*/*` — теперь content_scripts.matches достаточно (Chrome даёт ему права на эти URL без host_permissions)
- ❌ `http://localhost/*` — оставить только в content_scripts.matches
- ❌ `http://127.0.0.1/*` — то же

**Внимание:** проверить что после удаления:

- Content script всё ещё инжектится на любой https-страницу (это работает через `content_scripts.matches`, не через `host_permissions`)
- Token logo загрузка работает (CDN'ы не в `host_permissions`, но в `img-src` CSP — это другое)

Если что-то ломается — добавить нужные хосты явно.

**Acceptance:** demo dApp работает, token logos загружаются.

---

#### P2-8. Await `sendToSW` в `confirmSend` ✅ DONE

**Файл:** `extension/popup/popup.js:1657`
**Найдено:** HIGH-8
**Время:** 5 минут

```js
// Было:
sendToSW({ type: 'reset-lock-timer' });

// Стало:
const r = await sendToSW({ type: 'reset-lock-timer' });
if (!r?.ok) {
  console.warn('[confirmSend] reset-lock-timer failed', r);
  // Если SW не отвечает в течение 15 секунд, есть риск что подпись тоже упадёт
}
```

Также проверить другие fire-and-forget вызовы `sendToSW`:

- `loadWalletScreen` → `sendToSW({ type: 'reset-lock-timer' })` — допустимо fire-and-forget (не блокирующее)
- `notifyChainChangedToDapps` — fire-and-forget OK (broadcast)

**Acceptance:** confirmSend работает, при SW timeout видно warning в console.

---

### Phase 2 acceptance

После Phase 2:

1. **Manual security smoke test:**
   - Попытаться отправить fake `dapp-approval-response` из console — отклонено
   - Попытаться отправить fake `dapp-event` через chrome.runtime — content-script игнорирует
   - Подписать typed data с wrong chainId — hard reject
   - Попытаться выполнить произвольный `eth_lol` метод — `Method not supported`

2. **Tests:** все passing

3. **Bump version:** `1.1.1 → 1.2.0`

---

## Phase 3: MEDIUM severity (2 недели) ✅ ЗАВЕРШЕНО 2026-04-08

### Цель

Defense in depth, hardening, edge case handling. Эти проблемы не критичны, но в совокупности повышают качество кода.

> ✅ **СТАТУС:** Все 17 MEDIUM + 2 LOW (LOW-8, LOW-9) выполнены 2026-04-08.
> Manifest version: `1.2.2 → 1.3.0`. 331/331 unit+integration tests passing.
> Detailed fix log см. в `AUDIT-REPORT.md` (✅ FIXED пометки в §6 и §7).

### Подразделения

#### Группа A: CSP / Manifest hardening (3 часа)

- **MED-1.** Удалить `https:` wildcard из `img-src` CSP
- **MED-2.** Подготовить переход к `style-src 'self'` без `unsafe-inline`:
  - Выявить все inline styles в `popup.html` и `dapp-demo.html`
  - Перенести в внешние `.css` файлы
  - Изменить CSP

#### Группа B: SW rate limiting / DoS protection (4 часа)

- **MED-3.** Per-origin лимит pending approvals (max 1)
- **MED-4.** Криптостойкая генерация approval ID
- **MED-7.** Лимит размера `connectedOrigins` (LRU 100)
- **MED-8.** Уменьшить `auditLog` cap до 500 + TTL 30 дней
- **MED-17.** LRU cap для `_walletsByAddress` (max 20)

#### Группа C: Privacy hardening (2 часа)

- **MED-5.** Scope `knownRecipients` per-origin
- **MED-6.** Очистка mnemonic после `addSubAccount`
- **MED-16.** Очистка password в `dapp-approval.js` после unlock

#### Группа D: Input validation (3 часа)

- **MED-12.** Improved amount validation (Infinity, scientific notation)
- **LOW-5** (поднять до MED). Validate `domain.chainId` как число
- Validate `txInput.gas`/`gasPrice`/`value` как hex/decimal с диапазоном

#### Группа E: UX improvements (4 часа)

- **MED-9.** Token logo loading timeout 3 сек
- **MED-14.** Warning в tx-list при не-Alchemy RPC
- **MED-15.** Cleanup notification expiry timer
- **LOW-14** (поднять). Try/catch в bootstrap с error overlay

#### Группа F: Code quality (3 часа)

- **MED-10.** Proper tokenizer в event-binder.js
- **MED-13.** Консолидировать `ALLOWED_RPC_HOSTS` в shared/
- **MED-11.** Address null-checks после `getAccountsCached`

#### Группа G: Stop-gap для rate limiting на inpage (2 часа)

- **LOW-9** (поднять до MED). Inpage event emitter max listeners (cap 20)
- **LOW-8** (поднять). Inpage `_pending` Map с TTL

### Phase 3 acceptance

- **Static analysis:** `grep` для все упомянутых паттернов — clean
- **Tests:** покрытие всех новых helper'ов unit-тестами
- **Performance:** baseline регрессия < 10% по `tests/e2e/perf-baseline.spec.js`
- **Bump version:** `1.2.0 → 1.3.0`

---

## Phase 4: LOW severity + cleanup (по возможности) ✅ ЗАВЕРШЕНО 2026-04-09

> ✅ **СТАТУС:** 8 LOW fixes выполнены: LOW-1, LOW-3, LOW-4, LOW-10, LOW-11, LOW-12, LOW-14, LOW-15.
> Оставшиеся LOW (2, 5, 6, 7, 13) отнесены к Phase 5 или deprioritized.
> 380/380 unit+integration tests passing. Manifest/package version → 1.5.0.

### Цель

Документация, code style, dead code removal. Не блокирует release, но улучшает maintainability.

### Задачи

#### P4-1. Documentation cleanup (2 часа)

- **LOW-12.** Удалить или пометить как HISTORICAL:
  - `tests/TEST-IMPLEMENTATION-COMPLETE.md` — DELETE
  - `extension_changes_since_backup.md` — DELETE или move в `docs/historical/`
  - `extension/optimization-plan.md` — добавить header "STATUS: HISTORICAL"
- **Update DOCUMENTATION.md:**
  - Корректные размеры файлов (service-worker.js 238 → 1164)
  - Добавить inpage/, content/ в file inventory
  - Обновить §16.9 с deeper descriptions всех phases
- **Update RECOMMENDATIONS.md:**
  - Версии (manifest 1.1.0)
  - Mark ✅ done items
  - Добавить новые рекомендации по AUDIT-REPORT
- **Update DAPP-CONNECT-PLAN.md:**
  - Header «STATUS: COMPLETED 2026-04-08»
  - Resolve §12 open questions
  - Update §14 risks с фактическими исходами

#### P4-2. Code cleanup (3 часа)

- **LOW-1.** Wrap console.error в debug-flag условие
- **LOW-3.** Document `personal_sign` parameter order acceptance
- **LOW-4.** Truncate values in `toBigIntHex` error messages
- **LOW-10.** Sanitize SW error logs
- **LOW-11.** Sync package.json и manifest.json versions

#### P4-3. Documentation updates / regression tests (3 часа)

- **LOW-13.** Снапшот тест для dapp-demo.html (visual regression — например, через Playwright `toMatchSnapshot`)

#### P4-4. Опциональные UX (2 часа)

- **LOW-2.** Сделать audit log опциональным (off by default? или toggle в настройках?)
- **LOW-15.** Усилить mnemonic quiz: вместо 3 из 12 → 5-6 из 12

#### P4-5. Test coverage gaps (4 часа)

Создать новые тесты для всех recently-added features (см. AUDIT-REPORT §9.5):

- `tests/integration/inline-unlock-approval.test.js` — needsUnlock + targetAccountIndex flow
- `tests/integration/wallet-revoke-permissions.test.js` — end-to-end revoke
- `tests/integration/eth-accounts-active-filter.test.js` — filtering by `_activeWalletAddress`
- `tests/integration/broadcast-accounts-changed.test.js` — broadcast logic
- `tests/e2e/sw-restart-during-approval.spec.js` — SW kill + recovery

### Phase 4 acceptance

- Documentation files в актуальном состоянии
- Test coverage увеличена до ~80% по estimated metric
- **Bump version:** `1.3.0 → 1.3.1`

---

## Phase 5: Архитектурный refactor (long-term)

### Цель

Перевести проект на современную архитектуру для устойчивого развития.

### Задачи

#### P5-1. Декомпозиция popup.js (8 часов)

После Phase 2 (удаление fallback chains) `popup.js` будет ~1500 строк. Дальше декомпозировать на:

| Новый модуль      | Что выделить                                                       |                          Из |
| ----------------- | ------------------------------------------------------------------ | --------------------------: |
| `bootstrap.js`    | DOMContentLoaded, миграции, init                                   |                    popup.js |
| `accounts.js`     | switchAccount, addSubAccount, renderAccountMenu, getAccountsCached |                    popup.js |
| `quiz-flow.js`    | createWallet, mnemonic display, quiz validation                    |                    popup.js |
| `import-flow.js`  | importWallet validation                                            |                    popup.js |
| `refresh-loop.js` | startAutoRefresh, stopAutoRefresh, refreshActiveAccountData        |                    popup.js |
| `unlock-flow.js`  | unlockWallet, lockWallet, handleSWLocked                           |                    popup.js |
| `address-book.js` | knownRecipients management                                         | popup.js + dapp-approval.js |

После рефакторинга `popup.js` должен быть **не более 300-400 строк** — только wiring и event listeners.

#### P5-2. Bundler / TypeScript (12 часов)

- Установить esbuild или vite
- Конвертировать модули в ES modules с явными `import`/`export`
- Bundle в `popup.bundle.js` для CSP-совместимости
- Опционально: миграция в TypeScript (минимум для shared/, network-state, send-flow)

#### P5-3. CI/CD (4 часов)

GitHub Actions workflow:

```yaml
name: CI
on: [pull_request, push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test
      - run: npx playwright install chromium
      - run: npm run test:e2e
      - name: Perf gate
        run: |
          # Compare against baseline
```

Branch protection: main требует green CI.

#### P5-4. WalletConnect v2 (16 часов)

См. `RECOMMENDATIONS.md` §4.1. Reference implementation: использовать `@walletconnect/sign-client`.

### Phase 5 acceptance

- popup.js < 400 строк
- Build pipeline: `npm run build` производит распакованный extension
- CI passes на каждом PR
- Bump version: `1.x.x → 2.0.0`

---

## Test coverage gap closure (parallel track)

В дополнение к фазам, эти тесты должны быть добавлены постепенно:

### Unit tests

| Файл                                        | Что покрывает                                  | Effort |
| ------------------------------------------- | ---------------------------------------------- | ------ |
| `tests/unit/sender-validation.test.js`      | isFromExtensionContext, isFromOurContentScript | 30m    |
| `tests/unit/lockout-state.test.js`          | persistent lockout, exponential backoff        | 1h     |
| `tests/unit/eth-accounts-filter.test.js`    | active wallet filter logic                     | 30m    |
| `tests/unit/event-binder-tokenizer.test.js` | proper string parsing                          | 1h     |
| `tests/unit/amount-validation.test.js`      | Infinity, scientific notation, edge cases      | 30m    |

### Integration tests

| Файл                                                    | Effort |
| ------------------------------------------------------- | ------ |
| `tests/integration/inline-unlock-approval.test.js`      | 2h     |
| `tests/integration/wallet-revoke-permissions.test.js`   | 1h     |
| `tests/integration/broadcast-accounts-changed.test.js`  | 2h     |
| `tests/integration/sw-restart-pending-approval.test.js` | 2h     |
| `tests/integration/message-sender-validation.test.js`   | 1h     |

### E2E tests

| Файл                                             | Effort |
| ------------------------------------------------ | ------ |
| `tests/e2e/dapp-demo.spec.js` (полный flow)      | 3h     |
| `tests/e2e/multi-account-multi-mnemonic.spec.js` | 2h     |
| `tests/e2e/sw-restart-recovery.spec.js`          | 2h     |

**Total test coverage work:** ~18 часов (можно делать параллельно с phase'ами)

---

## Документация — обновления

После каждой phase обновлять следующие документы:

### `DOCUMENTATION.md`

- §2.1 Layered model — корректные счётчики строк
- §16 dApp connectivity — добавить `wallet_revokePermissions`, inline unlock, и т.д.
- §12 Known limitations — обновить (некоторые limitations устранены)

### `RECOMMENDATIONS.md`

- ✅ Mark items as DONE per phase
- Add new items from AUDIT-REPORT
- Sync version numbers

### `AUDIT-REPORT.md` (этот документ)

- Mark findings as ✅ FIXED по мере исправления (это log of audit work)

### `tests/test-status.md` (новый)

Создать как живой документ:

```
Last run: <date>
Tests: X total, Y passing, Z failing
Coverage: ~XX% (estimated)
Latest changes: <list>
```

Обновлять после каждого test run.

---

## Risk assessment

### Технические риски

| Риск                                                      | Вероятность | Mitigation                                                                 |
| --------------------------------------------------------- | ----------- | -------------------------------------------------------------------------- |
| Phase 2 P2-6 (удаление fallback'ов) ломает работающий код | Высокая     | Делать постепенно, после каждого fallback запускать тесты                  |
| Persistent lockout state блокирует пользователя надолго   | Средняя     | Cap 15 минут + reset через UI «I forgot password»                          |
| Удаление `https://*/*` из host_permissions ломает что-то  | Средняя     | Тщательное тестирование всех RPC endpoints                                 |
| Migration старых пользователей на новый network-config    | Низкая      | Migration code в popup.js bootstrap (при отсутствии custom RPC — fallback) |
| Регрессия в CSP после удаления `unsafe-inline`            | Средняя     | Проверить визуально все экраны                                             |

### Operational риски

| Риск                                                                | Mitigation                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Невозможно отозвать Alchemy ключ из-за привязки к платному аккаунту | Создать backup ключ ДО revoke; уведомить пользователей через лендинг |
| Пользователи с `1.0.0` теряют доступ из-за migration ошибки         | Тщательная backwards compat в migration code                         |
| Rollback после неудачного релиза                                    | Сохранить старый zip; documentation manual rollback steps            |

---

## Контрольные точки

### После Phase 1 (день 2)

- ☐ Все CRITICAL fixes pushed
- ☐ Manual security smoke test passed
- ☐ Code review by 1 reviewer
- ☐ Version 1.1.1 released как security patch

### После Phase 2 (неделя 1)

- ☐ Все HIGH fixes pushed
- ☐ popup.js < 1700 строк
- ☐ Все existing tests passing
- ☐ Version 1.2.0 released

### После Phase 3 (неделя 3)

- ☐ Все MEDIUM fixes pushed
- ☐ Defense in depth слои внедрены
- ☐ Performance baseline в пределах 10% от исходного
- ☐ Version 1.3.0 released

### После Phase 4 (неделя 4-6)

- ☐ Documentation актуальна
- ☐ Test coverage ~80%
- ☐ Версия 1.3.1

### После Phase 5 (когда появится ресурс)

- ☐ popup.js < 400 строк
- ☐ Build pipeline работает
- ☐ CI на GitHub
- ☐ Версия 2.0.0

---

## Связанные документы

- **`AUDIT-REPORT.md`** — детальные находки с file:line ссылками. Этот плейбук ссылается на ID находок (CRIT-X, HIGH-X, MED-X, LOW-X)
- **`RECOMMENDATIONS.md`** — стратегические рекомендации (от 2026-04-07). Многие переехали в этот план
- **`DOCUMENTATION.md`** — техническая документация (живой документ)
- **`DAPP-CONNECT-PLAN.md`** — план dApp-коннекта (выполнен)
- **`security-incidents/INC-2026-03-29-wallet-theft/`** — исторический инцидент, hardening recommendations

---

## Заключение

Этот план **не jam-everything-at-once approach**. Он структурирован в фазы:

- **Phase 1** (2 дня) — must-do для безопасности перед публикацией
- **Phase 2** (1 неделя) — закрытие exploit'абельных багов
- **Phase 3** (2 недели) — defense in depth
- **Phase 4** (по возможности) — cleanup и документация
- **Phase 5** (long-term) — архитектурный рост

После Phase 1+2 проект готов к публикации в Chrome Web Store с приемлемым уровнем безопасности. После Phase 3 — production-grade.

Phase 5 — это инвестиция в долгосрочное развитие, включая WalletConnect, hardware wallet, NFT и т.д. (см. `RECOMMENDATIONS.md`).

**Следующее действие:** начать с **P1-1** (удалить hardcoded API key) — это самое критичное и самое простое.

---

_Документ обновляется по мере выполнения. Помечать ✅ FIXED при закрытии каждой задачи._
