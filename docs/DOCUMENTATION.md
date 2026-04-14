# SOVA Wallet — Техническая документация проекта

Версия документа: 1.1
Дата: 2026-04-08
Основана на: анализе исходного кода, существующих .md-файлов, incident-report от 2026-03-29 и отчётах по оптимизации/тестированию.

Документ заменяет и расширяет минимальный `README.md` и объединяет разрозненные заметки (`extension_changes_since_backup.md`, `extension/optimization-plan.md`, `tests/test-report.md`, `tests/test-plan-2.md`) в единую карту проекта.

> **Что нового в версии 1.1:** реализован полный dApp-коннект (EIP-1193 + EIP-6963), добавлены `content/content-script.js`, `inpage/provider.js`, `popup/modules/dapp-approval.js` и демо-страница `site/dapp-demo.html`. Версия расширения поднята до **1.1.0**. Подробности в новой секции 16.

---

## 1. Обзор проекта

**SOVA Wallet** — некастодиальное Chrome-расширение (Manifest V3) для работы с Ethereum и BNB Chain. Проект позиционируется как российское решение для самостоятельного хранения криптоактивов без серверной части и без передачи данных наружу.

| Параметр            | Значение                                               |
| ------------------- | ------------------------------------------------------ |
| Название            | SOVA Wallet (в package.json — `wolf-wallet-extension`) |
| Версия расширения   | 1.1.0 (manifest)                                       |
| Статус              | Beta (на лендинге) · production-ready кодовая база     |
| Дефолтная сеть      | `eth-sepolia` (testnet)                                |
| Поддерживаемые сети | Ethereum Mainnet, Ethereum Sepolia, BNB Chain          |
| Manifest            | V3                                                     |
| Ключевая библиотека | ethers.js v6 (UMD)                                     |
| UI                  | Ванильный HTML/JS, без фреймворков                     |
| Язык UI             | Русский                                                |
| Репозиторий         | MMals1/SOVA                                            |

**Структура верхнего уровня:**

```
wallet/
├── extension/              # Production-расширение (MV3)
│   ├── background/         # service worker (sign + dApp dispatch)
│   ├── content/            # content-script для dApp bridge (NEW v1.1)
│   ├── inpage/             # EIP-1193 provider, инжектится в страницы (NEW v1.1)
│   ├── popup/              # UI расширения (включая dapp-approval)
│   ├── shared/             # общие модули (networks, wallet-core)
│   ├── libs/               # ethers.js v6 UMD
│   └── icons/              # иконки расширения
├── site/                   # Лендинг + dapp-demo (статический сервер)
├── tests/                  # unit / integration / e2e
├── security-incidents/     # incident response docs
├── study/                  # референсные материалы
├── README.md               # минимальный (см. этот файл как основной)
├── DAPP-CONNECT-PLAN.md    # план реализации dApp-коннекта (выполнен)
├── RECOMMENDATIONS.md      # рекомендации по проекту
├── package.json            # test + build scripts
└── playwright.config.js    # e2e runner
```

---

## 2. Архитектура расширения

### 2.1 Слоевая модель

Расширение построено на MV3-модели с **тремя** изолированными контекстами после v1.1:

```
┌──────────────────────┐    window.postMessage    ┌────────────────────┐
│  dApp web page       │ ─────────────────────▶  │  inpage/provider   │
│  (Uniswap, OpenSea…) │                          │  EIP-1193 + 6963   │
│  window.ethereum     │ ◀─────────────────────  │  MAIN world        │
└──────────────────────┘                          └────────────────────┘
                                                            │ window.postMessage
                                                            ▼
                                                  ┌────────────────────┐
                                                  │  content-script    │
                                                  │  ISOLATED world    │
                                                  │  bridge            │
                                                  └────────────────────┘
                                                            │ chrome.runtime.sendMessage
                                                            ▼
┌─────────────────────────────────┐   chrome.runtime.sendMessage   ┌──────────────────────────────────┐
│   POPUP (UI, без приватного     │ ───────────────────────────▶  │   SERVICE WORKER                  │
│   ключа)                         │                                │   (единственное место где        │
│                                  │ ◀───────────────────────────  │    живёт расшифрованный ключ)    │
│   popup/popup.html               │      ответ (hash, ok)          │   background/service-worker.js    │
│   popup/popup.js + modules/      │                                │                                  │
│   shared/networks.js             │     dapp-approval-response     │   • EIP-1193 dispatcher           │
│   shared/wallet-core.js          │                                │   • connectedOrigins              │
│   modules/dapp-approval.js       │                                │   • broadcast accountsChanged     │
│   (approval UI for dApps)        │                                │   • broadcast chainChanged        │
│                                  │                                │   chrome.storage.local/session    │
│                                  │                                │   chrome.alarms (auto-lock 5 мин) │
└─────────────────────────────────┘                                └──────────────────────────────────┘
                                                                                │
                                                                                ▼
                                                                    ┌──────────────────────────────────┐
                                                                    │   RPC провайдеры (HTTPS only)    │
                                                                    │   Alchemy / Infura / Publicnode  │
                                                                    └──────────────────────────────────┘
```

**Критическое свойство:** ни popup, ни inpage, ни content-script **никогда** не получают доступ к приватному ключу. Все операции подписи (`send-eth`, `send-erc20`, `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction`) выполняются в service worker, который возвращает только результат (hash / signature).

> **dApp-коннект (новое в v1.1):** манифест содержит `content_scripts` (`document_start`, `world: "ISOLATED"`, `all_frames: false`), `web_accessible_resources` для `inpage/provider.js` и расширенные `host_permissions` для `https://*/*`. Полное описание — секция 16. План был задокументирован в `DAPP-CONNECT-PLAN.md` и реализован полностью.

### 2.2 Размеры и hot-spots

