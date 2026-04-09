# SOVA Wallet — Отчёт по тестовому покрытию

**Дата:** 2026-04-08
**Контекст:** аудит тестов после обнаружения регрессии в Phase 2 (фикс `send-eth`/`send-erc20` в whitelist'е sender validation).
**Статус работы:** ✅ критические пробелы закрыты, +80 новых тестов добавлено.

---

## 1. Краткое резюме

**Вопрос:** достаточно ли текущих тестов?

**Ответ:** ранее — **нет**. Сейчас — **частично**.

Анализ выявил что существующие 251 теста хорошо покрывают popular paths (wallet utils, network state, input validation), но имели **5 критических пробелов**:

1. **Sender validation whitelist** — 0 тестов. Именно этот пробел позволил regression (`send-eth` удалён из whitelist → вся Send flow сломалась, ни один тест не поймал).
2. **`service-worker-unlock.test.js` — stale.** Тестировал удалённую in-memory версию lockout с линейным backoff `5000*(n-2)` и cap 60 сек. Реальный код (после Phase 1 P1-3) — persistent в `chrome.storage.local`, экспоненциальный backoff `5000*2^(n-3)`, cap 15 мин.
3. **chainId hard block (P2-4)** — 0 функциональных тестов. Был только тест `isChainMismatch` как pure function, но не полного handler'а.
4. **RPC method whitelist (P2-1)** — 0 тестов. Никто не проверял что unknown `eth_*` методы возвращают `4200`.
5. **dApp approval XSS (P2-3)** — 0 тестов для новых `buildKvRow`/`buildWarnBox`/`buildTreeTitle` helpers.

После Phase 3 этого audit'а:

✅ Написано **3 новых test файла** (sender-validation, dapp-approval-xss)
✅ **Переписан** `service-worker-unlock.test.js` на persistent lockout
✅ **Расширен** `dapp-handlers.test.js` (+23 новых теста)
✅ Всего: **+80 тестов** (251 → **331**)
✅ Верифицировано что новый `sender-validation.test.js` **реально ловит** `send-eth` регрессию

---

## 2. Текущее состояние тестов

### Статистика

| Категория | До | После | Δ |
|---|:---:|:---:|:---:|
| Unit test files | 10 | **12** | +2 |
| Integration test files | 5 | 5 | — |
| E2E spec files | 15 | 15 | — |
| **Total test files** | **30** | **32** | **+2** |
| Unit tests (individual) | 186 | **264** | **+78** |
| Integration tests | 83 | 83 | — |
| E2E tests (Playwright) | 84 | 84 | — |
| **Unit + Integration running** | **251** | **331** | **+80** |

### Инвентаризация unit + integration файлов

| Файл | Тесты | Что покрывает |
|---|:---:|---|
| `tests/unit/popup-helpers.test.js` | 4 | formatAmount, shortAddr, explorer URLs, getTxScopeKey |
| `tests/unit/network-state.test.js` | 2 | Базовая network detection |
| `tests/unit/tx-pagination.test.js` | 4 | Pagination math |
| `tests/unit/token-scope.test.js` | 4 | Token scoping by network |
| `tests/unit/service-worker-network.test.js` | 2 | RPC URL fallback |
| **`tests/unit/service-worker-unlock.test.js`** | **19** ⬆ | **Persistent lockout (P1-3) + SW restart persistence** |
| `tests/unit/input-validation.test.js` | 30 | Addresses, amounts, mnemonics, RPC URLs |
| `tests/unit/popup-state.test.js` | 35 | Shared state sync |
| `tests/unit/wallet-core-edge-cases.test.js` | 44 | Edge cases в wallet-core helpers |
| **`tests/unit/dapp-handlers.test.js`** | **49** ⬆ | **EIP-1193 dispatcher + chainId block (P2-4) + RPC whitelist (P2-1) + persistence (CRIT-5)** |
| 🆕 **`tests/unit/sender-validation.test.js`** | **31** | **POPUP_ONLY/CONTENT_SCRIPT whitelist + cross-context spoofing** |
| 🆕 **`tests/unit/dapp-approval-xss.test.js`** | **24** | **buildKvRow/buildWarnBox/buildTreeTitle + structural guard** |
| `tests/integration/popup-sw-session.test.js` | 3 | Popup ↔ SW session sync |
| `tests/integration/account-switch.test.js` | 3 | Account switching basics |
| `tests/integration/account-isolation.test.js` | 24 | Data isolation across accounts |
| `tests/integration/rpc-fallback.test.js` | 26 | RPC config fallback |
| `tests/integration/unlock-session-lifecycle.test.js` | 27 | Unlock/lock/auto-lock flows |

### E2E тесты (Playwright, запускаются отдельно)

15 spec файлов, ~84 тестов:
- `smoke`, `unlock`, `unlock-lockout` (19 тестов), `send-eth`, `send-erc20`, `token-flow`, `network-scope`, `network-rpc-guard`, `account-onboarding`, `resilience`, `error-resilience`, `comprehensive-flows`, `history-pagination`, `session-ui-security`, `perf-baseline`.

---

## 3. Новые тесты (Phase 3 test coverage)

### 3.1 `tests/unit/sender-validation.test.js` 🆕 (31 теста)

**Цель:** предотвратить повторение `send-eth` регрессии.

**Что тестирует:**

1. `isFromExtensionContext` / `isFromOurContentScript` helpers — корректно отличают popup от content-script от другого расширения
2. **Content `POPUP_ONLY_MESSAGE_TYPES` whitelist** — явно проверяет что `send-eth`, `send-erc20`, `unlock`, `lock`, `activate-account`, `dapp-approval-response` и др. **присутствуют** в whitelist. Каждый тип — отдельный `it(...)` → если кто-то удалит один, тест упадёт с понятным сообщением.
3. **Structural guard**: парсит реальный `service-worker.js` через `fs.readFileSync` + regex, извлекает whitelist, сравнивает с ожидаемым. Не позволяет whitelist-у разойтись с тестом.
4. **Automatic discovery test**: извлекает все `sendToSW({ type: 'X' })` вызовы из popup.js + модулей, проверяет что каждый тип есть в whitelist.
   - **Именно этот тест поймал бы `send-eth` регрессию.**
5. Cross-context spoofing scenarios: malicious content-script пытается отправить `unlock`, `send-eth`, `dapp-approval-response`, `dapp-disconnect-origin`, `dapp-get-pending` — все должны быть отклонены.

**Верификация работы:**

Я удалил `'send-eth',` из whitelist'а в service-worker.js и запустил тест — **3 теста упали** с понятным сообщением:

```
FAIL > popup → SW message types are all whitelisted
Error: The following message types are sent from popup but NOT in POPUP_ONLY_MESSAGE_TYPES:
  - send-eth

This will cause "Unknown message type" errors in SW.
Add them to extension/background/service-worker.js POPUP_ONLY_MESSAGE_TYPES.
```

Именно такой сигнал нужен был чтобы поймать регрессию до пользователя.

### 3.2 `tests/unit/service-worker-unlock.test.js` 🔄 (19 тестов, переписан)

**Проблема:** старый тест использовал in-memory `_failedAttempts`/`_lockoutUntil` и линейный backoff `5000 * (n-2)` с cap 60 сек. Реальный код в Phase 1 (P1-3) использует `chrome.storage.local['security:lockout']` с экспоненциальным `5000 * 2^(n-3)` и cap 15 мин.

**Что теперь тестирует:**

- Mock `chrome.storage.local` с персистентным store
- Mock `walletsByAddress` Map + `activeWalletAddress` — они **in-memory**, стираются при SW restart
- Функция `simulateSwRestart()` — очищает только in-memory state, не storage
- **Ключевой regression guard:** `lockout PERSISTS across SW restart` — тест поднимает lockout до 3 failed attempts → симулирует SW kill → проверяет что следующий попытка всё равно отклоняется
- `failed attempts counter accumulates across SW restarts` — атакующий который рестартует SW между попытками **не обнуляет** счётчик
- `successful unlock clears lockout state from storage` — явная очистка через `chrome.storage.local.remove`
- Exponential backoff: 3→5s, 4→10s, 5→20s
- Cap MAX_LOCKOUT_MS = 15 min

### 3.3 `tests/unit/dapp-handlers.test.js` 🔄 (49 тестов, +23 новых)

**Новые секции:**

- **`P2-4: EIP-712 chainId hard block`** (12 тестов) — проверяет `checkChainIdMismatch` возвращает `4901` при несовпадении domain.chainId. Тестирует number/hex string/decimal string/bigint форматы. Явные attack scenarios: Polygon permit на mainnet-кошельке → block; BSC permit на Sepolia → block.
- **`P2-1: RPC method whitelist (not blacklist)`** (8 тестов) — тестирует что unknown `eth_*` методы возвращают `4200`, а не fall-through в proxy. Включая hypothetical provider-specific (`alchemy_getAssetTransfers`, `parity_*`, `debug_*`) и typos (`eth_sigh`).
- **`CRIT-5: Pending approval persistence stores only metadata`** (3 теста) — проверяет что `persistPendingRequest` хранит только id/origin/method/createdAt/expiresAt, а sensitive поля (`params`, `needsUnlock`, `targetAddress`) отсутствуют. Включает тест с Permit2 signature payload: атакующий dApp просит подписать unlimited approve → если бы данные персистились, stale approval можно было бы replay'нуть → тест проверяет что JSON persisted формы **не содержит** spender address, Permit2 name, sigDeadline.

### 3.4 `tests/unit/dapp-approval-xss.test.js` 🆕 (24 теста)

**Цель:** гарантировать что P2-3 fix (замена innerHTML на DOM API) защищает от XSS.

**Что тестирует:**

1. `buildKvRow` — не интерпретирует value/label как HTML. Тесты с payload'ами:
   - `<img src=x onerror="alert(1)">`
   - `<script>alert(1)</script>`
   - `" onerror="x" '` (quote injection)
   - Unicode/emoji
   - Numbers, bigint, null
2. `buildWarnBox` — аналогично, включая danger class
3. `buildTreeTitle` — аналогично для заголовков EIP-712 tree
4. **Structural guard:** парсит реальный `dapp-approval.js` и проверяет:
   - 0 случаев `innerHTML = \`...${...}...\`` (template literal с interpolation)
   - 0 случаев `innerHTML[^;]*escapeHtml` (старый escape-then-innerHTML паттерн)
   - Функции `buildKvRow`, `buildWarnBox`, `buildTreeTitle` упомянуты
   - **Все `innerHTML = ...` это только `= ''`** (очистка перед пересборкой DOM). Любое другое значение — тест падает.

---

## 4. Оставшиеся пробелы (не закрытые в этом audit'е)

| Severity | Пробел | Рекомендация |
|---|---|---|
| **P1** | `inpage/provider.js` (262 строки) — 0 тестов | Написать unit-тест через jsdom: `SovaProvider.request()` валидация, response matching by id, event emitter, timeout cleanup |
| **P1** | `content/content-script.js` (111 строк) — 0 тестов | Написать unit-тест: ALLOWED_EVENTS whitelist, sender validation, postMessage origin check |
| **P1** | **E2E dApp approval flow** — 0 тестов | Расширить `popup-fixture.js` чтобы мокать `dapp-request`/`dapp-approval-response`; написать `dapp-connectivity.spec.js` |
| **P2** | Inline unlock в approval popup (`needsUnlock`) | Integration test: approval с `needsUnlock:true` → password field → unlock RPC → approval response |
| **P2** | `broadcastAccountsChanged` с active wallet filter | Integration test: SW unlock → broadcast в connectedOrigins с filter |
| **P2** | `switchAccount` UX после Phase 2 — multi-mnemonic flow | E2E: Account 1 unlocked → switch to Account 2 с другим паролем → unlock screen показывает правильное имя |
| **P3** | `dapp-demo.html` applyLang() regression (снапшот) | E2E visual snapshot test |
| **P3** | Mutation testing для крипто-модулей | Stryker Mutator на `service-worker.js`, `wallet-core.js`, `network-state.js` |

---

## 5. Root cause анализ: почему `send-eth` регрессия проскочила

Корневая причина — **структурная**:

1. **E2E тесты `send-eth.spec.js`** используют `popup-fixture.js`, который сам мокает `chrome.runtime.sendMessage` handler. Фикстура-мок напрямую обрабатывает `send-eth` и возвращает hash — **не идёт через sender validation реального SW**. Поэтому фикстура не падает когда реальный SW ломается.

2. **Integration тесты** использовали in-memory симуляторы (старый `service-worker-unlock.test.js`) а не реальный SW — аналогично, sender validation не проверялась.

3. **Никто не проверял что `sendToSW` вызовы из popup и whitelist в SW находятся в синке.** Не было linter'а или теста на рассинхронизацию.

**Решение (внедрено в новом sender-validation.test.js):**

- Статический анализ исходников: регексом извлечь все типы сообщений из popup.js и сравнить с whitelist'ом в SW
- Делать это на уровне unit теста (быстро, не требует Playwright)

Этот паттерн можно применить и к другим потенциальным рассинхронизациям:
- URL'ы RPC в popup vs host_permissions в manifest
- Message types в popup vs handler case'ы в SW
- Screen IDs в HTML vs showScreen calls
- data-onclick имена функций vs их определения в globalThis

---

## 6. Как запускать

```bash
# Все unit + integration
npm test

# Только sender validation (критический)
npx vitest run tests/unit/sender-validation.test.js

# Только новые
npx vitest run tests/unit/sender-validation.test.js tests/unit/dapp-approval-xss.test.js

# С watch mode для разработки
npm run test:unit:watch
```

---

## 7. Метрики

### До Phase 3 test coverage work

```
Test Files  15 passed (15)
Tests       251 passed (251)
Duration    ~2.4s
```

### После Phase 3 test coverage work

```
Test Files  17 passed (17)        ← +2 файла (sender-validation, dapp-approval-xss)
Tests       331 passed (331)       ← +80 тестов (+32%)
Duration    ~2.1s
```

**Никаких регрессий в старых тестах.** Все 251 оригинальных теста продолжают работать.

---

## 8. Верификация реальности

Чтобы убедиться что тесты **реально защищают** от регрессий, я провёл контрольный эксперимент:

1. Удалил `'send-eth',` из whitelist'а в `service-worker.js`
2. Запустил `tests/unit/sender-validation.test.js`
3. **3 теста упали** с понятным error message, указывающим на отсутствие `send-eth` в whitelist
4. Восстановил файл

Это подтверждает что новый тест **поймал бы** недавнюю регрессию до релиза.

---

## 9. Рекомендации

### Немедленно (в следующем коммите)

- ✅ 4 критических теста уже добавлены — можно мержить

### Phase 4 (next sprint)

Добавить `tests/unit/inpage-provider.test.js`:
- Через jsdom создать фейковый `window` и проверить `SovaProvider.request()` валидацию
- Тесты на timeout cleanup (TTL)
- Тесты на event emitter max listeners
- EIP-6963 announce event

Добавить `tests/unit/content-script.test.js`:
- Mock `chrome.runtime` и `window`
- Тесты на sender id check + tab null check
- ALLOWED_EVENTS whitelist enforcement

### Phase 5 (следующий major)

Расширить `popup-fixture.js` чтобы поддерживать полный dApp-approval цикл:
- Mock `dapp-request` → `dapp-get-pending` → `dapp-approval-response`
- Mock inline unlock flow
- Mock broadcast events

И написать e2e тесты:
- `tests/e2e/dapp-connect.spec.js`
- `tests/e2e/dapp-sign.spec.js`
- `tests/e2e/dapp-send.spec.js`
- `tests/e2e/multi-mnemonic-switch.spec.js`

Бюджет: ~15-20 часов работы.

---

## 10. Связанные документы

- **`AUDIT-REPORT.md`** — findings, включая CRIT-2 (sender validation), P2-3 (XSS), P2-4 (chainId), CRIT-5 (persistence). Все эти находки теперь имеют regression-guard тесты.
- **`OPTIMIZATION-PLAN.md`** — Phase 4 план содержит «Тесты покрытия», ссылается на этот файл.

---

_Обновлять этот документ при добавлении новых тестов. Последнее обновление — 2026-04-08._
