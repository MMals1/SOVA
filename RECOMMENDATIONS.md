# SOVA Wallet — Рекомендации по проекту

Версия: 1.0
Дата: 2026-04-07
Контекст: сформировано по результатам аудита исходного кода, документации, отчётов о тестировании и incident-report'а от 2026-03-29.

## Легенда приоритетов

| Приоритет | Значение | Когда делать |
|---|---|---|
| **P0** | Блокер / безопасность | Немедленно, до следующего релиза |
| **P1** | Критично для продукта | В ближайший цикл |
| **P2** | Важно, но не срочно | В ближайший квартал |
| **P3** | Nice to have | Когда появится ресурс |

---

## 1. Сводка по приоритетам

| # | Рекомендация | Приоритет | Категория |
|---|---|---|---|
| 2.1 | Реализовать 5 hardening пунктов из incident-report | **P0** | Безопасность |
| 2.2 | Убрать hardcoded Alchemy API key из `network-config.js` | **P0** | Безопасность |
| 2.3 | Расширенная валидация перед send (simulate + code check) | **P1** | Безопасность |
| 2.4 | Поддержка hardware wallet (Ledger/Trezor) | **P1** | Безопасность |
| 2.5 | Опциональный passphrase к мнемонике (BIP39) | **P2** | Безопасность |
| 3.1 | Продолжить декомпозицию `popup.js` (2165 → <500) | **P1** | Архитектура |
| 3.2 | Удалить delegation fallback chains | **P1** | Архитектура |
| 3.3 | Явные ES-модули + bundler (Vite / esbuild) | **P2** | Архитектура |
| 3.4 | Внутренний event bus вместо глобальных функций | **P2** | Архитектура |
| 3.5 | Миграция на TypeScript (минимум для shared/) | **P2** | Архитектура |
| 3.6 | Перенести inline `<style>` из `popup.html` | **P3** | Архитектура |
| 4.1 | WalletConnect v2 (mobile bridge) | **P1** | Функциональность |
| 4.2 | Fallback для tx-history вне Alchemy (Etherscan API / logs) | **P1** | Функциональность |
| 4.3 | EIP-1559 fee market UI с ручным выбором | **P2** | Функциональность |
| 4.4 | NFT (ERC-721/1155) — просмотр и передача | **P2** | Функциональность |
| 4.5 | In-app toast/badge уведомления о mined | **P3** | UX |
| 4.6 | Реэкспорт мнемоники с паролем + таймер | **P3** | UX |
| 5.1 | Закрыть 15+ пробелов из `tests/test-plan-2.md` | **P1** | Тесты |
| 5.2 | CI/CD (GitHub Actions) с gate на перф-метрики | **P1** | Тесты |
| 5.3 | Consolidate тестовую документацию (единый test-status.md) | **P2** | Тесты |
| 5.4 | Mutation testing для крипто-чувствительных модулей | **P3** | Тесты |
| 6.1 | Secrets management (не в репо) | **P1** | Ops |
| 6.2 | Подпись расширения + план публикации в Chrome Web Store | **P1** | Ops |
| 6.3 | Семантическое версионирование + релиз-ноуты | **P2** | Ops |
| 6.4 | Reproducible build (детерминированный zip) | **P3** | Ops |
| 7.1 | Упразднить противоречия в тестовой документации | **P1** | Документация |
| 7.2 | Архитектурные диаграммы в `DOCUMENTATION.md` | **P2** | Документация |
| 7.3 | Закрепить язык (RU основной, EN зеркало) | **P2** | Документация |
| 7.4 | API-справочник IPC-сообщений SW | **P3** | Документация |

---

## 2. Безопасность

### 2.1 Hardening из incident-report (P0) — **блокер**

После инцидента 2026-03-29 в `security-incidents/INC-2026-03-29-wallet-theft/incident-report.md` §7 была сформулирована пятёрка продуктовых улучшений. **Ни одно из них не реализовано** в коде на момент аудита. Предлагается сделать это до любой следующей фичи.

#### 2.1.1 Password re-auth на каждую mainnet-транзакцию

**Что:** перед вызовом `send-eth` / `send-erc20` на `eth-mainnet` или `bsc` popup должен требовать повторного ввода пароля, даже если сессия активна.

**Почему:** снижает «blast radius» сценария «злоумышленник получил физический/удалённый доступ к уже разблокированному popup'у». Сейчас после unlock в течение 5 минут можно отправить любую сумму.