| Файл                                       | Строк | Роль                                       |
| ------------------------------------------ | ----: | ------------------------------------------ |
| `extension/popup/popup.js`                 |  2165 | Главный контроллер popup, bootstrap, кэши  |
| `extension/popup/modules/tx-history.js`    |   414 | История транзакций (Alchemy) + пагинация   |
| `extension/popup/modules/network-state.js` |   363 | Сети, RPC, guards                          |
| `extension/popup/modules/send-flow.js`     |   335 | Send flow ETH + ERC-20                     |
| `extension/popup/modules/token-state.js`   |   325 | Управление ERC-20 списком                  |
| `extension/popup/popup.html`               |   308 | UI разметка (8 экранов)                    |
| `extension/background/service-worker.js`   |   238 | Unlock / lock / sign / lockout             |
| `extension/popup/modules/avatar.js`        |   171 | Детерминированные SVG-аватары              |
| `extension/popup/modules/ui-templates.js`  |   114 | Рендер network-picker'ов и feedback        |
| `extension/shared/wallet-core.js`          |   103 | Утилиты (format, scope key, пагинация)     |
| `extension/popup/modules/event-binder.js`  |    63 | Declarative event binding (`data-onclick`) |
| `extension/shared/networks.js`             |    56 | Факторика network config                   |
| `extension/popup/modules/ui-state.js`      |    53 | Навигация экранов/табов                    |
| `extension/manifest.json`                  |    46 | Конфиг MV3                                 |
| `extension/popup/modules/ui-messages.js`   |    41 | Error/status/success рендер                |

> `popup.js` остаётся самым крупным файлом несмотря на декомпозицию — это главный кандидат на продолжение рефакторинга (см. `RECOMMENDATIONS.md` §3).

### 2.3 Порядок загрузки скриптов

`popup/popup.html` загружает скрипты строго в следующем порядке (изменение порядка ломает инициализацию):

1. `libs/ethers.umd.min.js`
2. `network-config.js` (RPC overrides → `globalThis.WOLF_WALLET_RPC_DEFAULTS`)
3. `shared/wallet-core.js` (утилиты → `WolfWalletCore`)
4. `shared/networks.js` (networks factory → `WolfWalletNetworks`)
5. `popup/modules/*.js` в порядке зависимостей:
   `storage → ui-messages → avatar → clipboard → ui-templates → popup-state → network-state → tx-history → token-state → send-flow → ui-state → event-binder`
6. `popup/popup.js` (главный контроллер)

Service worker подключает свои скрипты через `importScripts()`: `libs/ethers.umd.min.js`, `network-config.js`, `shared/networks.js`.

---

## 3. Service Worker — контракт сообщений

Весь IPC между popup и SW идёт через `chrome.runtime.sendMessage({ type, ...payload })`. SW отвечает `{ ok: true, ...result }` или `{ ok: false, error }`.

| `type`               | Параметры                                | Результат                      | Назначение                                                                        |
| -------------------- | ---------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `unlock`             | `{ accountIndex, password }`             | `{}`                           | Расшифровать keystore, сохранить в памяти SW, включить alarm автоблокировки       |
| `lock`               | —                                        | `{}`                           | Очистить `_walletsByAddress`, session-storage, alarm                              |
| `activate-account`   | `{ accountIndex }`                       | `{ activated, address }`       | Переключить активный аккаунт без повторного пароля (если он уже разблокирован)    |
| `send-eth`           | `{ to, amount }`                         | `{ hash }`                     | Подписать и отправить ETH-транзакцию                                              |
| `send-erc20`         | `{ to, tokenAddress, amount, decimals }` | `{ hash }`                     | Подписать ERC-20 `transfer()`                                                     |
| `add-sub-account`    | `{ password }`                           | `{ address, keystore, index }` | Derive следующего субаккаунта из мнемоники главного аккаунта (`m/44'/60'/0'/0/N`) |
| `reset-lock-timer`   | —                                        | `{}`                           | Продлить auto-lock (вызывается при активности)                                    |
| `get-wallet-address` | —                                        | `{ address }`                  | Возвращает адрес активного разблокированного аккаунта (или `null`)                |

**Edge cases:**

- `unlock` при `Date.now() < _lockoutUntil` → ошибка `Подождите N сек` (локаут 3+ неудач, экспонента до 60 с).
- `send-*` без активного кошелька → ошибка `locked` (popup должен показать unlock).
- `add-sub-account` при отсутствии мнемоники в главном keystore → ошибка (импортированные по приватному ключу аккаунты не поддерживают субаккаунты).

**Gas estimation:** для `send-eth` SW вызывает `provider.estimateGas(txRequest)` и добавляет 20% запаса (`estimated * 120n / 100n`). Для ERC-20 лимит определяется внутри `contract.transfer(...)` в ethers.

---

## 4. Модель хранения

### 4.1 `chrome.storage.local` (персистентно)

| Ключ                                     | Тип                                    | Описание                                                      |
| ---------------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| `accounts`                               | `Array<{ address, keystore, name }>`   | Зашифрованные keystore'ы (scrypt + AES-128-CTR, ethers v6)    |
| `activeAccount`                          | `number`                               | Индекс текущего аккаунта                                      |
| `selectedChain`                          | `string`                               | `"ethereum"` / `"bsc"`                                        |
| `selectedNetwork`                        | `string`                               | `"eth-mainnet"` / `"eth-sepolia"` / `"bsc"`                   |
| `rpcByNetwork`                           | `{ [networkKey]: rpcUrl }`             | Переопределения RPC на сеть (whitelisted hosts)               |
| `tokensByNetwork`                        | `{ [networkKey]: Token[] }`            | Список ERC-20 на сеть (`{ address, symbol, decimals, name }`) |
| `txHistoryCache`                         | `{ [scopeKey]: Transfer[] }`           | Кэш истории, scope = `${networkKey}:${address.toLowerCase()}` |
| `txSyncState`                            | `{ [scopeKey]: timestamp }`            | Когда последний раз синхронизировали историю                  |
| `txPaginationState`                      | `{ [scopeKey]: { page, totalCount } }` | Состояние пагинации                                           |
| `mainnetSendGuardAccepted:${networkKey}` | `boolean`                              | Подтверждение «первой отправки на мейннет» (на сеть)          |
| `rpcUrl` (legacy)                        | `string`                               | Переносится в `rpcByNetwork` при миграции                     |
| `keystore`, `address`, `tokens` (legacy) | —                                      | Миграция в новый формат при старте popup                      |

### 4.2 `chrome.storage.session` (volatile)

