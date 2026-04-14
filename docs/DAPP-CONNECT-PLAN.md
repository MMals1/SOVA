# План разработки: dApp-коннект + демо-страница для SOVA Wallet

Версия: 1.0
Дата: 2026-04-07
Контекст: этот план описывает, как добавить в SOVA Wallet возможность подключения к веб-страницам (dApp'ам), и как построить демонстрационную страницу на лендинге для проверки этого функционала.

> **Важно:** изначально SOVA Wallet **не умеет** подключаться к dApp'ам. В `manifest.json` отсутствуют `content_scripts`, `web_accessible_resources`, `externally_connectable`, и в коде нигде не инжектится `window.ethereum`. Подключение к Uniswap, OpenSea и любому другому dApp'у сейчас **невозможно**. Этот план закрывает эту gap'у.

---

## 1. Цели и рамки

### 1.1 Цели

1. Любая веб-страница может вызвать `window.ethereum.request(...)` и получить ответ от SOVA Wallet (стандартный EIP-1193).
2. Пользователь видит попап-подтверждение для **каждого** чувствительного действия: connect, sign, send.
3. Полная изоляция между dApp'ом и приватным ключом — ключ остаётся только в service worker'е (как сейчас).
4. Совместимость с ethers.js / viem / wagmi / web3.js на стороне dApp'а — без специальной интеграции со стороны разработчика dApp'а.
5. На лендинге есть демо-страница `site/dapp-demo.html`, которая:
   - показывает кнопку «Connect SOVA Wallet»,
   - отображает адрес, chainId, баланс после подключения,
   - позволяет отправить тестовый перевод 0.0001 Sepolia ETH,
   - демонстрирует `personal_sign` и `eth_signTypedData_v4`,
   - служит регрессионным тестом после релизов.

### 1.2 Вне рамок (для первой итерации)

- WalletConnect v2 (отдельная задача, см. `RECOMMENDATIONS.md` §4.1).
- Multi-tab одновременная работа с разными dApp'ами.
- `wallet_addEthereumChain` / `wallet_switchEthereumChain` (можно добавить во второй итерации).
- Auto-reconnect при перезапуске браузера (можно добавить во второй итерации).
- Поддержка устаревших методов (`eth_coinbase`, `eth_sign`) — они небезопасны и исключаются намеренно.

### 1.3 Стандарты, на которые опираемся

| Стандарт     | Что даёт                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| **EIP-1193** | Интерфейс Ethereum JavaScript provider (`request`, `on`, события `accountsChanged`, `chainChanged`, `connect`, `disconnect`) |
| **EIP-6963** | Multi-injected provider discovery (несколько wallet'ов на странице не конфликтуют)                                           |
| **EIP-712**  | `eth_signTypedData_v4` — типизированные подписи (permit, orders)                                                             |
| **EIP-1559** | Fee market (уже используется в `send-flow.js`)                                                                               |
| **EIP-2255** | `wallet_getPermissions` / `wallet_requestPermissions` (опционально, для второй итерации)                                     |

Ссылки на EIP — не вставляются в код, это только reference для разработчиков.

---

## 2. Текущее состояние (почему нельзя просто «включить»)

Для dApp-коннекта требуется 3-уровневая архитектура:

```
┌──────────────────────┐
│  dApp web page       │  <-- window.ethereum.request(...)
│  (Uniswap и т.п.)    │       ↑
└──────────────────────┘       │ window.postMessage
           ▲                   ▼
           │           ┌─────────────────────┐
           │           │  inpage.js          │  <-- Injected в MAIN world
           │           │  (EIP-1193 provider)│
           │           └─────────────────────┘
           │                   ↑
           │                   │ window.postMessage
           │                   ▼
           │           ┌─────────────────────┐
           │           │  content-script.js  │  <-- ISOLATED world
           │           │  (bridge SW↔inpage) │
           │           └─────────────────────┘
           │                   ↑
           │                   │ chrome.runtime.sendMessage
           │                   ▼
           │           ┌─────────────────────┐
           │           │  service-worker.js  │  <-- Держит ключ
           │           │  (+ popup approval) │      открывает popup для подтверждения
           │           └─────────────────────┘
           └───────────────────┘
```

**Что надо добавить относительно сегодняшней архитектуры:**

| Компонент                                  | Статус сейчас | Что нужно                                                |
| ------------------------------------------ | ------------- | -------------------------------------------------------- |
| `inpage.js`                                | **нет**       | Создать                                                  |
| `content-script.js`                        | **нет**       | Создать                                                  |
| `manifest.content_scripts`                 | **нет**       | Добавить                                                 |
| `manifest.web_accessible_resources`        | **нет**       | Добавить (чтобы inpage.js был доступен для инжекции)     |
| Новые типы сообщений в SW                  | **нет**       | `dapp-connect`, `dapp-request`, `dapp-sign`, `dapp-send` |
| Approval UI в popup                        | **нет**       | Новый экран `dapp-approval-screen`                       |
| Хранение подключённых origin'ов            | **нет**       | Новый ключ storage: `connectedOrigins`                   |
| События `accountsChanged` / `chainChanged` | **нет**       | SW → content-script broadcast                            |
| CSP: разрешить связь с content scripts     | частично      | Ревизия и обновление                                     |

---

## 3. Архитектура компонентов

### 3.1 `inpage.js` (injected page script)

**Где живёт:** основной (MAIN) world веб-страницы. Имеет доступ к `window`, может присвоить `window.ethereum`.

**Что делает:**

1. Создаёт объект `SovaProvider` — реализация EIP-1193:
   - `request({ method, params })` — асинхронный вызов, возвращает Promise.
   - `on(event, handler)` / `removeListener(event, handler)` — подписка на события.
   - `isSova: true` — маркер для dApp'ов, которые проверяют тип кошелька.
   - `isMetaMask: false` — **важно** не притворяться MetaMask'ом (многие dApp'ы делают hack'и под MM).
2. Прокидывает `request`'ы через `window.postMessage` в content-script.
3. Слушает ответы от content-script'а через `window.addEventListener('message', ...)`.
4. Регистрируется через EIP-6963 (`window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {...}))`) — для multi-wallet discovery.
5. Присваивается в `window.ethereum` **только** если `window.ethereum` ещё не существует (не перезаписываем MetaMask).

**Структура:**

```
extension/inpage/provider.js
├── SovaProvider class
│   ├── request()
│   ├── _send() - postMessage dispatcher
│   ├── _handleMessage() - подписка на ответы
│   ├── _emit() - события EIP-1193
│   └── on / off / removeListener
├── EIP-6963 announcement helper
└── Initialization (условная инжекция в window.ethereum)
```

**Размер:** ~300 строк JS, без внешних зависимостей (никакого ethers внутри inpage.js — нам нужно только прокидывать JSON-RPC payload'ы).

### 3.2 `content-script.js` (bridge)

**Где живёт:** isolated world расширения. Имеет доступ к `chrome.runtime`, но не к `window` страницы напрямую.

**Что делает:**

1. При загрузке страницы **инжектит** `inpage.js` через создание `<script>` тега, который читает из `web_accessible_resources`:

```js
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inpage/provider.js');
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);
```

2. Слушает `window.addEventListener('message', ...)` от inpage:
   - Фильтрует сообщения по `event.source === window` и `event.data.target === 'sova-content'`.
   - Форвардит в SW через `chrome.runtime.sendMessage({ type: 'dapp-request', origin: location.origin, payload })`.
3. Слушает ответы от SW через `chrome.runtime.onMessage.addListener` и шлёт обратно в inpage через `window.postMessage`.
4. Слушает broadcast-события `accountsChanged` / `chainChanged` от SW и эмитит их в inpage.

**Размер:** ~150 строк.

**Критично:** content-script **не хранит** ничего, кроме временного request ID maps. Вся логика — в SW.

### 3.3 Расширение `service-worker.js`

**Новые типы сообщений (от content-script):**

| `type`         | Параметры                                     | Результат                            | Описание                                            |
| -------------- | --------------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| `dapp-request` | `{ origin, payload: { id, method, params } }` | `{ id, result }` или `{ id, error }` | Универсальная точка входа для всех EIP-1193 методов |

**Поддерживаемые EIP-1193 методы (первая итерация):**

| Method                      | Требует popup approval? | Описание                                                            |
| --------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `eth_chainId`               | ❌                      | Возвращает текущий `chainId` активной сети                          |
| `eth_accounts`              | ❌ (если уже подключён) | Возвращает `[address]` если origin в `connectedOrigins`, иначе `[]` |
| `eth_requestAccounts`       | ✅                      | Показывает popup с approval, добавляет origin в `connectedOrigins`  |
| `net_version`               | ❌                      | Возвращает chainId как строку                                       |
| `eth_blockNumber`           | ❌                      | Проксирует в RPC                                                    |
| `eth_getBalance`            | ❌                      | Проксирует в RPC (read-only)                                        |
| `eth_call`                  | ❌                      | Проксирует в RPC (read-only)                                        |
| `eth_estimateGas`           | ❌                      | Проксирует в RPC                                                    |
| `eth_gasPrice`              | ❌                      | Проксирует в RPC                                                    |
| `eth_getTransactionByHash`  | ❌                      | Проксирует в RPC                                                    |
| `eth_getTransactionReceipt` | ❌                      | Проксирует в RPC                                                    |
| `eth_sendTransaction`       | ✅                      | Popup approval → подпись → broadcast                                |
| `personal_sign`             | ✅                      | Popup approval → подпись сообщения                                  |
| `eth_signTypedData_v4`      | ✅                      | Popup approval → EIP-712 подпись                                    |
| `wallet_getPermissions`     | ❌                      | Возвращает список accounts permission (EIP-2255 minimal)            |

**Явно отклоняемые методы (для безопасности):**

| Method                                       | Причина отказа                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `eth_sign`                                   | Небезопасен: подписывает произвольный хэш. MetaMask тоже его deprecate'нул. |
| `eth_sendRawTransaction`                     | Мы подписываем сами, не принимаем pre-signed.                               |
| `eth_signTypedData_v1` / `v2` / `v3`         | Устаревшие версии, только v4.                                               |
| `eth_getEncryptionPublicKey` / `eth_decrypt` | Не поддерживаются ethers.js нативно, не приоритет.                          |

SW возвращает `{ code: 4200, message: 'Method not supported' }` (стандартный EIP-1193 error code).

### 3.4 Новый storage ключ: `connectedOrigins`

```ts
type ConnectedOrigins = {
  [origin: string]: {
    addresses: string[]; // какие адреса разрешены этому origin'у
    chainId: number; // какая сеть была при подключении
    connectedAt: number; // timestamp
    lastUsedAt: number; // timestamp последнего запроса
    permissions: string[]; // ['eth_accounts', ...]
  };
};
```

Хранится в `chrome.storage.local.connectedOrigins`. При `eth_requestAccounts` SW:

1. Проверяет, есть ли уже origin в storage.
2. Если есть — возвращает `addresses` без попапа.
3. Если нет — открывает popup через `chrome.action.openPopup()` (доступно в MV3), ждёт ответа от popup'а.
4. После approval — записывает в storage и возвращает.

**Отключение:** в popup'е — экран `connected-origins-screen` со списком, кнопкой «Disconnect» для каждого.

### 3.5 Popup approval UI

**Новый экран:** `popup/popup.html` → `<section id="dapp-approval-screen">`.

Показывается когда SW получает запрос на approval (`eth_requestAccounts`, `eth_sendTransaction`, `personal_sign`, `eth_signTypedData_v4`).

**Как popup узнаёт о запросе:**

Service worker не может открыть popup напрямую (в MV3 `chrome.action.openPopup()` доступно только из user gesture), поэтому:

1. SW сохраняет pending request в `chrome.storage.session.pendingDappRequest = { id, origin, method, params, createdAt }`.
2. SW вызывает `chrome.action.setBadgeText({ text: '!' })` + `chrome.action.setBadgeBackgroundColor({ color: '#f5a623' })`.
3. SW показывает `chrome.notifications.create(...)` (нужен permission `notifications` в manifest).
4. Пользователь кликает иконку SOVA → popup открывается → читает `pendingDappRequest` → показывает approval screen.
5. Popup → SW сообщение `dapp-approval-response: { id, approved: boolean }`.
6. SW резолвит исходный `dapp-request` и отвечает content-script'у.

**Альтернатива (предпочтительнее):** открывать mini-popup окно через `chrome.windows.create({ url: 'popup/popup.html?request=<id>', type: 'popup', width: 380, height: 600 })`. Это не требует user gesture и создаёт отдельное окно. Закрывается через `window.close()` после approval.

**UI для разных запросов:**

| Метод                  | Что показать                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eth_requestAccounts`  | Origin (favicon + domain), список адресов с чекбоксами, «Connect» / «Reject»                                                                             |
| `eth_sendTransaction`  | From, To (с first-time warning — см. `RECOMMENDATIONS.md` §2.1.2), value в ETH, gas estimate, total, raw data (expand), «Confirm» / «Reject»             |
| `personal_sign`        | Origin, полный текст сообщения (UTF-8 decode), warning если сообщение выглядит как hash (64 hex chars), «Sign» / «Reject»                                |
| `eth_signTypedData_v4` | Origin, parsed typed data в виде tree, явно: `domain.name`, `primaryType`, все поля, warning если `domain.chainId !== currentChainId`, «Sign» / «Reject» |

**Важные UI-элементы везде:**

- Favicon + domain origin'а (визуальная верификация, снижает phishing).
- Индикатор сети (Sepolia badge если testnet).
- Кнопка «View raw data» для продвинутых пользователей.
- Таймер «request will expire in 60s» (чтобы pending request'ы не висели бесконечно).

---

## 4. Изменения в `manifest.json`

### 4.1 До (текущее состояние)

```json
{
  "manifest_version": 3,
  "name": "SOVA Wallet",
  "permissions": ["storage", "alarms", "clipboardWrite"],
  "host_permissions": [
    /* RPC хосты */
  ],
  "action": { "default_popup": "popup/popup.html" },
  "background": { "service_worker": "background/service-worker.js" },
  "content_security_policy": { "extension_pages": "..." }
}
```

### 4.2 После (с dApp-коннектом)

```json
{
  "manifest_version": 3,
  "name": "SOVA Wallet",

  "permissions": ["storage", "alarms", "clipboardWrite", "notifications", "activeTab"],

  "host_permissions": [
    "https://*.g.alchemy.com/*",
    "https://*.infura.io/*",
    "https://*.publicnode.com/*",
    "https://*.drpc.org/*",
    /* ... остальные RPC хосты ... */
    "https://*/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],

  "content_scripts": [
    {
      "matches": ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
      "js": ["content/content-script.js"],
      "run_at": "document_start",
      "all_frames": false,
      "world": "ISOLATED"
    }
  ],

  "web_accessible_resources": [
    {
      "resources": ["inpage/provider.js"],
      "matches": ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"]
    }
  ],

  "action": { "default_popup": "popup/popup.html" },
  "background": { "service_worker": "background/service-worker.js" },

  "content_security_policy": {
    "extension_pages": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://*.g.alchemy.com https://*.infura.io https://*.publicnode.com https://*.drpc.org https://*.llamarpc.com https://*.ankr.com https://*.chainstack.com https://*.1rpc.io https://*.quiknode.pro; img-src 'self' https://raw.githubusercontent.com https://tokens.1inch.io https://tokens-data.1inch.io data: https:; object-src 'none'; frame-ancestors 'none'; form-action 'none'"
  }
}
```

**Что добавлено:**

1. **`permissions`:**
   - `notifications` — для `chrome.notifications.create` при pending dApp request.
   - `activeTab` — для `chrome.tabs.query({active: true})` чтобы узнать favicon текущей вкладки.

2. **`host_permissions`:** `https://*/*` и localhost. **Это широкое разрешение** — нужно, потому что content script должен работать на любом dApp'е. Альтернатива — `optional_host_permissions` + просить пользователя разрешить каждый домен, но это ломает UX подключения.

3. **`content_scripts`:**
   - `matches`: https + localhost (для дев-тестирования демо-страницы).
   - `run_at: "document_start"` — важно, чтобы `window.ethereum` был доступен **до** выполнения скриптов dApp'а.
   - `all_frames: false` — НЕ инжектить в iframe'ы, это частый фишинг вектор.
   - `world: "ISOLATED"` — стандартный isolated world, есть доступ к `chrome.runtime`.

4. **`web_accessible_resources`:** `inpage/provider.js` должен быть доступен для загрузки со страницы (чтобы content-script мог его инжектировать как `<script src="chrome-extension://id/inpage/provider.js">`).

5. **CSP `img-src`:** добавлен `https:` для загрузки favicon'ов dApp'ов в approval UI.

**Чего НЕ добавляется:**

- `externally_connectable` — это альтернативный механизм, позволяющий страницам напрямую звать `chrome.runtime.sendMessage` (без content script). Мы **не** используем его, потому что:
  - требует перечислить все dApp'ы в `matches` (невозможно для universal wallet),
  - даёт странице прямую связь с SW, минуя нашу проверку origin'а.
- `tabs` (полное) — достаточно `activeTab`.

### 4.3 Влияние на существующий функционал

- **Popup работает как раньше** — content script и inpage работают в tabs, popup остаётся изолированным.
- **Service worker обрабатывает существующие типы сообщений** (`unlock`, `send-eth`, ...) + новые типы (`dapp-request`, `dapp-approval-response`).
- **Session isolation сохраняется:** SW по-прежнему держит приватный ключ только в памяти, content-script получает только hash/result, ключ не покидает SW.
- **Auto-lock работает:** если SW залочен, `dapp-request` для чувствительных методов возвращает ошибку `{ code: 4100, message: 'User is not authenticated' }` → dApp должен пере-запросить `eth_requestAccounts`.

---

## 5. Детали реализации EIP-1193

### 5.1 Формат сообщений между inpage и content-script

**Inpage → Content script:**

```js
window.postMessage(
  {
    target: 'sova-content',
    id: uniqueRequestId,
    payload: { method: 'eth_requestAccounts', params: [] },
  },
  '*',
);
```

**Content script → Inpage:**

```js
window.postMessage(
  {
    target: 'sova-inpage',
    id: uniqueRequestId,
    result: ['0xabc...'], // или error: { code: 4001, message: 'User rejected' }
  },
  '*',
);
```

**Content script → SW:**

```js
chrome.runtime.sendMessage({
  type: 'dapp-request',
  origin: location.origin,
  payload: { id, method, params },
});
```

### 5.2 EIP-1193 events

Провайдер обязан эмитить события:

| Событие           | Когда                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| `connect`         | После успешного первого `eth_requestAccounts`                            |
| `disconnect`      | Когда пользователь отключает origin в popup'е                            |
| `accountsChanged` | При переключении активного аккаунта (если origin имеет доступ к новому)  |
| `chainChanged`    | При переключении сети в popup'е (SW broadcast в content script → inpage) |

SW при событиях:

```js
chrome.tabs.query({ url: ['https://*/*'] }, (tabs) => {
  tabs.forEach((tab) => {
    chrome.tabs.sendMessage(tab.id, {
      type: 'dapp-event',
      event: 'chainChanged',
      data: newChainId,
    });
  });
});
```

Content script форвардит в inpage, inpage эмитит подписчикам.

### 5.3 `personal_sign` — детали

```
params: [messageHex, address]
```

SW:

1. Проверяет что `origin` в `connectedOrigins`.
2. Проверяет что `address` соответствует одному из подключённых.
3. Декодирует `messageHex` в UTF-8 для показа в popup'е.
4. Popup approval → `wallet.signMessage(message)` → hex signature.
5. Возвращает `{ id, result: '0x...signature' }`.

**Валидация:** если сообщение выглядит как 32-byte hash (ровно 64 hex chars) — показать warning «Это похоже на хэш. Убедитесь, что вы понимаете что подписываете».

### 5.4 `eth_signTypedData_v4` — детали

```
params: [address, jsonTypedData]
```

`jsonTypedData` — EIP-712 структура: `{ domain, types, primaryType, message }`.

SW:

1. Парсит JSON.
2. Проверяет `domain.chainId === currentChainId`. Несоответствие → показать **красный** warning в popup (это частый фишинг: подпись order'а для чужой сети).
3. Валидирует `primaryType` и `types` (есть все ссылающиеся типы).
4. Popup approval → `wallet.signTypedData(domain, types, message)` из ethers v6.
5. Возвращает signature.

**Критично:** показывать в popup'е **распарсенные поля**, не raw JSON. Фишеры прячут важные поля (amounts, recipient) в глубине структуры.

---

## 6. Безопасность

### 6.1 Модель угроз

| Угроза                                                                | Смягчение                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Злой dApp запрашивает подпись без ведома пользователя**             | Каждое чувствительное действие → popup approval, таймер expiration |
| **Phishing: сайт выглядит как Uniswap**                               | Показывать полный domain + favicon, пользователь видит origin      |
| **Address poisoning в tx-to поле**                                    | First-time recipient warning (см. `RECOMMENDATIONS.md` §2.1.2)     |
| **Подпись typed data на чужой chainId**                               | Жёсткая проверка `domain.chainId === currentChainId`               |
| **Злой dApp читает `window.ethereum.request` у соседнего MetaMask'а** | `isMetaMask: false`, EIP-6963 registration под своим именем        |
| **Content script инжектит код SOVA в чужую страницу**                 | `content_scripts.all_frames: false` — не инжектим в iframe'ы       |
| **CSRF / замена origin'а**                                            | SW проверяет `sender.origin` в `chrome.runtime.onMessage`          |
| **Replay-атака: тот же request ID**                                   | Map `pendingRequests: Map<id, ...>`, удаление после ответа         |
| **Pending request висит вечно**                                       | TTL 60 секунд, автоматическое отклонение                           |
| **Approval popup закрыт без ответа**                                  | `window.onunload` → SW считает request rejected                    |

### 6.2 Проверка `sender.origin`

В SW `chrome.runtime.onMessage` handler'е:

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'dapp-request') {
    // sender.tab.url → верифицируем что origin совпадает с msg.origin
    const senderOrigin = new URL(sender.tab?.url || '').origin;
    if (senderOrigin !== msg.origin) {
      sendResponse({ id: msg.payload.id, error: { code: -32603, message: 'Origin mismatch' } });
      return;
    }
    handleDappRequest(msg, senderOrigin).then(sendResponse);
    return true;
  }
  // ... existing handlers
});
```

Это защита от спуфинга: content script в чужом origin'е не может подделать `msg.origin`.

### 6.3 Разделение по origin

`connectedOrigins[origin]` — строго isolated. `https://uniswap.org` не видит permission'ы `https://opensea.io`. Каждый `eth_requestAccounts` на новом origin → новый popup.

### 6.4 Permission revocation

В popup'е экран «Connected Sites»:

- Список всех origin'ов в `connectedOrigins`.
- Для каждого: favicon, domain, подключённые адреса, когда подключён.
- Кнопка «Disconnect» для каждого → удаление из storage + broadcast `disconnect` event.
- Кнопка «Disconnect all».

### 6.5 Audit log (см. `RECOMMENDATIONS.md` §2.1.4)

Каждый dApp-запрос логируется:

```
{ timestamp, origin, method, result: 'approved' | 'rejected', hash? }
```

Это даёт пользователю историю: «какой сайт когда что запрашивал».

### 6.6 Phishing prevention

Первая итерация содержит минимум:

- Явный показ origin'а + favicon.
- Warning на chainId mismatch.
- Warning на first-time recipient.

Вторая итерация может добавить:

- Phishing blocklist (например, список из eth-phishing-detect).
- `domain.verifyingContract` lookup против известных протоколов (Uniswap, Aave, Compound).
- Simulation (через Tenderly/Anvil) — показать «что реально произойдёт».

---

## 7. Новые файлы

```
extension/
├── content/
│   └── content-script.js       # NEW (~150 строк)
├── inpage/
│   └── provider.js              # NEW (~300 строк)
├── popup/
│   ├── modules/
│   │   └── dapp-approval.js     # NEW (~200 строк) — обработка approval экранов
│   ├── popup.html               # ИЗМЕНЕНО — добавлен <section id="dapp-approval-screen">
│   ├── popup.css                # ИЗМЕНЕНО — стили approval UI
│   └── popup.js                 # ИЗМЕНЕНО — маршрутизация по ?request=ID
├── background/
│   └── service-worker.js        # ИЗМЕНЕНО — новые message types
└── manifest.json                # ИЗМЕНЕНО — см. §4

site/
└── dapp-demo.html               # NEW — демо-страница (см. §8)
```

---

## 8. Демо-страница `site/dapp-demo.html`

### 8.1 Цель

Реализовать **минимальный полноценный dApp** для:

1. Демонстрации «вот так SOVA подключается к сайту».
2. Тестирования всех EIP-1193 методов вручную.
3. Регрессионного тестирования после релизов (Playwright-скрипт может кликать кнопки).
4. Обучения — любой новый разработчик открывает эту страницу и видит, как всё работает.

### 8.2 Структура страницы

**Блоки:**

1. **Header:** SOVA logo + заголовок «SOVA Wallet Demo dApp».
2. **Status bar:** текущий адрес, chainId, network badge (Sepolia / Mainnet / BSC), баланс — обновляется после подключения.
3. **Connect block:**
   - Кнопка «Connect SOVA Wallet» (disabled если `window.ethereum` нет).
   - Warning «SOVA Wallet not detected. Install the extension first.» (ссылка на `/assets/wolf-wallet-extension.zip`).
   - После подключения: кнопка «Disconnect».
4. **Read-only actions:**
   - «Get Block Number» → вызывает `eth_blockNumber`, показывает результат.
   - «Get Balance» → вызывает `eth_getBalance(address, 'latest')`, показывает результат в ETH.
   - «Get Chain ID» → вызывает `eth_chainId`.
5. **Send transaction block:**
   - Input: recipient address.
   - Input: amount ETH (default 0.0001).
   - Кнопка «Send ETH» → `eth_sendTransaction`.
   - Показ результата: tx hash + ссылка на Sepolia Etherscan.
6. **Sign message block:**
   - Textarea для сообщения (default: `"Hello SOVA!"`).
   - Кнопка «Sign Message» → `personal_sign`.
   - Показ подписи + кнопка «Verify» (локальная верификация через ethers.js).
7. **Sign typed data block:**
   - Preset: пример EIP-712 структуры (domain Sepolia chainId 11155111, простой Order type).
   - Кнопка «Sign Typed Data» → `eth_signTypedData_v4`.
   - Показ подписи.
8. **Events log:**
   - Список всех эмитированных событий (`accountsChanged`, `chainChanged`, `connect`, `disconnect`).
   - Timestamp + payload.
9. **Raw JSON-RPC playground (для продвинутых):**
   - Textarea для произвольного JSON-RPC payload'а.
   - Кнопка «Send» → `window.ethereum.request(JSON.parse(...))`.
   - Результат в `<pre>`.

### 8.3 Техническая реализация страницы

- **Без фреймворков.** Ванильный HTML + ES modules из CDN.
- **ethers.js v6** через `<script type="module">` import `https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.min.js` — для локальной верификации подписей и форматирования balance.
- **Styles:** тот же подход что и `site/index.html` — Tailwind CDN + IBM Plex Mono.
- **i18n:** двуязычный (RU/EN), та же система `data-lang` + `translations` как в index.html.

### 8.4 Регрессионное тестирование

В `tests/e2e/` добавить `dapp-demo.spec.js`:

```
- spin up playwright browser с загруженным SOVA extension
- открыть http://127.0.0.1:5173/dapp-demo.html
- проверить window.ethereum.isSova === true
- кликнуть Connect → автоматически принять approval в popup'е
- проверить что адрес появился в status bar
- кликнуть Get Balance → проверить что число появилось
- кликнуть Send ETH (на тестовый адрес, 0.0001) → автоматически принять approval → проверить tx hash
- кликнуть Sign Message → автоматически принять → локально верифицировать подпись
- кликнуть Disconnect → проверить что window.ethereum.request({method:'eth_accounts'}) возвращает []
```

Это покрывает все критические пути за один прогон.

### 8.5 Как запускать

```bash
npm run site:dev        # поднимает site/server.mjs на 5173
# открыть http://127.0.0.1:5173/dapp-demo.html
```

Чтобы `window.ethereum` был доступен на localhost:

- `manifest.content_scripts.matches` должен включать `http://localhost/*` и `http://127.0.0.1/*` (см. §4.2).

### 8.6 Ссылка с лендинга

В `site/index.html` добавить в секцию How It Works четвёртый шаг или отдельную кнопку в hero:

- «Try the demo dApp» → `dapp-demo.html`.
- Визуально выделить как «Interactive demo».

---

## 9. Фазы разработки

### Фаза 1 — инфраструктура (базовый каркас)

**Задачи:**

1. Создать `extension/inpage/provider.js` с заглушкой `SovaProvider` (request возвращает `{ error: 'not implemented' }`).
2. Создать `extension/content/content-script.js` с инжекцией + форвард сообщений.
3. Обновить `manifest.json` (content_scripts, web_accessible_resources, permissions).
4. В SW добавить handler `dapp-request` с заглушкой.
5. Создать `site/dapp-demo.html` с минимальным UI (только Connect + Status).
6. Проверить вручную: открыть демо-страницу → `window.ethereum.isSova === true` → `window.ethereum.request({method:'eth_chainId'})` возвращает `'0xaa36a7'` (Sepolia).

**Критерий готовности:** inpage провайдер существует, `eth_chainId` и `eth_blockNumber` работают без popup approval'а.

### Фаза 2 — connection flow

**Задачи:**

1. Добавить `eth_requestAccounts` handler в SW.
2. Реализовать открытие popup'а из SW (через `chrome.windows.create` — mini window).
3. Новый экран `dapp-approval-screen` с approval UI.
4. Сохранение `connectedOrigins`.
5. Эмит `connect` / `accountsChanged` events.
6. В демо-странице — рабочий Connect / Disconnect flow.

**Критерий готовности:** можно кликнуть Connect на `dapp-demo.html`, popup показывается, после Accept адрес отображается на демо-странице, после Disconnect адрес исчезает и вызов `eth_accounts` возвращает `[]`.

### Фаза 3 — signing methods

**Задачи:**

1. `personal_sign` handler в SW + popup approval для сообщений.
2. `eth_signTypedData_v4` handler + popup approval для typed data.
3. Warning'и: chainId mismatch, hash-like message.
4. В демо-странице — блоки Sign Message и Sign Typed Data с локальной верификацией.

**Критерий готовности:** подписи работают, валидируются локально через `ethers.verifyMessage` / `ethers.verifyTypedData`, warning'и показываются на подозрительных данных.

### Фаза 4 — transaction sending

**Задачи:**

1. `eth_sendTransaction` handler в SW.
2. Popup approval с gas estimate, total, raw data expand.
3. Интеграция с существующим `send-flow.js` (переиспользование confirmation UI).
4. First-time recipient warning.
5. Broadcast tx через SW (используя существующую логику).
6. В демо-странице — Send ETH блок.

**Критерий готовности:** можно отправить 0.0001 Sepolia ETH с демо-страницы, popup показывает корректные данные, tx hash возвращается, виден в Sepolia Etherscan.

### Фаза 5 — events и permissions

**Задачи:**

1. `chainChanged` broadcast при переключении сети в popup'е.
2. `accountsChanged` broadcast при переключении аккаунта.
3. Экран Connected Sites в popup'е (список + disconnect).
4. `wallet_getPermissions` handler.
5. Audit log записей.

**Критерий готовности:** в демо-странице при смене сети в popup'е автоматически обновляется status bar (chainId change).

### Фаза 6 — тесты и полировка

**Задачи:**

1. E2E тест `tests/e2e/dapp-demo.spec.js` (см. §8.4).
2. Unit тесты для `eth_requestAccounts` state machine.
3. Integration тесты для origin validation.
4. Fuzz-тесты для typed data parser'а.
5. Проверка CSP не ломается (inpage не нарушает CSP dApp'а).
6. Тест на Uniswap / Aave (реальные mainnet dApp'ы) в headless mode — только Connect, без реальных транзакций.

**Критерий готовности:** 15+ новых тестов, 0 регрессий, демо-страница проходит в CI.

### Фаза 7 — документация и публикация

**Задачи:**

1. Обновить `DOCUMENTATION.md` §12 — убрать пункт «нет dApp-коннекта».
2. Добавить секцию в `DOCUMENTATION.md` — «dApp integration guide для разработчиков».
3. Обновить лендинг с ссылкой на демо.
4. Changelog entry.
5. Bump version в `manifest.json` до 1.1.0.

---

## 10. План тестирования

### 10.1 Unit tests (новые)

- `inpage-provider.test.js` — `SovaProvider` API surface, `request` routing, `on` event emission.
- `content-script.test.js` — message forwarding, source filtering.
- `dapp-request-handler.test.js` — SW routing по `method`, origin validation, permission checks.
- `typed-data-parser.test.js` — EIP-712 parsing, edge cases (missing domain, extra types, `verifyingContract` nullable).

### 10.2 Integration tests

- `dapp-connect.test.js` — полный flow: request → approval → storage update → `eth_accounts` возвращает адрес.
- `dapp-disconnect.test.js` — удаление из `connectedOrigins` → `eth_accounts` возвращает `[]` → event `disconnect` эмитится.
- `dapp-origin-isolation.test.js` — два разных origin'а не видят permission'ы друг друга.
- `dapp-lock-during-request.test.js` — если SW залочен во время pending request → request отклоняется с `{code: 4100}`.

### 10.3 E2E tests

- `dapp-demo.spec.js` — полный сценарий на демо-странице (см. §8.4).
- `dapp-real-world.spec.js` — против `https://app.uniswap.org` в headless mode:
  - только Connect,
  - проверка что Uniswap видит SOVA как провайдер,
  - проверка что `eth_accounts` работает.
  - **БЕЗ** реальных транзакций.

### 10.4 Security tests

- Попытка spoofing origin'а в `chrome.runtime.sendMessage`.
- Inject inpage в iframe (должен быть заблокирован `all_frames: false`).
- Pending request TTL (должен отклоняться через 60 сек).
- Replay того же request ID (второй вызов должен быть проигнорирован).

---

## 11. Метрики успеха

После реализации:

- [ ] `window.ethereum` доступен на любом `https://*` сайте.
- [ ] SOVA видна в EIP-6963 wallet selector (если dApp поддерживает).
- [ ] Demo-страница проходит все 7 блоков без ошибок.
- [ ] Uniswap распознаёт SOVA и позволяет connect'нуться.
- [ ] Время отклика `eth_blockNumber`: p95 < 500ms.
- [ ] Время от клика Connect до открытия popup'а: p95 < 200ms.
- [ ] Нет регрессий в существующих 36 тестах.
- [ ] Baseline метрики popup'а не ухудшились более чем на 10%.
- [ ] 20+ новых тестов проходят зелёно.
- [ ] `RECOMMENDATIONS.md` §2.1.2 (first-time recipient warning) внедрено как часть dApp approval UI.

---

## 12. Открытые вопросы / решения

| #   | Вопрос                                                                     | Возможные варианты                                                                    | Предпочтение                                                         |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Как открывать approval popup из SW?                                        | `chrome.action.openPopup` (нужен user gesture) / `chrome.windows.create` (независимо) | `chrome.windows.create` — более надёжно                              |
| 2   | Хранить `connectedOrigins` в local или session?                            | `local` (персистентно) / `session` (per-session)                                      | `local` — стандарт MetaMask; пользователь может явно disconnect'нуть |
| 3   | Требовать password re-auth на `eth_sendTransaction` с dApp'а?              | Всегда / только mainnet / никогда                                                     | Только mainnet — согласуется с `RECOMMENDATIONS.md` §2.1.1           |
| 4   | Поддержать `wallet_addEthereumChain`?                                      | В фазе 1 / в фазе 7 / отдельный проект                                                | Фаза 7 или отложить — это целая подсистема управления сетями         |
| 5   | Логировать ли raw RPC payload'ы в audit log?                               | Да / только методы без параметров / только нерезолвленные                             | Только method + origin + результат, без params (приватность)         |
| 6   | Что делать с `eth_sign`?                                                   | Deprecated но бывает нужен / Всегда отклонять                                         | Всегда отклонять с чётким error message                              |
| 7   | Показывать ли favicon в approval UI?                                       | Fetch через fetch API / `chrome.tabs.query.favIconUrl`                                | `chrome.tabs.query.favIconUrl` — уже у нас в permission              |
| 8   | Поддерживать ли несколько подключённых аккаунтов одновременно?             | Один активный / Массив разрешённых                                                    | Массив — как в MetaMask                                              |
| 9   | Что при disconnect: удалять всю историю отношений или оставлять audit log? | Удалять / Оставлять                                                                   | Оставлять audit log, но отметить origin как disconnected             |
| 10  | Как инсталлируется demo-страница вместе с расширением?                     | Отдельная вкладка / Ссылка в popup'е / Только на лендинге                             | Только на лендинге + кнопка «Try Demo» на welcome экране popup'а     |

Перед началом Фазы 2 рекомендуется явно зафиксировать ответы на вопросы 1–3; остальные можно решать по ходу.

---

## 13. Зависимости от других рекомендаций

Этот план **выигрывает** от одновременной реализации нескольких пунктов из `RECOMMENDATIONS.md`:

| Пункт                               | Как помогает                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| §2.1.1 password re-auth             | Естественно встраивается в approval UI для `eth_sendTransaction` на mainnet                  |
| §2.1.2 first-time recipient warning | Прямо используется в approval UI для `eth_sendTransaction`                                   |
| §2.1.4 audit log                    | Регистрирует все dApp-взаимодействия                                                         |
| §2.2 убрать Alchemy key из кода     | Критично: после публикации dApp-коннекта расширение попадёт в Chrome Web Store — ключ утечёт |
| §3.1 декомпозиция popup.js          | Новый модуль `dapp-approval.js` не сможет безопасно интегрироваться в 2165-строчный popup.js |
| §3.2 убрать fallback chains         | Упростит добавление новых типов сообщений в SW                                               |
| §5.2 CI                             | Без CI каждая фаза будет ручной проверкой стабильности — слишком рискованно                  |

**Предлагаемый порядок:**

1. Сначала — §2.2 (Alchemy key) и §5.2 (CI) из `RECOMMENDATIONS.md`.
2. Параллельно — §3.2 (fallback chains).
3. Затем — Фаза 1 этого плана.
4. Параллельно с Фазой 2–4 — §2.1.2 (recipient warning) и §2.1.4 (audit log).
5. Фазы 5–7 этого плана.

---

## 14. Риски и митигации

| Риск                                              | Вероятность | Воздействие | Митигация                                                                                   |
| ------------------------------------------------- | ----------- | ----------- | ------------------------------------------------------------------------------------------- |
| Conflict с MetaMask (`window.ethereum` уже занят) | Высокая     | Средний     | EIP-6963 discovery + условная инжекция, не перезаписываем                                   |
| Popup не открывается вовремя → dApp timeout       | Средняя     | Высокий     | `chrome.windows.create` вместо openPopup; явный TTL 60 сек                                  |
| SW убит Chrome'ом → pending request теряется      | Средняя     | Средний     | Persist pending requests в `chrome.storage.session`; restore при рестарте SW                |
| Phishing через typed data                         | Высокая     | Критический | Жёсткие проверки chainId, visual warnings, parsed view вместо raw JSON                      |
| Performance regression popup'а                    | Низкая      | Средний     | Baseline gate в CI (см. `RECOMMENDATIONS.md` §5.2)                                          |
| Nonce race condition при параллельных dApp'ах     | Низкая      | Высокий     | SW сериализует `eth_sendTransaction` через очередь per-address                              |
| Utility / breakage на реальных dApp'ах            | Средняя     | Высокий     | Реальное тестирование на 5+ популярных dApp (Uniswap, OpenSea, Aave, ENS, 1inch) до релиза  |
| CSP violation в dApp'е из-за наших сообщений      | Низкая      | Средний     | Используем `window.postMessage` (не inline script), `origin === '*'` уходит после валидации |
| EIP-6963 не поддержан старыми dApp'ами            | Высокая     | Низкий      | Fallback: также инжектим в `window.ethereum` (если пусто)                                   |
| Пользователь не понимает «что такое connect»      | Высокая     | Низкий      | В popup approval подробное объяснение + ссылка на help                                      |

---

## 15. Расширенный roadmap (после базовой реализации)

После того как базовый dApp-коннект работает, следующие улучшения по приоритетам:

1. **`wallet_switchEthereumChain` / `wallet_addEthereumChain`** — dApp может запросить переключение на свою сеть.
2. **Transaction simulation** — показать «что реально изменится» до подписи (через eth_call + state override).
3. **Phishing blocklist** — локальная база известных фишинг-доменов.
4. **Multi-account selection per dApp** — пользователь может дать одному dApp'у один аккаунт, другому — другой.
5. **Token approval management** — отдельный UI для `approve(spender, amount)` с предупреждениями о unlimited approvals.
6. **EIP-4337 account abstraction** — поддержка smart account'ов как альтернативы EOA.
7. **Multi-chain одновременно** — dApp может запросить операции на разных сетях без ручного переключения.
8. **WalletConnect v2** — параллельный канал для мобильных dApp'ов.

---

## 16. Итого

Этот план превращает SOVA Wallet из «изолированного инструмента для ручных переводов» в полноценный Web3 wallet, совместимый со всей экосистемой EVM-dApp'ов.

**Критический путь:**

1. Устранить блокеры из `RECOMMENDATIONS.md` (Alchemy key, CI, fallback cleanup).
2. Реализовать Фазы 1–4 dApp-коннекта.
3. Задеплоить демо-страницу.
4. Тестирование на реальных dApp'ах.
5. Релиз 1.1.0.

**Ключевые файлы для создания:**

- `extension/inpage/provider.js`
- `extension/content/content-script.js`
- `extension/popup/modules/dapp-approval.js`
- `site/dapp-demo.html`
- `tests/e2e/dapp-demo.spec.js`

**Ключевые файлы для модификации:**

- `extension/manifest.json` (разрешения + content scripts)
- `extension/background/service-worker.js` (новые message types)
- `extension/popup/popup.html` (+ `dapp-approval-screen`)
- `extension/popup/popup.js` (маршрутизация `?request=ID`)

Вся работа выполняется на основе существующей архитектуры и не требует переписывания текущего функционала. Приватный ключ по-прежнему остаётся только в service worker'е — dApp-коннект добавляется как **дополнительный слой на периметре**, не затрагивая core crypto.

---

_План ожидает обсуждения с командой перед началом Фазы 1. Последнее обновление — 2026-04-07._