**Как:**
- В `send-flow.js` → `confirmSend()` добавить проверку `isMainnet(selectedNetwork)`.
- Показать inline pin/password prompt (без возврата на unlock-screen — это UX-регрессия).
- SW получает новый тип `verify-password`: расшифровывает текущий keystore с переданным паролем, возвращает `{ ok: true }` или `{ ok: false }`. Успех → сразу `send-*`.
- **Опциональный toggle в настройках:** «Требовать пароль для каждой mainnet-транзакции» (включён по умолчанию).

**Ссылки:** `incident-report.md:106`, `background/service-worker.js:128` (send-eth handler).

#### 2.1.2 First-time recipient warning

**Что:** если адрес получателя отсутствует в истории транзакций и в локальной «адресной книге», показать жёлтое предупреждение «вы переводите на новый адрес впервые — проверьте 4 первых и 4 последних символа».

**Почему:** защита от address-poisoning (когда в истории появляется tx с 0-value с адреса, похожего на реальный).

**Как:**
- Новая запись в storage: `knownRecipientsByAddress[address] = Set<recipient>`.
- В `confirm-tx-screen` показать баннер если получатель не в Set.
- После успешной отправки — добавить получателя в Set.
- В UI: бит «Мы видим этот адрес в первый раз» + кнопка «Проверил, отправить».

**Ссылки:** `incident-report.md:107`, `popup/modules/send-flow.js`.

#### 2.1.3 Daily spending limit (soft cap) на mainnet

**Что:** сконфигурированный лимит в ETH/BNB на день. При превышении — требовать дополнительное подтверждение (второй пароль / passphrase / 24-часовой cooldown).

**Почему:** классическая мера anti-drain. Сейчас нет никаких ограничений по сумме.

**Как:**
- Настройка в `add-account-screen` или новом `settings-screen`: `dailyCapEth`, `dailyCapBnb`.
- SW при каждом send суммирует значения за последние 24 часа (из `txHistoryCache` + runtime-буфера).
- Превышение → ошибка `daily-cap-exceeded` с подробным сообщением.

**Ссылки:** `incident-report.md:108`.

#### 2.1.4 Local anomaly / audit log

**Что:** append-only лог всех действий (unlock, lock, send attempt, send success, failed send, network switch) в `chrome.storage.local`. Не содержит приватных данных, только метаданные.

**Почему:** при следующем инциденте у пользователя будет локальная форензика «что происходило на моём расширении перед кражей».

**Как:**
- Новый модуль `popup/modules/audit-log.js` + соответствующие вызовы из SW.
- Кольцевой буфер на 1000 записей, формат `{ timestamp, action, networkKey, amount?, recipient?(maskable) }`.
- Экспорт в JSON из `settings-screen`.
- **Без телеметрии наружу** — только локально.

**Ссылки:** `incident-report.md:109`.

#### 2.1.5 Device-compromise warning при активации mainnet

**Что:** при первом переключении на `eth-mainnet` / `bsc` показать модалку с предупреждением: «Ваши средства зависят от безопасности этой машины. Убедитесь, что...».

**Почему:** управление ожиданиями пользователя + психологический барьер перед mainnet.