| Ключ         | Описание                                      |
| ------------ | --------------------------------------------- |
| `unlocked`   | `true` если в SW есть разблокированный wallet |
| `unlockTime` | Таймстамп unlock (для проверки истечения)     |

Session storage очищается:

- вручную при `lock`,
- автоматически при срабатывании alarm `auto-lock` (5 минут бездействия),
- при перезапуске браузера.

### 4.3 Шифрование

- **KDF:** scrypt (через `ethers.Wallet.encrypt(password)`).
- **Шифр:** AES-128-CTR (стандартный Web3 keystore v3).
- **Мнемоника:** сохраняется только внутри keystore главного аккаунта. `_pendingMnemonic` в popup'е живёт только во время показа/проверки (quiz экран) и очищается сразу после.
- **Пароль:** валидация 8+ символов, минимум одна заглавная, строчная и цифра.

### 4.4 Миграции

`popup.js` при старте выполняет мягкую миграцию нескольких legacy-форматов:

- одиночный `keystore`/`address` → массив `accounts`,
- одиночный `rpcUrl` → `rpcByNetwork['eth-sepolia']`,
- плоский `tokens` → `tokensByNetwork['eth-sepolia']`,
- старый глобальный `mainnetSendGuard` → `mainnetSendGuardAccepted:${networkKey}`.

---

## 5. Сети и RPC

### 5.1 Поддерживаемые сети

Определены в `extension/shared/networks.js` (`BASE_NETWORKS`):

| Ключ          |  chainId | Label            | testnet | default RPC (fallback)                |
| ------------- | -------: | ---------------- | ------- | ------------------------------------- |
| `eth-mainnet` |        1 | Ethereum Mainnet | false   | `ethereum-rpc.publicnode.com`         |
| `eth-sepolia` | 11155111 | Ethereum Sepolia | true    | `ethereum-sepolia-rpc.publicnode.com` |
| `bsc`         |       56 | BNB Chain        | false   | `bsc-rpc.publicnode.com`              |

Factory `getNetworkConfigs(rpcDefaults)` перекрывает `defaultRpcUrl` значениями из `WOLF_WALLET_RPC_DEFAULTS` (задаются в `network-config.js`). После security-fix Phase 1 (P1-1) дефолтные эндпойнты — публичный publicnode (бесплатный, без API key). Пользователь может ввести свой Alchemy/Infura/etc. ключ через popup setup screen, тогда custom RPC сохраняется в `chrome.storage.local.rpcByNetwork[networkKey]`.

### 5.2 Whitelist RPC-хостов

`popup/modules/network-state.js` принимает пользовательский RPC только если URL начинается с `https://` и хост находится в `ALLOWED_RPC_HOSTS`:

```
*.g.alchemy.com, *.infura.io, *.quiknode.pro,
*.publicnode.com, *.drpc.org, *.llamarpc.com,
*.ankr.com, *.chainstack.com, *.1rpc.io
```

Эти же хосты перечислены в `host_permissions` и `connect-src` CSP манифеста. Любой другой host будет отклонён ещё до попытки запроса.

### 5.3 Provider pooling

`popup.js` держит `_providerCache: Map<rpcUrl, JsonRpcProvider>` с LRU-вытеснением при > 6 инстансов. Функция `getOrCreatePopupProvider(rpcUrl)` переиспользует уже созданный провайдер вместо инстанцирования на каждый RPC-запрос. Это снизило число созданий провайдера до ≈1 на URL (см. `extension/optimization-plan.md`, Этап 3).

### 5.4 Mainnet send guard

При первой отправке на `eth-mainnet` или `bsc` popup показывает диалог подтверждения. Флаг `mainnetSendGuardAccepted:${networkKey}` сохраняется в `chrome.storage.local` → повторное подтверждение не требуется для той же сети. Ключи на сеть, миграция со старого глобального флага выполняется при старте.

### 5.5 История транзакций — ограничение

`tx-history.js` поддерживает **только Alchemy** (через `alchemy_getAssetTransfers`). Для любого не-Alchemy RPC история покажет заглушку «история недоступна». Это известное ограничение (см. `RECOMMENDATIONS.md` §4.2).

---

## 6. Popup-слой

### 6.1 Экраны (из `popup.html`)

| id                   | Назначение                                      |
| -------------------- | ----------------------------------------------- |
| `setup-screen`       | Выбор между «создать» и «импортировать»         |
| `mnemonic-screen`    | Показ сгенерированной мнемоники                 |
| `quiz-screen`        | Проверка мнемоники (3 случайных слова)          |
| `unlock-screen`      | Ввод пароля для разблокировки                   |
| `wallet-screen`      | Основной экран: баланс, токены, история, кнопки |
| `send-screen`        | Ввод получателя / суммы / выбор ассета          |
| `confirm-tx-screen`  | Предпросмотр перед подписью (gas, total)        |
| `add-token-screen`   | Добавление ERC-20 по адресу                     |
| `add-account-screen` | Создание субаккаунта                            |

### 6.2 Модули и ответственности

| Модуль                     | Глобаль                 | Ответственность                                                                                    |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------- |
| `modules/storage.js`       | `WolfPopupStorage`      | Promise-обёртки над `chrome.storage.local/session`                                                 |
| `modules/popup-state.js`   | `WolfPopupSharedState`  | Общий mutable state (`provider`, `selectedNetwork`, ...)                                           |
| `modules/ui-messages.js`   | `WolfPopupUiMessages`   | `showError/setStatus/showSuccess/setLoading`                                                       |
| `modules/ui-templates.js`  | `WolfPopupTemplates`    | `renderNetworkPicker`, `renderFeedbackMounts`                                                      |
| `modules/ui-state.js`      | `WolfPopupUiState`      | `showScreen`, `switchTab`, `switchWalletTab`                                                       |
| `modules/event-binder.js`  | `WolfPopupEventBinder`  | `bindDeclarativeHandlers` для `data-onclick` / `data-onchange` / `data-oninput` / `data-onkeydown` |
| `modules/clipboard.js`     | `WolfPopupClipboard`    | `copyText` с fallback на `execCommand`                                                             |
| `modules/avatar.js`        | `WolfPopupAvatar`       | SVG-аватары (Murmur3-подобный hash + gradient + 5×3 grid)                                          |
| `modules/network-state.js` | `WolfPopupNetworkState` | `setNetwork`, `getRpcUrlForNetwork`, mainnet guard                                                 |
| `modules/token-state.js`   | `WolfPopupTokenState`   | Чтение/запись `tokensByNetwork`, рендер списка токенов с балансами                                 |
| `modules/tx-history.js`    | `WolfPopupTxHistory`    | Alchemy transfers fetch, пагинация, рендер                                                         |
| `modules/send-flow.js`     | `WolfPopupSendFlow`     | Валидация, gas estimate, confirm, ошибки send                                                      |

### 6.3 Delegation pattern

`popup.js` использует паттерн «модуль или fallback»:

```js
const mod = globalThis.WolfPopupNetworkState;
if (mod && typeof mod.setNetwork === 'function') {
  await mod.setNetwork(key);
} else {
  // legacy fallback inside popup.js
}
```

Это даёт возможность безопасно вырезать/заменять модули, но приводит к дублированию логики и затрудняет чтение кода. Основная цель — к следующему рефактору удалить все fallback-пути (см. `RECOMMENDATIONS.md` §3.2).

### 6.4 Кэши в памяти popup'а

| Переменная         | Тип                            | Что кэширует                                                  |
| ------------------ | ------------------------------ | ------------------------------------------------------------- |
| `_accountsCache`   | `Array \| null`                | Результат последнего `chrome.storage.local.get(['accounts'])` |
| `_providerCache`   | `Map<rpcUrl, JsonRpcProvider>` | Пул провайдеров (LRU, max 6)                                  |
| `_pendingMnemonic` | `string \| null`               | Только во время setup/quiz                                    |
| `_pendingTx`       | `object \| null`               | Транзакция между send и confirm экранами                      |

После этапа 3 оптимизации количество чтений `chrome.storage.local` в hot-path рендера снизилось с 21+ до 2–3 за цикл.

---

## 7. Модель безопасности

### 7.1 Изоляция приватного ключа

- **Единственная точка хранения:** `_walletsByAddress: Map<address, ethers.Wallet>` внутри service worker (`service-worker.js:39`).
- **Popup доступа не имеет:** сериализация wallet'а в popup невозможна — IPC возвращает только хэши и ошибки.
- **Уничтожение:** при `lock`, срабатывании alarm `auto-lock` (5 минут бездействия) или смерти service worker'а.
- **Рестарт SW:** если браузер убил SW, `_walletsByAddress` исчезает, session-storage показывает «нет unlock» → popup ведёт на экран ввода пароля. Протестировано в `tests/e2e/resilience.spec.js`.

### 7.2 Anti-brute-force (unlock lockout)

В `service-worker.js:88-93`:

```
_failedAttempts++;
if (_failedAttempts >= 3) {
  _lockoutUntil = Date.now() + Math.min(60000, 5000 * (_failedAttempts - 2));
}
```

- 3 неудачи → 5 сек
- 4 неудачи → 10 сек
- ...
- cap = 60 сек

Счётчик сбрасывается после успешной расшифровки.

### 7.3 Валидация ввода

| Поле             | Правило                                        |
| ---------------- | ---------------------------------------------- |
| Адрес получателя | `ethers.isAddress()`                           |
| Сумма            | `parseFloat(v) > 0`, `!isNaN`                  |
| `decimals`       | `0 ≤ d ≤ 18`                                   |
| RPC URL          | `https://` + хост из `ALLOWED_RPC_HOSTS`       |
| Пароль           | длина ≥ 8, upper + lower + digit               |
| Мнемоника        | `ethers.Mnemonic.fromPhrase()` (BIP39)         |
| Network key      | проверяется против `NETWORKS` до использования |

### 7.4 CSP (Content Security Policy)

`manifest.json:44`:

```
default-src 'none';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src https://eth-sepolia.g.alchemy.com https://*.g.alchemy.com https://*.infura.io https://*.quiknode.pro https://*.publicnode.com https://*.drpc.org https://*.llamarpc.com https://*.ankr.com https://*.chainstack.com https://*.1rpc.io;
img-src 'self' https://raw.githubusercontent.com https://tokens.1inch.io https://tokens-data.1inch.io data:;
object-src 'none';
frame-ancestors 'none';
form-action 'none';
```

Это **жёсткая** CSP: inline JS запрещён (поэтому все обработчики идут через `data-onclick` + `event-binder.js`), `connect-src` перечисляет только разрешённые RPC-хосты + CDN логотипов токенов.

### 7.5 Инцидент 2026-03-29

**Подтверждённая кража реальных средств с mainnet.** См. `security-incidents/INC-2026-03-29-wallet-theft/incident-report.md`.

- Жертва: `0xAbDb2D1C02f0A2130bDD5731c9048bB386cD9B61`
- Атакующий: `0xeeeee90971B6264C53175D3Af6840a8dD5dc7b6C`
- Сумма: 0.000842337284761 ETH
- Txhash: `0xf0ee06d6aa87ff8e274937c731e1ba9beb4c3b01fc87e7e57db0c0701a3c4a42`
- Блок: `0x179de38`, timestamp `2026-03-29T14:52:35Z`

**Root cause (оценка):** компрометация приватного ключа/мнемоники/активной сессии **вне** UI расширения. Варианты: seed в clipboard manager / облачной заметке, infostealer на машине жертвы, вредоносное расширение, злоупотребление уже разблокированной сессией. Архитектура SOVA не содержит уязвимости, позволяющей вывести средства без ключа/сессии — но зависит от безопасности endpoint'а пользователя.

Рекомендации по харденингу продукта из `incident-report.md` §7 **пока не реализованы** (см. `RECOMMENDATIONS.md` §2).

---

## 8. Тестовое покрытие

### 8.1 Инструменты

- **Unit / Integration:** Vitest + jsdom (`package.json`, `vitest.config.js`)
- **E2E:** Playwright (`playwright.config.js`, `tests/e2e/helpers/popup-fixture.js`)

### 8.2 Команды