**Как:**
- Новый ключ `mainnetDeviceWarningAccepted`, показывается один раз.
- Текст: чеклист из 5 пунктов (чистый профиль браузера, нет неизвестных расширений, пароль не в clipboard manager'е, seed не в облаке, рекомендуется hardware wallet).
- Кнопка «Понял, продолжить» — после клика флаг сохраняется.

**Ссылки:** `incident-report.md:110`.

---

### 2.2 Hardcoded Alchemy API key (P0)

**Проблема.** `extension/network-config.js` содержит Alchemy API key в открытом виде:
```
https://bnb-mainnet.g.alchemy.com/v2/REDACTED_REVOKED_KEY
```
(Ключ также упомянут в `extension_changes_since_backup.md:34`.)

При публикации в Chrome Web Store zip-файл распакуется любому пользователю. Ключ окажется у всех, кто установит расширение или скачает zip с лендинга.

**Последствия:**
- Превышение rate limits Alchemy (общий pool на всех).
- Потеря контроля над доменом применения ключа (если забыт allowlist в Alchemy dashboard).
- Риск биллинга, если Alchemy account коммерческий.

**Решение (комбинированное):**

1. **Короткий путь — публичные RPC по умолчанию.** В `network-config.js` указывать `publicnode.com` для всех сетей. Alchemy использовать только если пользователь ввёл свой ключ.

2. **Длинный путь — per-extension-install proxy.** Если нужна премиум-скорость:
   - Поднять лёгкий proxy (Cloudflare Worker / Vercel Edge).
   - Proxy валидирует `Origin`/request signature и проксирует на Alchemy.
   - Ключ Alchemy никогда не попадает на клиент.
   - Rate limit per extension installation ID.

3. **UI-настройка для пользователя.** В `popup/modules/network-state.js` уже есть custom RPC с валидацией whitelist. Добавить блок «Введите ваш Alchemy API key» и сохранять в `chrome.storage.local`, а не в коде.

4. **Ротировать текущий ключ** (пометить скомпрометированным). Новый ключ — через proxy.

**Ссылки:** `extension/network-config.js:9`, `extension_changes_since_backup.md:34`.

---

### 2.3 Расширенная pre-send валидация (P1)

**Проблема.** Сейчас `send-eth` проверяет только адрес и сумму. Нет проверок типа:
- получатель — это контракт? (тогда простая `transfer` может зависнуть или переслать всё)
- контракт имеет известный signature (например, WETH/USDT/USDC)?
- баланс достаточный с учётом газа?
- RPC не вернул stale nonce?
- chainId у provider'а совпадает с ожидаемым?

**Как сделать:**
- Ввести функцию `validateTxPreflight(txRequest, provider)` в `send-flow.js`:
  1. `await provider.getCode(to)` — если не `"0x"`, это контракт → warning или подсказка использовать token send flow.
  2. `await provider.getBalance(from)` — сравнить с `value + gasEstimate * gasPrice`.
  3. `await provider.getNetwork()` — сравнить `.chainId` с `NETWORKS[selectedNetwork].chainId`. Несоответствие → abort (провайдер ответил на другую сеть).
  4. `await provider.getTransactionCount(from, 'pending')` — использовать как nonce, чтобы не перезаписать pending tx.
- Показать в `confirm-tx-screen` блок «Pre-check» с результатами.

**Почему:** это дешёвая защита от ошибок типа «отправил ETH на адрес USDT-контракта» или «RPC поменялся и теперь подписывает на неправильной сети» (рельсы replay-атак не через reveal'овые сценарии).

---

### 2.4 Hardware wallet (P1)

**Проблема.** Для mainnet использование чисто software-кошелька — слабая безопасность (инцидент 2026-03-29 это показал). Ledger/Trezor исключают класс атак «украли keystore / seed».

**Как:**
- Отдельный аккаунт-тип `{ type: 'hardware', device: 'ledger' | 'trezor', derivationPath, address }`, без keystore'а.
- Для подписи SW вместо `wallet.sendTransaction` использует `@ledgerhq/hw-transport-webhid` + `@ledgerhq/hw-app-eth` (для Trezor — `@trezor/connect-web`).
- **Важно:** WebHID доступен только в popup контексте, не в service worker (как в MV3). Значит подпись tx должна происходить в popup, а не в SW — это ломает текущий паттерн «ключ только в SW». Нужна отдельная ветка в `send-flow.js`:
  - software accounts → message to SW
  - hardware accounts → прямо в popup через WebHID

**Сложность:** высокая. Но это **единственный** способ всерьёз защитить mainnet фонды.

---

### 2.5 Опциональный BIP39 passphrase (P2)

**Проблема.** Сейчас мнемоника — единственный фактор восстановления. Это стандарт, но BIP39 позволяет добавить passphrase (25-е слово), который:
- хранится только в голове пользователя,
- даёт **другой** набор адресов из той же seed,
- эффективно добавляет второй фактор.

**Как:**
- В `setup-screen` при создании кошелька — опциональное поле «Passphrase (необязательно)» + предупреждение «потеря passphrase = потеря доступа, восстановление невозможно».
- `ethers.HDNodeWallet.fromPhrase(mnemonic, passphrase, path)` уже поддерживает это.
- В `unlock-screen` passphrase НЕ вводится (мы используем хранимый keystore).
- Если пользователь захочет восстановить на другом устройстве — он должен ввести и mnemonic, и passphrase.

---

## 3. Архитектура

### 3.1 Продолжить декомпозицию `popup.js` (P1)

**Текущее состояние:** 2165 строк в одном файле, несмотря на Этап 1 оптимизации. Модули `network-state.js` / `tx-history.js` / `token-state.js` / `send-flow.js` существуют, но `popup.js` всё ещё держит:
- bootstrap + migration
- `_accountsCache` + `_providerCache`
- Legacy fallback всех модулей (delegation pattern)
- refresh loops, auto-refresh timers
- confirmation flow orchestration
- quiz screen logic
- avatar updates
- account menu
- address book (ad-hoc в коде)

**Целевая декомпозиция:**

| Новый модуль | Что выделить | Строк (приблизительно) |
|---|---|---:|
| `popup/modules/bootstrap.js` | DOMContentLoaded, миграции, первый рендер | 200 |
| `popup/modules/session.js` | session-check, unlock routing, SW ping | 150 |
| `popup/modules/accounts.js` | `getAccountsCached`, `addSubAccount`, activate, menu | 300 |
| `popup/modules/refresh-loop.js` | balance polling, throttle, visibility API | 150 |
| `popup/modules/quiz-flow.js` | mnemonic verification quiz | 100 |
| `popup/modules/import-flow.js` | Импорт по mnemonic/privateKey + валидация | 150 |
| `popup/modules/address-book.js` | Сохранение известных получателей, адресация | 150 |
| `popup/popup.js` (остаток) | Главный wiring: события DOMContentLoaded → bootstrap | **< 400** |

**Критерий готовности:** `popup.js` < 500 строк; модули не импортируют друг друга кроме как через `WolfPopup*` глобали или общий `PopupState`.

**Приём:** запустить `perf-baseline.spec.js` до и после — метрики не должны ухудшиться (269ms / 345ms).

---

### 3.2 Удалить delegation fallback chains (P1)

**Проблема.** Паттерн в `popup.js`:
```js
const mod = globalThis.WolfPopupNetworkState;
if (mod && typeof mod.setNetwork === 'function') {
  await mod.setNetwork(key);
} else {
  // 40 строк fallback-реализации
}
```
даёт:
- удвоение кодовой базы (одна и та же логика в двух местах);
- риск drift'а (fallback чинится, модуль не чинится или наоборот);
- усложнение дебага — «какой путь сейчас исполняется?».

**Решение.** Модули уже стабильны (36/36 тестов проходят). Нужно:

1. Удалить все `if (mod && typeof mod.X === 'function')` проверки.
2. Вместо этого — **жёсткое требование** наличия модуля: `if (!mod) throw new Error('WolfPopupNetworkState not loaded')` в начале `popup.js`.
3. Удалить все fallback-функции.
4. Прогнать весь test suite.

**Эффект:** -500…-700 строк из `popup.js`.

---

### 3.3 Явные ES-модули + bundler (P2)

**Проблема.** Сейчас инициализация через IIFE + присвоение в `globalThis` — это legacy-паттерн ради CSP `script-src 'self'` без `"type": "module"`. Минусы:
- Нет tree-shaking.
- Порядок скриптов в HTML — жёсткая зависимость; неправильный порядок → runtime null errors.
- Нет явных импортов → IDE не подсказывает.
- Глобальные имена → риск коллизий.

**Предложение.** Собрать `popup.js` через bundler (Vite / esbuild / rollup) в один `popup.bundle.js`:
- Исходники становятся ES-модулями (`import`/`export`).
- Bundler выдаёт один минифицированный файл.
- CSP совместимость: `script-src 'self'` работает, т.к. bundle — локальный файл.
- HTML подключает только `popup.bundle.js` и `libs/ethers.umd.min.js`.

**Аналогично для service worker:** отдельный `sw.bundle.js`.

**Цена:** дополнительная стадия сборки, нужно `npm run build` перед `zip`. Но это и так нужно (см. §6.4).

**Компромисс:** если хочется сохранить no-build подход, то оставляем как есть, но формализуем порядок загрузки в один `<script src="popup/loader.js">` который загружает модули через `importScripts`-аналог (не работает в popup). Не рекомендуется.

---

### 3.4 Внутренний event bus (P2)

**Проблема.** Модули общаются через глобальные функции (`window.sendTransaction`, `window.loadWalletScreen`). Это создаёт скрытые зависимости.

**Решение.** Минимальный pub/sub в `popup/modules/event-bus.js`:
```js
const WolfEventBus = {
  listeners: new Map(),
  on(event, fn) { ... },
  off(event, fn) { ... },
  emit(event, payload) { ... }
};
```

События: `unlock:success`, `unlock:failed`, `network:changed`, `account:activated`, `tx:sent`, `tx:confirmed`, `auto-lock:triggered`, `balance:updated`.

**Эффект:** модули подписываются на то, что им нужно, вместо того чтобы вызывать `window.*`. Тестируемость +++.

---

### 3.5 TypeScript (P2)

**Проблема.** Сеть — строковый ключ, который используется в 20+ местах. Ошибка в строке (`eth-mainnte` вместо `eth-mainnet`) → runtime error, который ловится только тестами. Типы контрактов (`Account`, `TxRequest`, `NetworkConfig`) неявные.

**Решение.** Миграция в TypeScript без полного переписывания:
1. Начать с `shared/`: `wallet-core.ts`, `networks.ts` с strict types.
2. Далее `popup/modules/*.ts`.
3. `service-worker.ts` в последнюю очередь.
4. Использовать `tsc --noEmit` в CI как type-check без замены runtime.
5. Для runtime — компилировать в ES5/ES2020 bundle через esbuild (см. §3.3).

**Альтернатива (дешёвая):** JSDoc с `@type` аннотациями и `// @ts-check` в начале файла. Это даёт TypeScript-подобные проверки без изменения расширений.

---

### 3.6 Перенести inline `<style>` из `popup.html` (P3)

`extension/popup/popup.css` существует, но `popup.html` содержит inline `<style>`-блоки (судя по упоминаниям в optimization-plan.md Этап 5). Нужно завершить миграцию.

---

## 4. Функциональность

### 4.1 WalletConnect v2 (P1)

**Что:** поддержка WalletConnect v2 протокола — это индустриальный стандарт для mobile-to-dApp соединений (QR-код или deep link).

**Почему:** даже если dApp-коннект (см. `DAPP-CONNECT-PLAN.md`) сделан через `window.ethereum`, WalletConnect покрывает случай «пользователь на десктопе, dApp — мобильное web-приложение или десктопное приложение без расширения».

**Как:** `@walletconnect/sign-client` + `@walletconnect/utils`. Требуется:
- UI экран «Подключения WalletConnect» со списком активных сессий.
- Обработка session_request → popup approval.
- Namespaces для eip155 (1, 56, 11155111).
- Session persistence в `chrome.storage.local`.

**Сложность:** средняя. WalletConnect SDK поддерживает browser extensions. Есть библиотека ~200KB, нужно будет добавить в `libs/`.

**Ссылки:** [WalletConnect docs](https://docs.walletconnect.com/) (не проверять ссылку, просто reference).

---

### 4.2 Fallback для tx-history вне Alchemy (P1)

**Проблема.** `tx-history.js:fetchAlchemyTransfers()` работает только если `rpcUrl` содержит `*.g.alchemy.com`. На `publicnode.com` / `infura.io` / любом другом RPC история покажет заглушку.

**Решения (по сложности):**

1. **Etherscan API (простой).** Публичный API Etherscan/BscScan даёт `module=account&action=txlist` — ровно то, что нужно. API key бесплатный, можно прописать как опциональную настройку. Плюсы: работает на любой RPC. Минусы: Etherscan специфичен, для L2 нужны отдельные endpoints (Arbiscan, Basescan), cross-chain generalization — боль.

2. **Прямой `eth_getLogs` + `eth_getBlockByNumber` (средний).** Сканировать блоки от текущего к прошлому, искать tx где `from == address` или `to == address`. Медленно, грузит RPC, но работает на любом ноде. Нужна пагинация по block range (например, последние 10000 блоков, остальное — on-demand).

3. **Гибрид (рекомендуется).** Если `rpcUrl` — Alchemy → `alchemy_getAssetTransfers`. Если есть Etherscan API key → Etherscan. Иначе → last-resort `eth_getLogs` на короткий диапазон блоков + предупреждение «Полная история недоступна, настройте Alchemy или Etherscan API key».

**Изменения:**
- `popup/modules/tx-history.js` — добавить стратегию `fetchHistory(address, networkKey, rpcUrl)` с ветвлением.
- Новый модуль `popup/modules/tx-history-sources.js` для источников.
- Настройки RPC расширить до `{ rpcUrl, historySource: 'auto' | 'alchemy' | 'etherscan' | 'logs', historyApiKey }`.

---

### 4.3 EIP-1559 fee market UI (P2)

**Проблема.** Сейчас gas estimate берётся из `provider.getFeeData()` без возможности ручной правки. Нет выбора «Slow / Medium / Fast» или tip'а.

**Решение.** На `confirm-tx-screen` добавить:
- `maxPriorityFeePerGas` (tip) — слайдер / пресеты Slow/Medium/Fast.
- `maxFeePerGas` — автоматически на основе базовой цены + tip, но с кнопкой «Advanced».
- Предварительный ETA (по gas tracker'у — Alchemy или публичный API).

**Почему P2:** сейчас пользователь не теряет деньги, но не может ускорить застрявшую транзакцию. Это критично при волатильном mempool.

---

### 4.4 NFT (ERC-721/1155) (P2)

**Что:** просмотр, получение, передача.

**Как:**
- Новая вкладка «NFTs» в `wallet-screen`.
- Alchemy NFT API: `alchemy_getNfts` + media rendering.
- Fallback на Etherscan / прямые `tokenURI` вызовы.
- Send flow для NFT (`safeTransferFrom`) в `send-flow.js`.
- Warning: NFT approvals — ещё один вектор фишинга, отдельный UX для `setApprovalForAll`.

---

### 4.5 In-app toast / badge уведомления (P3)

**Что:** когда tx mined — badge на иконке расширения (`chrome.action.setBadgeText({ text: '1' })`) + при открытии popup'а — toast «Tx 0xabc… подтверждена в блоке N».

**Как:**
- SW при `send-*` должен запомнить tx hash и стартовать `chrome.alarms` на poll `eth_getTransactionReceipt` каждые 15 сек.
- При `receipt != null` → `chrome.action.setBadgeText` + push в очередь notifications.
- Popup при открытии читает очередь и показывает toast'ы.

---

### 4.6 Реэкспорт мнемоники с паролем + таймер (P3)

**Что:** в `settings-screen` кнопка «Показать seed» → запрос пароля → показ мнемоники на 30 секунд с обратным отсчётом → автоматическое скрытие.

**Почему:** пользователю нужно иногда перепроверить seed (смена устройства), но сохранение копии в clipboard manager — это то, из-за чего произошёл инцидент 2026-03-29.

**Как:**
- Отключить copy-to-clipboard (пусть переписывает руками).
- Скрывать при смене таба / minimise popup'а.
- Audit log «seed displayed».

---

## 5. Тесты

### 5.1 Закрыть пробелы из `tests/test-plan-2.md` (P1)

`tests/test-plan-2.md` фиксирует **~55% покрытия** и перечисляет 15+ критических пробелов:

| # | Пробел | Что написать |
|---|---|---|
| 1 | Auto-lock timeout fires & clears wallet | Integration: mock `chrome.alarms`, verify `_walletsByAddress.size === 0` |
| 2 | Lockout после 3 неудач | Unit + e2e: `service-worker-unlock.test.js` (скелет есть) |
| 3 | SW restart mid-session | e2e `resilience.spec.js` частично покрыт; дописать сценарии с открытым send flow |
| 4 | `chrome.storage.session` expiry | Integration |
| 5 | Invalid mnemonic edge cases | Unit: `wallet-core-edge-cases.test.js` |
| 6 | `eth_requestAccounts` (будет после dApp-коннекта) | e2e |
| 7 | Amount precision (max 18 decimals, scientific notation) | Unit `input-validation.test.js` |
| 8 | ERC-20 с decimals = 0 (редко, но есть) | Unit + e2e |
| 9 | Gas estimate fails → UX | e2e `error-resilience.spec.js` |
| 10 | RPC возвращает null для `eth_chainId` | Integration `rpc-fallback.test.js` |
| 11 | Token logo недоступен | Unit `token-scope.test.js` |
| 12 | `fetchAlchemyTransfers` при не-Alchemy RPC | Integration |
| 13 | CSP violation on inline handler | e2e (headed, проверить console) |
| 14 | Popup перезагружен во время quiz | e2e |
| 15 | Сеть переключена во время send | e2e (state isolation) |

**Критерий готовности:** `npm run test:unit && npm run test:e2e` → 50+ новых тестов, 0 регрессий.

---

### 5.2 CI/CD (P1)

**Сейчас:** ничего. Тесты руками, perf-метрики руками.

**Нужно:** GitHub Actions workflow в `.github/workflows/ci.yml`:

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
      - run: npm test              # unit + integration
      - run: npx playwright install chromium
      - run: npm run test:e2e
      - name: Perf gate
        run: |
          # Compare perf-baseline.spec.js output against stored baseline
          # Fail if median regression > 15%
```

**Добавить:**
- Branch protection на `main`: требует green CI.
- Автопубликация zip как artifact на каждом PR.

---

### 5.3 Консолидация тестовой документации (P2)

Сейчас 4 файла с разным состоянием:
- `tests/test-plan.md` — исторический
- `tests/test-plan-2.md` — gap-анализ (~55%)
- `tests/test-report.md` — фактический прогон (36 тестов)
- `tests/TEST-IMPLEMENTATION-COMPLETE.md` — «595+ тестов готовы» (ошибочно, это план-скаффолд, не реальность)

**Предложение:**
- Удалить `TEST-IMPLEMENTATION-COMPLETE.md` — вводит в заблуждение.
- Переименовать `test-report.md` → `TEST-STATUS.md` — живой файл, обновляется после каждого CI runа (можно автогенерировать).
- `test-plan.md` + `test-plan-2.md` → объединить в `TEST-PLAN.md` с явным разделом «Что сделано» / «Что осталось».

---

### 5.4 Mutation testing для крипто-модулей (P3)

**Что:** Stryker Mutator применяется к `service-worker.js` + `network-state.js` + `wallet-core.js`. Каждая мутация (например, `>=` → `>`) должна быть поймана тестом.

**Почему:** строгая гарантия, что тесты реально проверяют поведение, а не просто покрывают строки.

---

## 6. Ops / релиз

### 6.1 Secrets management (P1)

**Проблема.** Alchemy API key в коде (см. §2.2). Плюс:
- Нет `.env` файла.
- Нет `.env.example`.
- Нет инструкций «как подставить свой ключ перед build».

**Решение.**
1. `.env` + `.env.example` + build-скрипт, который подставляет `process.env.ALCHEMY_KEY` в `extension/network-config.js` на этапе сборки.
2. `.gitignore` уже содержит `node_modules/`, нужно добавить `.env`, `key.pem`, `key_pkcs8.pem`, `extension.crx`.
3. **Удалить из git** `key.pem`, `key_pkcs8.pem`, `extension.crx` (сейчас untracked, но были помечены как untracked в `git status` — проверить, не уходили ли в историю).

**Проверка:** `git log --all --full-history -- key.pem` — если есть коммиты, нужна форсированная история (`git filter-branch` или `git filter-repo`). **Это destructive — делать только с явным согласием.**

---

### 6.2 Подпись расширения + публикация (P1)

**Сейчас:**
- `key.pem` / `key_pkcs8.pem` лежат в корне репо (untracked).
- `extension.crx` тоже лежит в корне.
- План публикации в Chrome Web Store не задокументирован.

**Нужно:**
1. Вынести `key.pem` из репо в `~/.sova/key.pem` (или аналогичный local-only путь).
2. Скрипт `scripts/package.sh`:
   - Прогнать тесты.
   - Скопировать `extension/` во временный каталог.
   - Подставить секреты (Alchemy key / proxy URL).
   - Собрать zip.
   - (Опционально) подписать в crx через `key.pem`.
3. Документ `docs/publishing.md`: как добавлять версии, как пушить в Chrome Web Store dashboard, как управлять allowlist beta testers.

---

### 6.3 Семантическое версионирование (P2)

Сейчас `manifest.json` версия — `1.0.0`, `package.json` — `1.0.0`. Ни один из этих файлов не обновлялся с первой фиксации. После всех изменений это не 1.0.0.

**Предложение:**
- SemVer: `MAJOR.MINOR.PATCH`
- `MAJOR` — смена storage schema, смена message API между popup/SW
- `MINOR` — новая сеть, новая фича (dApp connect, WalletConnect)
- `PATCH` — баг-фикс, UX, зависимости

**Процесс:** git tag + автоматический changelog (Conventional Commits + `@changesets/cli` или `standard-version`).

---

### 6.4 Reproducible build (P3)

**Проблема.** Если собрать zip сейчас и ещё раз завтра, байты могут отличаться (timestamp в zip, порядок файлов). Это затрудняет верификацию «тот ли зип опубликован».

**Решение.**
- `zip` с флагами `-X` (strip extra file attributes) + фиксированный timestamp (`find ... -exec touch -t ...`).
- Lockfile npm (`package-lock.json` уже есть — хорошо).
- Docker-based build для полной изоляции.

---

## 7. Документация

### 7.1 Упразднить противоречия (P1)

См. §5.3 — касается и тестовой, и общей документации.

Конкретно:
- `TEST-IMPLEMENTATION-COMPLETE.md` противоречит `test-report.md` и `test-plan-2.md` → удалить.
- `optimization-plan.md` говорит «всё закончено», но `popup.js` всё ещё 2165 строк → дописать «Этап 7: финальная декомпозиция — не выполнен».
- `README.md` минимальный → заменить ссылкой на `DOCUMENTATION.md`.

---

### 7.2 Архитектурные диаграммы (P2)

В `DOCUMENTATION.md` есть ASCII-диаграмма слоёв. Улучшить:
- Sequence-диаграмма unlock-flow (popup → SW → ethers.Wallet.fromEncryptedJson → chrome.alarms.create).
- Sequence-диаграмма send-flow.
- State machine для экранов popup'а.
- Диаграмма ключей storage (local vs session).

Использовать Mermaid (`.mmd` файлы + рендер в PR review GitHub).

---

### 7.3 Закрепить язык документации (P2)

Сейчас смесь:
- RU: `README.md`, `extension_changes_since_backup.md`, `optimization-plan.md`, `test-plan-2.md`, `test-report.md`, внутренние комментарии в коде.
- EN: `incident-report.md`, `DOCUMENTATION.md` (новый — RU), JSDoc-комментарии в некоторых модулях, лендинг (двуязычный).

**Предложение:** основной язык — **русский** (согласно позиционированию проекта). EN зеркало для:
- `incident-report.md` (сложившийся международный стандарт форматов security write-up'ов),
- `README.md` (первый контакт для международных пользователей GitHub),
- лендинг.

Для документации в `docs/` — только русский.

---

### 7.4 API reference для IPC-сообщений SW (P3)

Таблица в §3 `DOCUMENTATION.md` — это минимум. Полезно иметь отдельный `docs/ipc-api.md` с примерами:
- Каждое сообщение: payload, return, error cases, side effects.
- Версионирование: при изменении формата — bump minor version (`manifest.json`) + changelog.

---

## 8. Рекомендации по немедленным действиям

Если выбирать 5 самых приоритетных задач «на эту неделю», то:

1. **Убрать Alchemy API key из кода** (§2.2). Риск мультиустановочной утечки при публикации.
2. **Password re-auth для mainnet-транзакций** (§2.1.1). Минимальный hardening после инцидента.
3. **First-time recipient warning** (§2.1.2). Защита от address-poisoning.
4. **Поднять CI** (§5.2). Без этого все последующие рефакторинги рискуют ломать `main`.
5. **Убрать delegation fallbacks** (§3.2). Быстрый способ избавиться от технического долга перед началом работы над dApp-коннектом.

Эти 5 пунктов не зависят друг от друга и могут делаться параллельно. Оценочный объём — несколько рабочих дней на каждый пункт.

---

## 9. Рекомендации среднего горизонта

После 5 немедленных — **хуки для следующей большой фичи**:

6. Добавить Etherscan fallback для tx-history (§4.2). Разблокирует использование без Alchemy.
7. Реализовать `DAPP-CONNECT-PLAN.md`. Превращает SOVA из «инструмента для ручных переводов» в полноценный Web3 wallet.
8. Hardware wallet поддержка (§2.4). Закрывает единственный реальный способ защитить mainnet.
9. WalletConnect v2 (§4.1). Mobile-coverage.
10. Дозакрыть тесты из `test-plan-2.md` (§5.1). Убрать технический долг в покрытии.

---

## 10. Что НЕ рекомендуется

Для полноты — явно перечислю варианты, которые **не стоит** делать, даже если соблазн есть:

- **«Интегрировать свой RPC ноду».** Это большой ops-проект, несравнимый по стоимости с использованием Alchemy/Infura через proxy. Реализуется только если есть явная причина (регуляторная / privacy).
- **«Переписать на React / Vue».** UI работает, DOM-first подход совместим с MV3 CSP без bundler'а. Переписывание ради переписывания ломает стабильный baseline.
- **«Добавить токен-свапы (Uniswap API)».** Функция привлекательная, но это открытая дверь для фишинга через контрактные approve'ы. Делать только после hardware wallet support и разработанного UX для approve'ов.
- **«Своя мнемоника / нестандартный crypto».** Любые отступления от BIP39/BIP44 ломают совместимость с другими кошельками и повышают риск ошибок. Использовать только ethers.js.
- **«Встроить аналитику / телеметрию».** Проект позиционируется как «без серверов, без передачи данных». Любая телеметрия наружу — это потеря уникального позиционирования. Audit log (§2.1.4) — только локально.

---

## 11. Связь с другими документами

- **`DOCUMENTATION.md`** — единый источник архитектурной истины; этот документ ссылается на его секции.
- **`DAPP-CONNECT-PLAN.md`** — детальный план разработки одной конкретной фичи (dApp коннект + демо-страница). Этот документ ссылается на §4 и §7 как её предпосылки.
- **`security-incidents/INC-2026-03-29-wallet-theft/incident-report.md`** — первоисточник для §2.1. Все 5 пунктов harding'а идут оттуда.
- **`extension/optimization-plan.md`** — исторический, описывает уже сделанные оптимизации. Этот документ добавляет «что осталось».
- **`tests/test-plan-2.md`** — первоисточник для §5.1.

---

_Документ обновляется по мере закрытия задач. Последнее обновление — 2026-04-07._