```bash
npm test              # = npm run test:unit
npm run test:unit     # vitest run (unit + integration)
npm run test:unit:watch
npm run test:e2e      # playwright test
npm run test:e2e:headed
npm run test:install-browsers
```

### 8.3 Стабильный baseline (по `optimization-plan.md`)

На 2026-03-29 зафиксировано: **36/36 тестов зелёные**:

- 20/20 unit + integration
- 13/13 e2e core (smoke, network-scope, unlock, send-eth, token-flow)
- 2/2 e2e resilience (RPC fail, SW wallet drop)
- 1/1 e2e baseline (перф-метрики)

### 8.4 Метрики baseline (5 итераций)

| Метрика                   |  Mean | Median |   Range |
| ------------------------- | ----: | -----: | ------: |
| `popupOpenMs`             | 269.0 |  247.0 | 169–462 |
| `walletRenderMs`          | 345.6 |  401.0 | 164–569 |
| `storage.local ops/cycle` |   2.2 |    3.0 |     1–3 |
| `rpc.totalCalls/cycle`    |   1.2 |    2.0 |     0–2 |

Эти значения — эталон для будущих изменений. Любая регрессия должна сравниваться с ними через `tests/e2e/perf-baseline.spec.js`.

### 8.5 Противоречие между документами

В репо есть два источника, расходящихся по статусу покрытия:

- `tests/TEST-IMPLEMENTATION-COMPLETE.md` заявляет **595+ тестов** и полное покрытие.
- `tests/test-plan-2.md` фиксирует **~55% покрытия** и перечисляет 15+ критических пробелов: service worker lifecycle, lockout, input validation, provider failures, BIP39 edge cases, CSP для event binding и т.д.
- `tests/test-report.md` отражает фактический прогон: 36 тестов (~20 unit/integration + 13 e2e + 3 дополнительных).

**Источник истины:** `test-report.md` + фактический запуск `npm test`. `TEST-IMPLEMENTATION-COMPLETE.md` представляет намерение (скаффолд), а не реализацию.

### 8.6 Структура каталога `tests/`

```
tests/
├── unit/                         # чистые функции, валидация, state
│   ├── popup-helpers.test.js
│   ├── network-state.test.js
│   ├── tx-pagination.test.js
│   ├── token-scope.test.js
│   ├── input-validation.test.js
│   ├── popup-state.test.js
│   ├── wallet-core-edge-cases.test.js
│   ├── service-worker-unlock.test.js
│   └── service-worker-network.test.js
├── integration/                  # popup ↔ SW, многокомпонентные
│   ├── popup-sw-session.test.js
│   ├── account-switch.test.js
│   ├── account-isolation.test.js
│   ├── rpc-fallback.test.js
│   └── unlock-session-lifecycle.test.js
└── e2e/                          # Playwright + mocked chrome API + mocked RPC
    ├── helpers/popup-fixture.js
    ├── smoke.spec.js
    ├── unlock.spec.js
    ├── unlock-lockout.spec.js
    ├── send-eth.spec.js
    ├── send-erc20.spec.js
    ├── network-scope.spec.js
    ├── network-rpc-guard.spec.js
    ├── token-flow.spec.js
    ├── history-pagination.spec.js
    ├── account-onboarding.spec.js
    ├── session-ui-security.spec.js
    ├── resilience.spec.js
    ├── error-resilience.spec.js
    ├── comprehensive-flows.spec.js
    └── perf-baseline.spec.js
```

---

## 9. Лендинг (`site/`)

Статический сайт, который отдаётся локальным Node.js сервером (`site/server.mjs`, порт 5173).

| Файл                                    | Назначение                                                              |
| --------------------------------------- | ----------------------------------------------------------------------- |
| `site/index.html`                       | Главная страница (двуязычная: RU/EN через `data-lang` + `translations`) |
| `site/generated-page.html`              | Исходник предыдущей итерации дизайна (RU)                               |
| `site/article1.html`, `article2.html`   | Статьи (манифест и контекст проекта)                                    |
| `site/server.mjs`                       | MIME-aware static server с path-traversal защитой                       |
| `site/assets/logo_new.png`              | Логотип (отсылается на главной и в шапке расширения)                    |
| `site/assets/wolf-wallet-extension.zip` | Распространяемый zip расширения                                         |
| `site/assets/*.pdf`                     | Статьи про криптоинфраструктуру (в assets)                              |

**Команды:**

```bash
npm run site:dev   # node site/server.mjs
npm run site:open  # открыть в браузере
```

**Сборка расширения в zip для сайта:**

```bash
npm run build:extension  # zip extension/ → wolf-wallet-extension.zip → копия в site/assets/
```

> На сайте сейчас есть только раздача `.zip`, инструкция установки и статьи. **Нет ни Connect Wallet, ни демо-dApp'а** — этот функционал спроектирован в `DAPP-CONNECT-PLAN.md`.

---

## 10. Установка и запуск

### 10.1 Локальная установка расширения

1. Открыть `chrome://extensions`
2. Включить Developer mode
3. «Load unpacked» → выбрать каталог `extension/`
4. Закрепить SOVA в toolbar (опционально)

### 10.2 Первый запуск

1. Клик по иконке → `setup-screen`
2. Создать новый кошелёк (сгенерируется мнемоника) **или** импортировать существующий
3. Записать мнемонику, пройти quiz (3 слова подтверждения)
4. Ввести пароль (8+ символов, upper/lower/digit)
5. `wallet-screen` → баланс, токены, история

### 10.3 Переключение сетей

Network picker в шапке popup'а → выбор между `eth-sepolia`, `eth-mainnet`, `bsc`. При первой отправке на mainnet появится warning.

### 10.4 Custom RPC

Advanced → custom RPC URL. Валидация: `https://` + host из whitelist. Сохраняется в `rpcByNetwork[selectedNetwork]`.

---

## 11. Разработка

### 11.1 Конвенции кода

- **ES modules не используются** в extension runtime — вместо них IIFE, экспорт через `globalThis.WolfPopup*`. Это сделано для совместимости с CSP `script-src 'self'` без `type="module"` bundling.
- **Inline handlers запрещены.** Используйте `data-onclick="fnName(arg1, arg2)"` (парсится в `event-binder.js`).
- **TypeScript не используется.** Все сети и ключи в виде строк — риск ошибок; см. рекомендацию по TS в `RECOMMENDATIONS.md` §3.5.

### 11.2 Добавление новой сети

1. В `extension/shared/networks.js` добавить запись в `BASE_NETWORKS` (`chainId`, `label`, `badge`, `isTestnet`, `defaultRpcUrl`).
2. В `extension/network-config.js` добавить платный RPC-эндпойнт (если нужен).
3. В `extension/manifest.json` добавить хост в `host_permissions` и в `connect-src` CSP, если это новый домен RPC.
4. В `popup/modules/network-state.js` → `ALLOWED_RPC_HOSTS` добавить паттерн хоста.
5. В `popup/modules/network-state.js` → `NETWORK_PICKER_OPTIONS` добавить опцию для UI.
6. В `shared/wallet-core.js` → `getTxExplorerBaseUrl` прописать URL обозревателя блоков.
7. Прогнать e2e `network-scope.spec.js` — он проверяет изоляцию состояний между сетями.

### 11.3 Добавление нового ERC-20 тестового сценария

`tests/e2e/send-erc20.spec.js` + mocked RPC в `helpers/popup-fixture.js`.

### 11.4 Git

- Основная ветка: `main`
- Remote: `MMals1/SOVA` (GitHub)
- Hooks не настроены → линт/тесты запускаются вручную перед коммитом.

---

## 12. Известные ограничения

| #   | Ограничение                                                                                                                                                                                                | Ссылка                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1   | **Alchemy-only история транзакций.** Для publicnode/infura/etc. история показывает заглушку.                                                                                                               | `RECOMMENDATIONS.md` §4.2  |
| 2   | ~~**Alchemy API key hardcoded** в `extension/network-config.js`~~ ✅ **ИСПРАВЛЕНО** (Phase 1, P1-1): дефолт — публичный publicnode, ключ удалён из репозитория, пользователь вводит свой ключ через popup. | `AUDIT-REPORT.md` CRIT-1   |
| 3   | **Нет hardware wallet** (Ledger/Trezor).                                                                                                                                                                   | `RECOMMENDATIONS.md` §2.4  |
| 4   | **Нет WalletConnect v2.** Mobile-bridge для dApp'ов без расширения.                                                                                                                                        | `RECOMMENDATIONS.md` §4.1  |
| 5   | **Нет NFT (ERC-721/1155).**                                                                                                                                                                                | `RECOMMENDATIONS.md` §4.4  |
| 6   | **Нет EIP-1559 fee market UI.** Расширение использует `gasPrice`/`maxFeePerGas` автоматически, без ручного выбора `maxPriorityFeePerGas`.                                                                  | `RECOMMENDATIONS.md` §4.3  |
| 7   | **`popup.js` всё ещё 2200+ строк** после первой декомпозиции.                                                                                                                                              | `RECOMMENDATIONS.md` §3.1  |
| 8   | **Delegation fallback chains** между `popup.js` и модулями — дублирование логики.                                                                                                                          | `RECOMMENDATIONS.md` §3.2  |
| 9   | **Нет CI** — тесты запускаются вручную.                                                                                                                                                                    | `RECOMMENDATIONS.md` §6.1  |
| 10  | **Нет in-app tx-notification'ов** (toast / badge счётчик при mined).                                                                                                                                       | —                          |
| 11  | **Нет per-transaction password re-auth** для mainnet (рекомендовано incident report'ом). Частично решено через approval popup, но без повторного ввода пароля.                                             | `RECOMMENDATIONS.md` §2.1  |
| 12  | **Нет spending limits / daily cap.**                                                                                                                                                                       | `RECOMMENDATIONS.md` §2.1  |
| 13  | **`wallet_addEthereumChain` / `wallet_switchEthereumChain` не поддерживаются** — dApp не может попросить SOVA добавить новую сеть.                                                                         | `DAPP-CONNECT-PLAN.md` §15 |
| 14  | **Нет phishing blocklist** для известных вредоносных доменов.                                                                                                                                              | `DAPP-CONNECT-PLAN.md` §15 |
| 15  | **Approval popup — отдельное окно**, а не overlay. Потенциальный UX trade-off.                                                                                                                             | —                          |

> **Что было исправлено в v1.1 (раньше было ограничением):**
>
> - ✅ dApp-коннект (`window.ethereum` injection через content_script + inpage)
> - ✅ EIP-1193 + EIP-6963 поддержка
> - ✅ `personal_sign` и `eth_signTypedData_v4`
> - ✅ Connected Sites управление в popup'е
> - ✅ Audit log для всех dApp-взаимодействий
> - ✅ First-time recipient warning (в approval UI для send transaction)

---

## 13. Документы в проекте

| Файл                                                                                | Что содержит                                    | Статус                             |
| ----------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------- |
| `README.md`                                                                         | Минимальная инструкция «как загрузить в Chrome» | Неполный — этот файл его расширяет |
| `DOCUMENTATION.md` (этот)                                                           | Полная техническая документация                 | **Актуально**                      |
| `RECOMMENDATIONS.md`                                                                | Приоритизированный список улучшений             | **Актуально**                      |
| `DAPP-CONNECT-PLAN.md`                                                              | План разработки dApp-коннекта + демо-страница   | **Актуально**                      |
| `extension_changes_since_backup.md`                                                 | Changelog за период 2026-03 работ               | Snapshot 2026-03-29                |
| `extension/optimization-plan.md`                                                    | План рефакторинга, все этапы выполнены          | Завершён 2026-03-29                |
| `tests/test-plan.md`                                                                | Исходный стратегический план тестирования       | Исторический                       |
| `tests/test-plan-2.md`                                                              | Gap-анализ покрытия (15+ пробелов)              | Актуально                          |
| `tests/test-report.md`                                                              | Фактический прогон 36 тестов                    | Snapshot 2026-03-29                |
| `tests/TEST-IMPLEMENTATION-COMPLETE.md`                                             | Скаффолд планируемых тестов (595+)              | Намерение, не факт                 |
| `tests/QUICK-REFERENCE.md`                                                          | Шпаргалка по командам тестов                    | Актуально                          |
| `security-incidents/INC-2026-03-29-wallet-theft/incident-report.md`                 | Полный incident response                        | Open (containment)                 |
| `security-incidents/INC-2026-03-29-wallet-theft/evidence.json`                      | On-chain данные                                 | Final                              |
| `security-incidents/INC-2026-03-29-wallet-theft/next-steps-checklist.md`            | Чеклист immediate / short-term / hardening      | Actionable                         |
| `security-incidents/INC-2026-03-29-wallet-theft/forensic-checklist-chrome-macos.md` | Forensics для Chrome на macOS                   | Reference                          |
| `study/docs/sources.md`                                                             | Список внешних материалов для обучения          | Reference                          |
| `site/README.md`                                                                    | Как запустить лендинг локально                  | Минимальный                        |

---

## 16. dApp connectivity (v1.1)

В версии 1.1 SOVA Wallet получила полноценную поддержку EIP-1193 dApp-коннекта. Это разблокирует использование с любым EVM-совместимым dApp'ом (Uniswap, OpenSea, Aave, и т.д.).

### 16.1 Файлы

| Файл                                       | Роль                                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `extension/inpage/provider.js`             | EIP-1193 provider, инжектится в MAIN world страницы. ~250 строк                                   |
| `extension/content/content-script.js`      | Bridge inpage ↔ service worker. ISOLATED world. ~100 строк                                        |
| `extension/popup/modules/dapp-approval.js` | UI controller для approval popup. ~430 строк                                                      |
| `extension/background/service-worker.js`   | Расширен dispatcher'ом EIP-1193 методов и connectedOrigins хранилищем                             |
| `extension/manifest.json`                  | Добавлены `content_scripts`, `web_accessible_resources`, `notifications`, `activeTab` permissions |
| `extension/popup/popup.html`               | Новые экраны: `screen-dapp-approval`, `screen-connected-sites`                                    |
| `extension/popup/popup.css`                | Стили для approval/connected sites UI                                                             |
| `extension/popup/popup.js`                 | Маршрутизация по `?request=<id>` URL parameter, broadcast `network-changed`                       |
| `site/dapp-demo.html`                      | Полная демо-страница для тестирования всех методов                                                |

### 16.2 Поддерживаемые EIP-1193 методы

| Метод                                                    | Approval popup? | Описание                                                      |
| -------------------------------------------------------- | :-------------: | ------------------------------------------------------------- |
| `eth_chainId` / `net_version`                            |       ❌        | Текущий chainId                                               |
| `eth_blockNumber`                                        |       ❌        | Номер блока (proxy на RPC)                                    |
| `eth_getBalance`                                         |       ❌        | Баланс адреса (proxy)                                         |
| `eth_call` / `eth_estimateGas` / `eth_gasPrice`          |       ❌        | Read-only proxy                                               |
| `eth_feeHistory` / `eth_getCode` / `eth_getStorageAt`    |       ❌        | Read-only proxy                                               |
| `eth_getTransactionByHash` / `eth_getTransactionReceipt` |       ❌        | Read-only proxy                                               |
| `eth_getTransactionCount`                                |       ❌        | Read-only proxy                                               |
| `eth_getBlockByNumber` / `eth_getBlockByHash`            |       ❌        | Read-only proxy                                               |
| `eth_accounts`                                           |       ❌        | Возвращает адреса для текущего origin'а из `connectedOrigins` |
| `wallet_getPermissions`                                  |       ❌        | EIP-2255 minimal — возвращает `eth_accounts` capability       |
| **`eth_requestAccounts`**                                |       ✅        | Открывает approval window                                     |
| **`personal_sign`**                                      |       ✅        | Подпись произвольного UTF-8 сообщения                         |
| **`eth_signTypedData_v4`**                               |       ✅        | EIP-712 типизированная подпись с chainId mismatch warning     |
| **`eth_sendTransaction`**                                |       ✅        | Подпись и broadcast транзакции с gas estimate в UI            |

### 16.3 Явно отклоняемые методы

| Метод                                        | Код ошибки | Причина                                       |
| -------------------------------------------- | :--------: | --------------------------------------------- |
| `eth_sign`                                   |    4200    | Deprecated, может подписать произвольный hash |
| `eth_sendRawTransaction`                     |    4200    | Не принимаем pre-signed транзакции            |
| `eth_signTypedData` / `_v1` / `_v3`          |    4200    | Только v4 поддерживается                      |
| `eth_getEncryptionPublicKey` / `eth_decrypt` |    4200    | Encryption методы не поддерживаются           |

### 16.4 Storage модель v1.1

Новые ключи в `chrome.storage.local`:

| Ключ               | Тип                                                                          | Описание                                                    |
| ------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `connectedOrigins` | `{ [origin]: { addresses, chainId, connectedAt, lastUsedAt, permissions } }` | Какие origin'ы подключены и к каким адресам                 |
| `auditLog`         | `Array<{ timestamp, type, ... }>`                                            | Кольцевой буфер на 1000 записей событий dApp-взаимодействия |
| `knownRecipients`  | `{ [address]: timestamp }`                                                   | Адреса, на которые уже отправляли (для first-time warning)  |

В `chrome.storage.session`:

| Ключ                  | Описание                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `pendingDappRequests` | Map id → request, persisted чтобы popup мог прочитать pending request даже если SW рестартовал |

### 16.5 События provider'а

SW broadcast'ит события всем подключённым dApp'ам через `chrome.tabs.sendMessage`:

| Событие           | Когда отправляется                                            |
| ----------------- | ------------------------------------------------------------- |
| `connect`         | После успешного `eth_requestAccounts` (per-origin)            |
| `accountsChanged` | При unlock, lock, переключении аккаунта в popup'е, disconnect |
| `chainChanged`    | При смене сети в popup'е (broadcast всем подключённым)        |
| `disconnect`      | При вызове `dapp-disconnect-origin` из Connected Sites экрана |

### 16.6 Безопасность

- **Origin spoofing protection:** SW сравнивает `sender.tab.url` с `msg.origin`. При несовпадении → `Origin mismatch` (-32603).
- **TTL approval requests:** 60 секунд. По истечении SW отвечает `User rejected (4001)`.
- **Approval window close = rejection:** `beforeunload` listener шлёт `user-rejected`.
- **No iframe injection:** `all_frames: false` в манифесте — SOVA не работает в iframe (защита от UI redress phishing'а).
- **EIP-712 chainId mismatch:** approval UI показывает красный warning, если `domain.chainId` не совпадает с активной сетью кошелька.
- **Hash-like message warning:** `personal_sign` показывает warning, если сообщение — 64 hex символа (потенциально подпись произвольного hash'а).
- **First-time recipient warning:** `eth_sendTransaction` показывает warning, если получатель не в `knownRecipients`. После approval адрес добавляется в storage.
- **Audit log:** все connect / sign / send события логируются локально (без передачи наружу).

### 16.7 Демо-страница

`site/dapp-demo.html` — полнофункциональная dApp для тестирования. Запуск:

```bash
npm run site:dev
# открыть http://127.0.0.1:5173/dapp-demo.html
```

Что демонстрирует:

- Connect / Disconnect через `eth_requestAccounts`
- Status bar (адрес, chainId, баланс)
- Read-only методы (eth_blockNumber, eth_chainId, eth_getBalance, eth_gasPrice)
- Send ETH через `eth_sendTransaction`
- `personal_sign` + локальная верификация через `ethers.verifyMessage`
- `eth_signTypedData_v4` с примером Order типа
- Live events log (`accountsChanged`, `chainChanged`, `connect`, `disconnect`)
- Raw JSON-RPC playground для произвольных вызовов

Также используется как regression check — Playwright тест может симулировать клики и подтверждать flow.

### 16.8 Подключение демо

Для дев-тестирования `localhost`:

1. `npm run site:dev` поднимает сервер на `http://127.0.0.1:5173`
2. Загрузить `extension/` в `chrome://extensions` (Developer mode → Load unpacked)
3. Открыть `http://127.0.0.1:5173/dapp-demo.html`
4. Нажать «Подключить SOVA Wallet» → откроется approval popup → подтвердить
5. Тестировать остальные блоки

Для реального dApp'а (Uniswap, OpenSea):

1. Открыть dApp в браузере с установленным SOVA
2. В EIP-6963 wallet selector выбрать «SOVA Wallet»
3. Дальше — стандартный flow

### 16.9 Связь с DAPP-CONNECT-PLAN.md

Все 7 фаз плана реализованы:

- ✅ Phase 1 — Infrastructure (manifest, inpage, content-script, SW handler)
- ✅ Phase 2 — Connection flow (`eth_requestAccounts`, popup approval, `connectedOrigins`)
- ✅ Phase 3 — Signing (`personal_sign`, `eth_signTypedData_v4`)
- ✅ Phase 4 — Transaction sending (`eth_sendTransaction`)
- ✅ Phase 5 — Events (`chainChanged` / `accountsChanged` broadcast, Connected Sites screen, `wallet_getPermissions`, audit log)
- ✅ Phase 6 — Базовые тесты (`tests/unit/dapp-handlers.test.js`)
- ✅ Phase 7 — Документация (этот файл, версия 1.1.0 в манифесте)

Открытые вопросы из §12 плана: некоторые отложены — `wallet_addEthereumChain`, phishing blocklist, transaction simulation, EIP-4337. Они зафиксированы в §16.10 как roadmap.

### 16.10 Roadmap расширения dApp connectivity

Не реализовано в v1.1 (намеренно отложено для следующих итераций):

| Фича                                                     | Приоритет | Зачем                                                              |
| -------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `wallet_addEthereumChain` / `wallet_switchEthereumChain` | P1        | dApp может попросить SOVA добавить новую сеть                      |
| Transaction simulation                                   | P1        | Показать «что реально изменится» через `eth_call` + state override |
| Phishing blocklist                                       | P1        | Локальная база известных фишинг-доменов                            |
| EIP-1559 ручной gas selector                             | P2        | Slow / Medium / Fast выбор tip'а                                   |
| Token approval management UI                             | P2        | Отдельный экран для `approve(spender, amount)`                     |
| WalletConnect v2                                         | P2        | Mobile/cross-device dApp connectivity                              |
| EIP-4337 account abstraction                             | P3        | Smart account'ы как альтернатива EOA                               |

---

## 14. Краткий словарь

| Термин                   | Значение                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **SW**                   | Service Worker (`background/service-worker.js`) — фоновый скрипт MV3, единственное место где живёт расшифрованный приватный ключ |
| **Keystore**             | Encrypted JSON формат хранения приватного ключа (EIP-2898, scrypt + AES)                                                         |
| **Scope key**            | `${networkKey}:${address.toLowerCase()}` — используется как ключ для изоляции истории/пагинации между аккаунтами и сетями        |
| **Mainnet guard**        | Модальное подтверждение на первой отправке в реальную сеть (per-network flag)                                                    |
| **Lockout**              | Экспоненциальная задержка после 3+ неудачных попыток ввода пароля                                                                |
| **Delegation pattern**   | Паттерн в `popup.js`: использовать модуль если загружен, иначе legacy fallback в том же файле                                    |
| **Declarative handlers** | `data-onclick="fnName(args)"` + парсинг в `event-binder.js` вместо `onclick=""` inline                                           |
| **Popup-fixture**        | `tests/e2e/helpers/popup-fixture.js` — Playwright-фикстура с mocked Chrome API и mocked JSON-RPC                                 |

---

## 15. Контакты и дальнейшие шаги

- **Следующий шаг 1 (безопасность):** реализовать 5 product hardening пунктов из incident-report'а. См. `RECOMMENDATIONS.md` §2.
- **Следующий шаг 2 (dApp):** реализовать план из `DAPP-CONNECT-PLAN.md` — критично для востребованности кошелька за пределами простого self-custody.
- **Следующий шаг 3 (рефакторинг):** завершить декомпозицию `popup.js`, удалить fallback-цепочки, рассмотреть переход на TypeScript/bundler.
- **Следующий шаг 4 (ops):** поднять CI (GitHub Actions), управление секретами, политика релизов.

---

_Этот документ является живым и должен обновляться при значимых архитектурных изменениях. Последнее обновление — 2026-04-07._
