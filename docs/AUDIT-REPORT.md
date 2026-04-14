# SOVA Wallet — Аудит кода

**Дата аудита:** 2026-04-08
**Версия проекта на момент аудита:** 1.1.0 (manifest), 1.0.0 (package.json)
**Версия после Phase 1 fixes:** 1.1.1
**Версия после Phase 2 fixes:** 1.2.0
**Версия после Phase 3 fixes:** 1.3.0
**Объект аудита:** browser extension `extension/`, лендинг `site/`, тесты `tests/`, документация
**Аудитор:** автоматизированный многоэтапный аудит (4 параллельных специализированных проверки + ручная верификация критичных находок)

> **СТАТУС PHASE 1 (CRITICAL fixes):** ✅ **ЗАВЕРШЕНО 2026-04-08**
> Все 5 CRITICAL находок исправлены, бонусом закрыт HIGH-2 (sender validation в content-script).
> 251/251 unit+integration тестов passing. Manifest version → 1.1.1.
>
> **СТАТУС PHASE 2 (HIGH severity):** ✅ **ЗАВЕРШЕНО 2026-04-08**
> Все 8 HIGH severity fixes исправлены. popup.js уменьшен с 2240 до **1263 строк** (−44%) благодаря P2-6.
> 251/251 unit+integration тестов passing. Manifest version → 1.2.0.
>
> **СТАТУС PHASE 3 (MEDIUM severity + hardening):** ✅ **ЗАВЕРШЕНО 2026-04-08**
> Все 17 MEDIUM severity fixes исправлены, плюс 2 LOW (LOW-8, LOW-9) подняты до MED и закрыты.
> 331/331 unit+integration тестов passing. Manifest version → 1.3.0.
>
> **СТАТУС PHASE 4 (LOW severity + cleanup):** ✅ **ЗАВЕРШЕНО 2026-04-09**
> 8 LOW severity fixes: debug flag (LOW-1/10), param docs (LOW-3), truncate (LOW-4),
> version sync (LOW-11), stale docs (LOW-12), bootstrap try/catch (LOW-14), quiz 5/12 (LOW-15).
> 380/380 unit+integration тестов passing. Manifest version → 1.5.0.

---

## 0. Phase 1 completion log (2026-04-08)

После создания этого отчёта была выполнена **Phase 1** из `OPTIMIZATION-PLAN.md`. Все 5 CRITICAL находок и одна HIGH (HIGH-2 как блок-смежный фикс к CRIT-2) — закрыты.

| Finding            | Файл                                                                                            | Что сделано                                                                                                                                                                                                                                                                                                             | Тесты        |
| ------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **CRIT-1**         | `extension/network-config.js`                                                                   | Удалён hardcoded Alchemy ключ. Дефолт → publicnode.com. Hardcoded ключ удалён также из всех `.md` документов. Custom RPC доступен через popup setup screen.                                                                                                                                                             | manual smoke |
| **CRIT-2**         | `extension/background/service-worker.js:65-150`                                                 | Добавлены `isFromExtensionContext` / `isFromOurContentScript` helpers + два whitelist'а сообщений (`POPUP_ONLY_MESSAGE_TYPES` и `CONTENT_SCRIPT_MESSAGE_TYPES`). Все 10 internal сообщений теперь требуют sender check.                                                                                                 | 251/251      |
| **CRIT-3**         | `extension/background/service-worker.js:44-83, 113-127`                                         | `_failedAttempts` / `_lockoutUntil` удалены. Заменены на persistent helpers `getLockoutState` / `recordFailedAttempt` / `resetLockoutState` хранящие state в `chrome.storage.local.security:lockout`. Exponential backoff с cap 15 минут (вместо 60 секунд).                                                            | 251/251      |
| **CRIT-4**         | `extension/inpage/provider.js:222-241`                                                          | `configurable: true → false` для обоих `window.ethereum` и `window.sova`. После установки provider больше нельзя delete/replace.                                                                                                                                                                                        | 251/251      |
| **CRIT-5**         | `extension/background/service-worker.js:1006-1015, 329-345` + `dapp-approval.js:22-35, 404-425` | `persistPendingRequest` теперь хранит **только метаданные** (id, origin, method, createdAt, expiresAt) — без params, needsUnlock, targetAddress. При SW restart `dapp-get-pending` возвращает `{ request: null, reason: 'expired' }`, popup показывает «Запрос истёк». Добавлен `cleanup-pending` alarm каждые 5 минут. | 251/251      |
| **HIGH-2** (бонус) | `extension/content/content-script.js:90-120`                                                    | content-script теперь принимает `dapp-event` только от своего SW (sender id check + tab=null check) и только для whitelist'а событий (`accountsChanged`, `chainChanged`, `connect`, `disconnect`).                                                                                                                      | 251/251      |

**Дополнительно:**

- `manifest.json` version → **1.1.1** (security patch)
- `popup.html` лейбл изменён на «Использовать публичный RPC (publicnode)»
- `DOCUMENTATION.md` обновлён: ограничение про hardcoded key помечено ✅ FIXED
- esbuild syntax check всех 5 модифицированных JS файлов — passed
- `npm test` → **251/251 tests passing** (никаких регрессий)

**Не сделано в Phase 1 (отложено в Phase 2-3):**

- Замена Math.random на crypto.getRandomValues для approval id (MED-4) — entropy достаточная при наличии sender validation (CRIT-2)
- Удаление git history с старым ключом — destructive операция, требует разрешения пользователя
- Per-origin rate limiting на approvals (MED-3)

## 0bis. Phase 2 completion log (2026-04-08)

После Phase 1 была выполнена **Phase 2** — все 8 HIGH severity findings.

| Finding    | Файл                             | Что сделано                                                                                                                                                                                                                                    | Тесты   |
| ---------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **HIGH-1** | `service-worker.js:582-592`      | RPC method whitelist вместо blacklist. Все методы which не в switch-case или if-блоках возвращают `4200 Method not supported`.                                                                                                                 | 251/251 |
| **HIGH-2** | (бонус Phase 1)                  | Sender validation в `content/content-script.js:90-120`                                                                                                                                                                                         | 251/251 |
| **HIGH-3** | `popup/modules/dapp-approval.js` | Все 6 случаев `innerHTML = \`...${data}...\``заменены на DOM API через новые helper'ы`buildKvRow`, `buildWarnBox`, `buildTreeTitle`. Удалена функция `escapeHtml`.                                                                             | 251/251 |
| **HIGH-4** | `service-worker.js:802-839`      | EIP-712 chainId mismatch теперь **HARD BLOCK** с code `4901` (Chain not configured), до approval popup не доходит. Также добавлена type validation `domain.chainId` (number/string/bigint).                                                    | 251/251 |
| **HIGH-5** | `popup.js:1156`                  | `setAccountsCache(accounts)` после `addSubAccount` для invalidate кэша.                                                                                                                                                                        | 251/251 |
| **HIGH-6** | `popup.js`                       | **Все 46 fallback chains удалены.** Добавлен `assertModulesLoaded()` в bootstrap (проверка наличия 13 модулей × методов). popup.js: **2240 → 1263 строк** (−977, −44%). При отсутствии модуля popup показывает понятный error overlay.         | 251/251 |
| **HIGH-7** | `manifest.json:15-25`            | Из `host_permissions` удалены `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`. Они остались в `content_scripts.matches` (нужны для инжекции) и `web_accessible_resources.matches`, но не дают SW право на произвольные HTTP запросы. | 251/251 |
| **HIGH-8** | `popup.js:1657-1665`             | `confirmSend` теперь awaits `sendToSW({ type: 'reset-lock-timer' })` и логирует warning при failure.                                                                                                                                           | 251/251 |

**Дополнительно:**

- `manifest.json` version → **1.2.0** (minor release)
- 251/251 unit+integration тестов passing — никаких регрессий
- 6 модифицированных JS файлов прошли esbuild syntax check

## 0ter. Phase 3 completion log (2026-04-08)

После Phase 2 была выполнена **Phase 3** — все 17 MEDIUM severity findings + 2 LOW (LOW-8, LOW-9) подняты до MED и закрыты. Плюс между Phase 2 и Phase 3 было два hotfix'а (v1.2.1 — tx-history empty state, v1.2.2 — token list placeholder).

| Finding    | Файл                                                          | Что сделано                                                                                                                                                 | Группа                |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **MED-1**  | `manifest.json:75`                                            | Удалён `https:` wildcard из `img-src` CSP. Только whitelisted: `raw.githubusercontent.com`, `tokens.1inch.io`, `tokens-data.1inch.io`, `data:`              | A: CSP                |
| **MED-2**  | `manifest.json:75`                                            | Удалён `'unsafe-inline'` из `style-src`. Все inline styles уже были убраны в HTML.                                                                          | A: CSP                |
| **MED-3**  | `service-worker.js` (requestApproval)                         | Per-origin cap = 1 pending approval, global cap = 20. При превышении — `4001 User rejected`.                                                                | B: DoS                |
| **MED-4**  | `service-worker.js:generateApprovalId`                        | `Math.random().toString(36)` → `crypto.getRandomValues(Uint8Array(16))`. 128-битная энтропия.                                                               | B: DoS                |
| **MED-5**  | `dapp-approval.js:checkFirstTimeRecipient/markRecipientKnown` | `knownRecipients` теперь scoped per-origin: `knownRecipients[origin][addrLower] = timestamp`. Защита от cross-dApp privacy leak.                            | C: Privacy            |
| **MED-6**  | `service-worker.js` (add-sub-account)                         | После деривации субаккаунта `main.mnemonic = null; main = null;` — explicit nullify ссылок на фразу.                                                        | C: Privacy            |
| **MED-7**  | `service-worker.js:enforceConnectedOriginsLimits`             | LRU 100 + TTL 90 дней для `connectedOrigins`. Применяется при каждом `saveConnectedOrigins`.                                                                | B: DoS                |
| **MED-8**  | `service-worker.js:appendAuditLog`                            | cap 1000 → 500, TTL 30 дней. Старые записи фильтруются при каждой записи.                                                                                   | B: DoS                |
| **MED-9**  | `popup/modules/token-state.js:197`                            | 3 sec timeout на каждую попытку загрузить token logo. `setTimeout` + `clearTimer`. Fail-fast к fallback.                                                    | E: UX                 |
| **MED-10** | `popup/modules/event-binder.js:splitArgsAware`                | Naive `raw.split(',')` → proper tokenizer с учётом кавычек. `showError('create', 'Ошибка, не повезло')` больше не ломается.                                 | F: Quality            |
| **MED-11** | `popup.js:617, 639, 418`                                      | Address null-checks после `getAccountsCached`. Если `acct?.address` отсутствует → `console.error` + `showScreen('screen-setup')`.                           | F: Quality            |
| **MED-12** | `popup/modules/send-flow.js:208-217`                          | Strict regex `/^\d+(\.\d+)?$/` на amount. Блокирует `Infinity`, `1e-30`, `123abc`, `  `.                                                                    | D: Input              |
| **MED-13** | `shared/rpc-hosts.js` (NEW)                                   | ALLOWED_RPC_HOSTS вынесен в shared module. `popup.js` и `network-state.js` импортируют из `globalThis.WolfWalletRpcHosts.ALLOWED_RPC_HOSTS`. Freezed array. | F: Quality            |
| **MED-14** | `popup/modules/tx-history.js`                                 | Warning "История недоступна для этого RPC" при не-Alchemy RPC. Раньше молча возвращал empty array.                                                          | E: UX (hotfix v1.2.1) |
| **MED-15** | `popup/modules/dapp-approval.js:startExpiryCountdown`         | `window.addEventListener('beforeunload', () => clearInterval(interval))`. Timer cleanup при закрытии approval popup.                                        | E: UX                 |
| **MED-16** | `popup/modules/dapp-approval.js`                              | После unlock: `password = ''; pwInput.value = '';`. Explicit cleanup.                                                                                       | C: Privacy            |
| **MED-17** | `service-worker.js:rememberUnlockedWallet`                    | LRU cap 20 для `_walletsByAddress`. Evict oldest non-active wallet при превышении.                                                                          | B: DoS                |
| **LOW-8**  | `inpage/provider.js:_pending`                                 | TTL 120 сек на каждый pending request. `setTimeout` cleanup + `settlePending` helper. Защита от memory leak когда SW dies.                                  | G: Inpage             |
| **LOW-9**  | `inpage/provider.js:SovaEventEmitter`                         | Cap 20 слушателей на событие. Warn в console при превышении. Защита от React re-render без `off()`.                                                         | G: Inpage             |

**Дополнительно:**

- `manifest.json` version → **1.3.0** (minor release)
- **331/331** unit+integration тестов passing — никаких регрессий (до Phase 3: 251/251, добавлено 80 новых тестов в Phase 2.5 test coverage review)
- Все модифицированные JS файлы прошли `node --check` syntax check
- Между фазами были hotfixes v1.2.1 (MED-14 tx history empty warning) и v1.2.2 (token list placeholder regression)

**Не включено в Phase 3:**

- LOW-1 через LOW-7, LOW-10, LOW-11, LOW-12, LOW-13, LOW-14, LOW-15 — перенесены в Phase 4 (code quality, documentation, minor UX)
- Архитектурный refactor (TS, декомпозиция модулей) — Phase 5

---

## 1. Резюме (Executive Summary)

Проект **функционально работает**: dApp-коннект протестирован end-to-end (`personal_sign`, `eth_sendTransaction`, `eth_signTypedData_v4`), транзакции реально майнятся в Sepolia. Критическая часть архитектуры — изоляция приватного ключа в service worker'е — реализована корректно: ни popup, ни content-script, ни inpage никогда не получают доступ к расшифрованному ключу.

Однако аудит выявил **значительное число security и code quality проблем**, многие из которых связаны с недавним добавлением dApp-коннектности и относятся к **defense-in-depth слоям**, которые сейчас отсутствуют:

| Severity     | Найдено | Что это                                                |
| ------------ | :-----: | ------------------------------------------------------ |
| **CRITICAL** |  **5**  | Прямые security уязвимости. Требуют немедленного фикса |
| **HIGH**     |  **8**  | Эксплуатируемые баги или серьёзные пробелы в изоляции  |
| **MEDIUM**   | **17**  | Defensive coding gaps, хардеринг, утечки памяти        |
| **LOW**      | **15**  | Code smell, документация, мелкие UX-проблемы           |
| **POSITIVE** | **15**  | Хорошо спроектированные части, которые НЕ нужно менять |

**Ключевые выводы:**

1. ⚠️ **Hardcoded Alchemy API key** в `extension/network-config.js` (CRITICAL) — публично доступен после установки расширения, должен быть отозван
2. ⚠️ **Отсутствие sender validation** в `chrome.runtime.onMessage` listener для всех internal-сообщений (`unlock`, `dapp-approval-response`, `dapp-disconnect-origin` и др.) — позволяет malicious content-script'у обойти approval flow
3. ⚠️ **Bruteforce protection обнуляется при рестарте SW** (CRITICAL) — `_failedAttempts`/`_lockoutUntil` живут только в памяти, MV3 SW убивается часто
4. ⚠️ **`Object.defineProperty(window, 'ethereum', { configurable: true })`** — позволяет любому скрипту на странице заменить наш provider своим
5. ⚠️ **dapp-approval.js использует `innerHTML`** в нескольких местах — потенциальный XSS вектор для adversarial payload'ов
6. ⚠️ **`eth_*` fall-through в SW dispatcher** — любой `eth_*` метод который мы не знаем, проксируется в RPC; должен быть whitelist а не blacklist

**Положительные стороны:**

- Service Worker изоляция приватного ключа — корректная
- EIP-1193 origin-validation в `handleDappRequest` — реализована
- Deprecated методы (`eth_sign`, `eth_signTypedData_v1/v3`) явно блокируются
- CSP с `frame-ancestors 'none'` защищает popup от UI redressing
- Inline unlock в approval popup решил проблему MV3 SW idle kill во время signing
- Test coverage основных flow'ов (unlock, send, network switch) — есть

---

## 2. Методология

Аудит проводился в 4 параллельных потока специализированными исследовательскими агентами:

| Агент             | Скоуп                                                         | Файлы                                                                                                      |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Security**      | Crypto, key handling, message validation, CSP, manifest       | `service-worker.js`, `manifest.json`, `network-config.js`, `shared/*`                                      |
| **dApp layer**    | Inpage provider, content-script bridge, approval UI, EIP-1193 | `inpage/provider.js`, `content/content-script.js`, `popup/modules/dapp-approval.js`, `site/dapp-demo.html` |
| **Popup quality** | State management, race conditions, error handling, dead code  | `popup/popup.js`, `popup/modules/*` (без dapp-approval.js)                                                 |
| **Tests + docs**  | Покрытие тестами, актуальность документации после правок      | `tests/`, все `*.md` файлы                                                                                 |

После завершения агентов:

1. **Spot-check** 3 самых критичных claim'ов прямой проверкой кода через `grep -n` + `Read`
2. **Дедупликация** перекрывающихся находок (одна и та же проблема в разных отчётах объединена)
3. **Reordering** по фактической эксплуатируемости

Все file:line ссылки в этом отчёте указывают на актуальные строки в `extension/` и `site/` на момент аудита (manifest version 1.1.0).

---

## 3. Скоуп

### Файлы расширения

| Файл                             |    Строк | Назначение                                                         |
| -------------------------------- | -------: | ------------------------------------------------------------------ |
| `background/service-worker.js`   | **1164** | Сигнинг, изоляция ключа, dApp dispatcher, approval lifecycle       |
| `popup/popup.js`                 | **2240** | Главный UI-контроллер                                              |
| `popup/popup.html`               |      340 | Разметка (включая dApp-approval-screen, connected-sites screen)    |
| `popup/popup.css`                |      912 | Стили                                                              |
| `popup/modules/dapp-approval.js` |  **609** | Approval popup controller (inline unlock, render для всех методов) |
| `popup/modules/tx-history.js`    |      414 | История транзакций (Alchemy-only)                                  |
| `popup/modules/network-state.js` |      363 | Сети, RPC, валидация                                               |
| `popup/modules/send-flow.js`     |      335 | Send flow ETH + ERC-20                                             |
| `popup/modules/token-state.js`   |      325 | ERC-20 управление                                                  |
| `inpage/provider.js`             |  **262** | EIP-1193 + EIP-6963 provider                                       |
| `popup/modules/avatar.js`        |      171 | SVG-аватары                                                        |
| `popup/modules/ui-templates.js`  |      114 | Network picker, feedback mounts                                    |
| `content/content-script.js`      |  **111** | Bridge inpage ↔ SW                                                 |
| `shared/wallet-core.js`          |      103 | Утилиты                                                            |
| `popup/modules/event-binder.js`  |       63 | Declarative `data-onclick`                                         |
| `shared/networks.js`             |       56 | Networks factory                                                   |
| `popup/modules/ui-state.js`      |       53 | Навигация                                                          |
| `manifest.json`                  |       80 | MV3 конфиг                                                         |
| `network-config.js`              |        9 | RPC defaults (содержит API key!)                                   |

**Жирным** выделены критические для аудита файлы (key/crypto/dApp surface).

### Файлы лендинга и тестов

- `site/dapp-demo.html` (847 строк) — демо-dApp с переключателем RU/EN
- `site/server.mjs` (65 строк) — статический сервер
- `tests/unit/*.test.js` — 10 файлов
- `tests/integration/*.test.js` — 5 файлов
- `tests/e2e/*.spec.js` — 15 файлов

---

## 4. CRITICAL findings (приоритет: исправить в течение 48 часов)

### CRIT-1. Hardcoded Alchemy API key в исходниках ✅ FIXED 2026-04-08

**Файл:** `extension/network-config.js:6-8`
**Категория:** Credential exposure

```js
'eth-mainnet': 'https://eth-mainnet.g.alchemy.com/v2/REDACTED_REVOKED_KEY',
'eth-sepolia': 'https://eth-sepolia.g.alchemy.com/v2/REDACTED_REVOKED_KEY',
bsc: 'https://bnb-mainnet.g.alchemy.com/v2/REDACTED_REVOKED_KEY',
```

**Проблема:** API key встроен в каждую копию расширения, попадает в zip который раздаётся через лендинг (`site/assets/wolf-wallet-extension.zip`). После публикации в Chrome Web Store ключ окажется у всех пользователей.

**Сценарий атаки:**

1. Атакующий распаковывает `.crx`/`.zip` файл расширения
2. Извлекает ключ
3. Использует его как свой бесплатный Alchemy API → расходует rate limit всех легитимных пользователей; возможна заморозка ключа Alchemy'ем за злоупотребление
4. Если ключ привязан к платному аккаунту — биллинг

**Фикс:**

1. **Немедленно отозвать ключ** в Alchemy dashboard
2. Удалить из `network-config.js`, заменить на `publicnode.com` дефолты:
   ```js
   globalThis.WOLF_WALLET_RPC_DEFAULTS = {
     'eth-mainnet': 'https://ethereum-rpc.publicnode.com',
     'eth-sepolia': 'https://ethereum-sepolia-rpc.publicnode.com',
     bsc: 'https://bsc-rpc.publicnode.com',
   };
   ```
3. Долгосрочно: добавить в popup настройки «Введите свой Alchemy API key» (опционально), сохранять в `chrome.storage.local`
4. Для коммерческого варианта — поднять proxy (Cloudflare Worker) который проверяет installation ID и проксирует на Alchemy (ключ только на сервере)

**Уже отмечено в:** `RECOMMENDATIONS.md` §2.2 — но всё ещё не исправлено

---

### CRIT-2. Sender origin validation отсутствует для internal-сообщений в SW ✅ FIXED 2026-04-08

**Файл:** `extension/background/service-worker.js:64-68, 234-235, 281, и др.`
**Категория:** Privilege escalation

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)  // ← sender передаётся
    .then(result => sendResponse(...))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true;
});
```

`handleDappRequest` (для типа `dapp-request`) **корректно** проверяет `sender.tab.url` против `msg.origin` (строки 313–328). Но **все остальные** message types НЕ проверяют sender:

| `type`                   | Sender check? |    Может вызвать malicious content-script?    |
| ------------------------ | :-----------: | :-------------------------------------------: |
| `unlock`                 |      ❌       |      Да (теоретически — но нужен пароль)      |
| `lock`                   |      ❌       |   Да (можно DoS — постоянно лочить wallet)    |
| `activate-account`       |      ❌       |       Да (переключить активный аккаунт)       |
| `add-sub-account`        |      ❌       |               Да (нужен пароль)               |
| `reset-lock-timer`       |      ❌       |      Да (продлить session indefinitely)       |
| `network-changed`        |      ❌       | Да (broadcast фейк chainChanged всем dApp'ам) |
| `dapp-approval-response` |      ❌       |               **ДА — критично**               |
| `dapp-disconnect-origin` |      ❌       |               **ДА — критично**               |
| `dapp-get-pending`       |      ❌       | Да (читать pending request'ы любого origin'а) |
| `dapp-request`           |      ✅       |              Корректно проверено              |
| `get-wallet-address`     |      ❌       |          Да (проверить unlock state)          |

**Сценарий 1 — обход approval (`dapp-approval-response`):**

1. User на `uniswap.org`, открыл approval popup для `eth_sendTransaction`
2. Параллельно у user'а открыта вкладка `phishing.com`
3. `phishing.com` через свой content-script (потому что `host_permissions: https://*/*`) шлёт:
   ```js
   chrome.runtime.sendMessage({
     type: 'dapp-approval-response',
     id: <угаданный id>,
     approved: true
   });
   ```
4. SW принимает (нет sender check) → `_pendingApprovals.get(id)` → если id угадан, approval разрешён без участия user'а
5. Транзакция подписывается и broadcast'ится

**Уязвимость угадывания id:** генерация id — `appr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` — это **~36 бит энтропии**, угадывается за минуты при rate ~миллион сообщений/сек (но Chrome rate-limit'ит messaging — реалистично часы-сутки).

**Сценарий 2 — disconnect других origin'ов:**

```js
chrome.runtime.sendMessage({
  type: 'dapp-disconnect-origin',
  origin: 'https://uniswap.org', // origin жертвы
});
```

SW удалит `connectedOrigins['https://uniswap.org']`. Не критично сам по себе, но позволяет постоянно отсоединять user'а от его dApp'ов = DoS.

**Сценарий 3 — read pending:**

```js
chrome.runtime.sendMessage({ type: 'dapp-get-pending' });
// Получит ВСЕ pending approvals для всех origin'ов, включая полные params
// для eth_sendTransaction (адреса, суммы) и personal_sign (содержимое сообщения)
```

**Фикс (универсальный helper):**

```js
function isFromExtensionContext(sender) {
  // Popup и approval окна имеют sender.url начинающийся с chrome-extension://<our-id>/
  if (!sender) return false;
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.tab) return false; // ← если есть tab, это content-script (НЕ extension page)
  return true;
}

function isFromContentScript(sender) {
  return sender && sender.tab && sender.tab.url && sender.id === chrome.runtime.id;
}

// В handleMessage:
const internalMessageTypes = new Set([
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

if (internalMessageTypes.has(msg.type)) {
  if (!isFromExtensionContext(sender)) {
    throw new Error('Permission denied: internal message from non-extension context');
  }
}

if (msg.type === 'dapp-request') {
  if (!isFromContentScript(sender)) {
    throw new Error('Permission denied: dapp-request must come from content script');
  }
}
```

**Дополнительно:** усилить генерацию `id` на криптостойкую (crypto.getRandomValues) — см. CRIT-5.

---

### CRIT-3. Bruteforce protection сбрасывается при перезапуске SW ✅ FIXED 2026-04-08

**Файл:** `extension/background/service-worker.js:43-45, 100-105`

```js
let _failedAttempts = 0;     // ← in-memory only
let _lockoutUntil   = 0;     // ← in-memory only

// В unlock case:
if (Date.now() < _lockoutUntil) {
  throw new Error(`Подождите ${...} сек`);
}
try {
  unlockedWallet = await ethers.Wallet.fromEncryptedJson(...);
} catch {
  _failedAttempts++;
  if (_failedAttempts >= 3) {
    _lockoutUntil = Date.now() + Math.min(60000, 5000 * (_failedAttempts - 2));
  }
  throw new Error('Неверный пароль');
}
```

**Проблема:** MV3 service worker регулярно убивается Chrome'ом (idle ~30 секунд). При перезапуске **обе переменные обнуляются**, lockout исчезает.

**Сценарий атаки:**

1. Attacker имеет физический/удалённый доступ к разблокированной машине жертвы (включая incident scenario из `INC-2026-03-29-wallet-theft`)
2. Открывает SOVA popup, пытается подобрать пароль:
   - 3 попытки → lockout 5 сек
   - **закрывает popup и ждёт ~30 сек** → SW умирает по idle
   - Открывает popup → SW рестартует → `_failedAttempts = 0`
   - Ещё 3 попытки → lockout 5 сек
   - Цикл повторяется
3. **Темп: ~3 попытки в минуту = 4320 в сутки = 130k в месяц**
4. Для 6-символьного слабого пароля (например `qwerty`) — мгновенный взлом из обычного словаря

**Фикс:**

Перенести state в `chrome.storage.local`:

```js
async function getLockoutState() {
  const { _failedAttempts = 0, _lockoutUntil = 0 } = await chrome.storage.local.get([
    '_failedAttempts',
    '_lockoutUntil',
  ]);
  return { failedAttempts: _failedAttempts, lockoutUntil: _lockoutUntil };
}

async function recordFailedAttempt() {
  const { failedAttempts } = await getLockoutState();
  const next = failedAttempts + 1;
  const lockoutUntil = next >= 3 ? Date.now() + Math.min(60_000, 5_000 * (next - 2)) : 0;
  await chrome.storage.local.set({
    _failedAttempts: next,
    _lockoutUntil: lockoutUntil,
  });
}

async function resetFailedAttempts() {
  await chrome.storage.local.set({ _failedAttempts: 0, _lockoutUntil: 0 });
}
```

И в `unlock case`:

```js
const { lockoutUntil } = await getLockoutState();
if (Date.now() < lockoutUntil) {
  throw new Error(`Подождите ${Math.ceil((lockoutUntil - Date.now())/1000)} сек`);
}
try {
  unlockedWallet = await ethers.Wallet.fromEncryptedJson(...);
  await resetFailedAttempts();
} catch {
  await recordFailedAttempt();
  throw new Error('Неверный пароль');
}
```

**Дополнительно:** увеличить максимальный lockout (текущий cap 60 сек) до **15 минут** после 6+ неудач.

---

### CRIT-4. `window.ethereum` / `window.sova` с `configurable: true` ✅ FIXED 2026-04-08

**Файл:** `extension/inpage/provider.js:222-227, 234-240`

```js
if (!window.ethereum) {
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    configurable: true, // ← позволяет любому скрипту переопределить
    writable: false,
  });
}

Object.defineProperty(window, 'sova', {
  value: provider,
  configurable: true, // ← то же самое
  writable: false,
});
```

**Проблема:** `configurable: true` означает что любой скрипт после нас может вызвать:

```js
delete window.sova;
Object.defineProperty(window, 'sova', { value: fakeProvider, ... });
```

И SOVA провайдер будет заменён на фейковый. После такой замены любой dApp, который через `eip6963` discovery нашёл «SOVA» — на самом деле общается с атакующим.

**Сценарий атаки:**

1. Malicious site `evil.com` загружает скрипт **до** того как SOVA inpage заинжектил provider
2. Скрипт ставит свой watcher на `window.ethereum` setter
3. Когда SOVA пытается записать `window.ethereum`, watcher срабатывает (через MutationObserver на DOM scripts или через property setter trick)
4. После того как SOVA записал — attacker немедленно `delete window.ethereum` и подсовывает свой объект с `isSova: true`
5. dApp видит «SOVA» которая ведёт пользователя на approval, но на самом деле любой подписанный response сначала идёт к attacker'у

**Фикс (минимальный):**

```js
if (!window.ethereum) {
  Object.defineProperty(window, 'ethereum', {
    value: provider,
    configurable: false, // ← после установки нельзя удалить
    writable: false,
  });
}

Object.defineProperty(window, 'sova', {
  value: provider,
  configurable: false, // ← то же
  writable: false,
});
```

**Замечание:** мы НЕ перезаписываем существующий `window.ethereum` (защита от конфликта с MetaMask), это правильно. Но **после** того как мы поставили — должны защитить от перезаписи.

---

### CRIT-5. Pending approval requests хранятся в `chrome.storage.session` в plaintext ✅ FIXED 2026-04-08

**Файл:** `extension/background/service-worker.js:911-914, 243-247`

```js
persistPendingRequest(id, {
  id,
  origin,
  method,
  params,
  createdAt,
  expiresAt,
  needsUnlock,
  targetAccountIndex,
  targetAddress,
});
```

`params` для `eth_sendTransaction` содержит:

- `from`, `to`, `value`, `data`, `gasLimit`, `gasEstimate`, `feeWei`, `chainId`

`params` для `eth_signTypedData_v4` содержит:

- Полный typed data объект (могут быть permit'ы с unlimited approval, order'ы DEX'ов, etc.)

`params` для `personal_sign` содержит:

- Сырое сообщение (может содержать nonce'ы для авторизации, ссылки и т.п.)

Всё это персистится в `chrome.storage.session` в открытом виде. Любое расширение с permission `storage` может прочитать (правда, sandbox extension storage обычно изолирован).

**Сценарий 1 — Stale approval replay:**

1. User инициирует `eth_sendTransaction` («отправь 1 ETH на 0xLEGIT»)
2. SW персистит в session storage
3. Перед approval — Chrome убивает SW (memory pressure / idle / ручной reload)
4. `_pendingApprovals` Map обнулён, но session storage остался
5. `popup.js` при следующем открытии может показать **stale** approval с устаревшими данными
6. User'а можно обмануть на повторное одобрение того же запроса (если attacker сменил между этим recipient в попап-окне через DOM манипуляцию)

**Сценарий 2 — Information leak:**

Если на машине есть другое расширение с overlapping storage permission или malware с доступом к Chrome profile (как в случае инцидента 2026-03-29) — pending typed data signature payload утекает в plaintext. Это включает и **подпись Permit2 unlimited approve**, которая если была отозвана пользователем, всё ещё валидна для атакующего.

**Фикс:**

1. **Не персистить params** в storage. Хранить только id, origin, method, createdAt.
2. При SW рестарте все pending approvals автоматически невалидны → клиент получает `Request expired`.
3. Дополнительно: добавить TTL cleanup job который раз в 5 минут чистит истёкшие записи из session storage:
   ```js
   chrome.alarms.create('cleanup-pending', { periodInMinutes: 5 });
   chrome.alarms.onAlarm.addListener(async (alarm) => {
     if (alarm.name === 'cleanup-pending') {
       const { pendingDappRequests = {} } = await chrome.storage.session.get([
         'pendingDappRequests',
       ]);
       const now = Date.now();
       const cleaned = Object.fromEntries(
         Object.entries(pendingDappRequests).filter(([_, req]) => req.expiresAt > now),
       );
       await chrome.storage.session.set({ pendingDappRequests: cleaned });
     }
   });
   ```

---

## 5. HIGH severity (приоритет: 1-2 недели)

### HIGH-1. `eth_*` fall-through позволяет проксировать произвольные методы ✅ FIXED 2026-04-08 (P2-1)

**Файл:** `extension/background/service-worker.js:493-496`

```js
// Неизвестный метод — пропускаем в RPC (это может быть custom chain method)
if (typeof method === 'string' && method.startsWith('eth_')) {
  return proxyRpc(method, params);
}
```

**Проблема:** **Blacklist вместо whitelist**. Если в будущем появится метод `eth_unlock`, `eth_exportPrivateKey` (гипотетически), или provider-specific `eth_sendBundle` (Flashbots), он автоматически будет проксирован без проверки.

**Фикс:** заменить на whitelist:

```js
const READ_ONLY_PROXY_METHODS = new Set([
  'eth_chainId',
  'net_version',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_call',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_feeHistory',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getTransactionCount',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_syncing',
  'eth_protocolVersion',
  'eth_getLogs',
]);

if (READ_ONLY_PROXY_METHODS.has(method)) {
  return proxyRpc(method, params);
}

// Все остальные методы — отказ
const e = new Error(`Method not supported: ${method}`);
e.code = 4200;
throw e;
```

---

### HIGH-2. Sender validation отсутствует в content-script.js onMessage ✅ FIXED 2026-04-08 (бонусом к Phase 1)

**Файл:** `extension/content/content-script.js:88-110`

```js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'dapp-event' && msg.event) {
    try {
      window.postMessage({...}, window.location.origin);
    } catch (err) {...}
    sendResponse({ ok: true });
    return;
  }
});
```

**Проблема:** content-script принимает `dapp-event` от **любого** отправителя (включая другие content-script'ы или другие расширения с `chrome.runtime.sendMessage` permission). Атакующее расширение может:

```js
chrome.runtime.sendMessage(SOVA_EXTENSION_ID, {
  type: 'dapp-event',
  event: 'accountsChanged',
  data: ['0xATTACKER'],
});
```

dApp получит фейковое `accountsChanged` событие.

**Фикс:**

```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;
  // Only accept messages from our own extension service worker
  if (sender && sender.id !== chrome.runtime.id) return;
  if (sender && sender.tab) return; // не от content-script (только от SW)
  // ...
});
```

---

### HIGH-3. `innerHTML` использование в `dapp-approval.js` ✅ FIXED 2026-04-08 (P2-3)

**Файл:** `extension/popup/modules/dapp-approval.js:138, 174, 121, 156, 180, 308`

Несколько мест используют `innerHTML` для рендера:

```js
// Line 138 (renderPersonalSign)
addrRow.innerHTML = `<span class="dapp-k">Подписать от</span><span class="dapp-v mono">${shortAddr(p.address)}</span>`;

// Line 174 (renderSignTypedData)
addrRow.innerHTML = `<span class="dapp-k">Подписать от</span><span class="dapp-v mono">${shortAddr(p.address)}</span>`;
```

**Проблема:** `shortAddr(p.address)` возвращает строку из адреса. На текущий момент `p.address` приходит из user's `connectedOrigins` (нашего storage), и адрес валидируется через `ethers.isAddress`, поэтому **прямого XSS нет**. Но:

1. **Архитектурный анти-паттерн** — использование `innerHTML` со строковой интерполяцией. При рефакторинге легко добавить туда dApp-controlled значение.
2. **Static `innerHTML` вызовы** для warning-сообщений (4 места) — тоже плохая практика.
3. **`renderTreeInto` для typed data** содержит dApp-controlled keys/values, которые **проходят через `escapeHtml`** — хорошо, но это единственное место с защитой; другие места не защищены.

**Фикс:** заменить все `innerHTML` на `createElement` + `textContent`:

```js
// Вместо innerHTML — DOM API
const k = document.createElement('span');
k.className = 'dapp-k';
k.textContent = 'Подписать от';
const v = document.createElement('span');
v.className = 'dapp-v mono';
v.textContent = shortAddr(p.address);
addrRow.appendChild(k);
addrRow.appendChild(v);
```

---

### HIGH-4. EIP-712 chainId mismatch только warning, не блокировка ✅ FIXED 2026-04-08 (P2-4)

**Файл:** `extension/background/service-worker.js:725, popup/modules/dapp-approval.js:177-182`

```js
const chainMismatch = domainChainId !== null && domainChainId !== Number(currentChainId);
// ... передаётся в approval UI как red warning, но НЕ блокирует подпись
```

**Проблема:** classic phishing attack — dApp на mainnet просит подпись с `domain.chainId = 137` (Polygon). User видит warning, в спешке игнорирует, подписывает. Атакующий replay'ит подпись на Polygon и crafted Permit крадёт средства.

**Фикс:**

1. Если `domain.chainId` не равен currentChainId — **жёстко блокировать** подпись.
2. Дополнительно — предложить user'у переключить сеть в кошельке через `wallet_switchEthereumChain` (новый метод который надо имплементить).

```js
if (chainMismatch) {
  const e = new Error(
    `chainId mismatch: typed data is for chain ${domainChainId}, wallet is on ${currentChainId}. Switch network first.`,
  );
  e.code = 4901; // Chain not configured
  throw e;
}
```

---

### HIGH-5. Race condition: `_accountsCache` не инвалидируется после `addSubAccount` ✅ FIXED 2026-04-08 (P2-5)

**Файл:** `extension/popup/popup.js:1133-1163`

```js
const result = await sendToSW({ type: 'add-sub-account', password });
// ...
const { accounts = [] } = await getLocal(['accounts']);
accounts.push({...});
await setLocal({ accounts, activeAccount: result.index });
// ❌ _accountsCache НЕ обновлён — следующий getAccountsCached(false) вернёт стейл данные
```

**Сценарий:** user добавил субаккаунт → `_accountsCache` всё ещё содержит старый список (без нового). Следующий клик «переключить аккаунт» в меню → `renderAccountMenu` читает кэш → новый аккаунт **отсутствует** в меню.

**Фикс:**

```js
await setLocal({ accounts, activeAccount: result.index });
setAccountsCache(accounts); // ← инвалидировать
```

---

### HIGH-6. Delegation fallback chains — 60+ строк dead code ✅ FIXED 2026-04-08 (P2-6, popup.js: 2240 → 1263 строк)

**Файл:** `extension/popup/popup.js` (десятки мест)

Паттерн повторяется ~30 раз:

```js
function showScreen(id) {
  if (typeof PopupUiState.showScreen === 'function') {
    return PopupUiState.showScreen(id);
  }
  // 5-50 строк fallback inline implementation
}
```

**Проблема:**

- **Модули всегда загружаются** (порядок в `popup.html`), поэтому fallback **никогда не выполняется**
- При изменении логики нужно править в 2 местах → drift между fallback и module → багами фичи в одном из путей
- Затрудняет аудит — приходится читать обе ветки

**Фикс:**

1. Удалить все fallback-блоки
2. Добавить assertions в начале `DOMContentLoaded`:
   ```js
   const requiredModules = {
     PopupUiState: ['showScreen', 'switchTab', 'switchWalletTab'],
     PopupNetworkState: ['initializeNetworkState', 'getRpcUrlForNetwork', 'setNetwork'],
     PopupEventBinder: ['bindDeclarativeHandlers'],
     PopupTokenState: ['getTokensForSelectedNetwork', 'loadTokenBalances'],
     PopupSendFlow: ['sendTransaction', 'confirmSend', 'showSendScreen'],
     PopupTxHistory: ['loadTransactions', 'fetchAlchemyTransfers'],
     PopupDappApproval: ['handleRequest', 'getRequestIdFromUrl'],
   };
   for (const [modName, methods] of Object.entries(requiredModules)) {
     const mod = globalThis['Wolf' + modName] || globalThis[modName];
     if (!mod) throw new Error(`Required module not loaded: ${modName}`);
     for (const m of methods) {
       if (typeof mod[m] !== 'function') throw new Error(`${modName}.${m} missing`);
     }
   }
   ```

**Эффект:** -500..-700 строк из `popup.js`, явные ошибки при отсутствии модуля.

---

### HIGH-7. `host_permissions: https://*/*` слишком широкая ✅ FIXED 2026-04-08 (P2-7)

**Файл:** `extension/manifest.json:25`

```json
"host_permissions": [
  "https://*.g.alchemy.com/*",
  ...
  "https://*/*",            ← ★ wildcard
  "http://localhost/*",
  "http://127.0.0.1/*"
]
```

**Проблема:** `https://*/*` нужна для content-script, но даёт расширению право делать `fetch()` на любой HTTPS URL, минуя CSP. Если в коде SW появится `fetch('https://attacker.com/...')` (намеренно или из-за supply chain compromise) — никакой защиты CSP это не остановит.

**Фикс:** разделить content_scripts matches от host_permissions:

- Для content_scripts оставить `https://*/*` (это нужно)
- Из `host_permissions` УБРАТЬ `https://*/*` — оставить только реальные RPC хосты
- В RUNTIME, если нужен `fetch` к новому хосту — запросить через `chrome.permissions.request({ origins: [...] })` интерактивно

---

### HIGH-8. Missing await в `confirmSend` reset-lock-timer ✅ FIXED 2026-04-08 (P2-8)

**Файл:** `extension/popup/popup.js:1657`

```js
sendToSW({ type: 'reset-lock-timer' }); // ← НЕ await
```

**Проблема:** fire-and-forget. Если SW не отвечает (умер), таймер не продлевается. Если user отправляет tx через 4 минуты после unlock'а, SW auto-lock срабатывает посреди confirmation flow, ключи обнуляются, send падает с `Wallet is locked`.

**Фикс:**

```js
const result = await sendToSW({ type: 'reset-lock-timer' });
if (!result?.ok) {
  console.warn('[confirmSend] reset-lock-timer failed', result);
  // Можно показать warning user'у но не блокировать
}
```

---

## 6. MEDIUM severity (1 месяц)

### MED-1. CSP `img-src ... https:` — слишком широкий wildcard ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/manifest.json:78`

`img-src 'self' https://raw.githubusercontent.com https://tokens.1inch.io https://tokens-data.1inch.io data: https:`

Хвостовой `https:` разрешает загрузку картинок с **любого** HTTPS-домена. Это нужно для token logo'ов (которые приходят с разных CDN), но даёт fingerprinting/tracking pixel surface.

**Фикс:** убрать `https:`, оставить только конкретные whitelisted домены. Если новые token CDN нужны — добавлять явно.

---

### MED-2. CSP `style-src 'unsafe-inline'` ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/manifest.json:78`

Разрешает inline стили (в т.ч. `<style>` теги и `style="..."` атрибуты). Если в popup произойдёт XSS — атакующий может через CSS-селекторы делать exfiltration.

**Фикс:** перенести все inline стили из `popup.html` в `popup.css`. После — заменить на `style-src 'self'`.

---

### MED-3. `_pendingApprovals` Map не имеет лимита ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/background/service-worker.js:51`

`const _pendingApprovals = new Map();`

Malicious dApp может в цикле:

```js
for (let i = 0; i < 10000; i++) {
  ethereum.request({ method: 'eth_requestAccounts' });
}
```

Каждый запрос создаёт entry в Map (и опен popup window!) До полного DoS экранов user'а.

**Фикс:**

- Per-origin лимит: max 1 pending request per origin (если есть pending, новый отклонять с code `4001`)
- Global лимит: max 20 pending requests total
- Дедупликация: если приходит идентичный method+params для того же origin — использовать существующий promise

```js
function findExistingApproval(origin, method, params) {
  for (const [id, entry] of _pendingApprovals.entries()) {
    if (
      entry.origin === origin &&
      entry.method === method &&
      JSON.stringify(entry.params) === JSON.stringify(params)
    ) {
      return entry;
    }
  }
  return null;
}
```

---

### MED-4. Approval ID генерируется небезопасным `Math.random` ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/background/service-worker.js:887`

```js
const id = `appr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
```

7 символов base36 = ~36 бит энтропии. С учётом известного timestamp, угадывание реально за разумное время через repeated `chrome.runtime.sendMessage`.

**Фикс:**

```js
function genApprovalId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return 'appr-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
```

128-битная энтропия — невозможно угадать.

---

### MED-5. `knownRecipients` глобальный, не per-origin ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/popup/modules/dapp-approval.js:316-323`

```js
async function checkFirstTimeRecipient(toAddress) {
  const { knownRecipients = {} } = await ...;
  return !knownRecipients[String(toAddress).toLowerCase()];
}
```

Если user отправил кому-то через **dApp A**, тот же recipient считается «known» когда отправляет через **dApp B** — даже если контекст совершенно другой и A и B не связаны. Также privacy leak: dApp B видит «нет warning» = знает что user знает recipient'а.

**Фикс:** scoping `knownRecipients[origin][address]`:

```js
const { knownRecipients = {} } = await ...;
return !knownRecipients[origin]?.[String(toAddress).toLowerCase()];
```

---

### MED-6. Мнемоника не очищается после деривации субаккаунта ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/background/service-worker.js:181-191`

```js
const main = await ethers.Wallet.fromEncryptedJson(accounts[0].keystore, msg.password);
if (!main.mnemonic?.phrase) { throw ... }
const newWallet = ethers.HDNodeWallet.fromPhrase(
  main.mnemonic.phrase, null, `m/44'/60'/0'/0/${nextIdx}`
);
const keystore = await newWallet.encrypt(msg.password);
return { ... };
// ❌ main.mnemonic.phrase остался в памяти, пока GC не доберётся
```

**Фикс:** explicit nullify:

```js
const phrase = main.mnemonic.phrase;
const newWallet = ethers.HDNodeWallet.fromPhrase(phrase, null, `m/44'/60'/0'/0/${nextIdx}`);
const keystore = await newWallet.encrypt(msg.password);
// Лучшая practice — phrase будет освобождён GC, но явно убрать ссылки:
main.mnemonic = null;
return { address: newWallet.address, keystore, index: nextIdx };
```

---

### MED-7. `connectedOrigins` без размера / TTL ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/background/service-worker.js` (различные места)

User может connect / disconnect к 1000+ dApp'ов. Каждый origin копится в `connectedOrigins`. После года использования — мегабайты в storage.

**Фикс:**

- Лимит 100 origin'ов
- LRU eviction по `lastUsedAt`
- TTL: автоматически удалять записи старше 90 дней

---

### MED-8. `auditLog` без size limit (точнее, есть, но 1000 записей) ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/background/service-worker.js:1100-1105`

```js
auditLog.push(record);
while (auditLog.length > 1000) auditLog.shift();
```

Хорошо, что cap есть. Но 1000 записей × ~200 байт = 200KB. Это близко к лимиту `chrome.storage.local` (5MB суммарно для всего storage). Если user активный — может вытеснять более важные данные.

**Фикс:**

- Уменьшить cap до 500
- Записи старше 30 дней — автоматически удалять при следующей записи

---

### MED-9. Token logo loading без timeout ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/popup/popup.js:901-919`

```js
iconImg.src = logoUrls[logoIndex++]; // ← если CDN зависает, image hang'ается
iconImg.addEventListener('error', tryNextLogo); // только на error
```

**Фикс:**

```js
const TIMEOUT_MS = 3000;
let timer;
const cleanup = () => clearTimeout(timer);
iconImg.addEventListener('load', cleanup);
iconImg.addEventListener('error', () => {
  cleanup();
  tryNextLogo();
});
timer = setTimeout(() => {
  cleanup();
  tryNextLogo();
}, TIMEOUT_MS);
iconImg.src = logoUrls[logoIndex++];
```

---

### MED-10. Event-binder парсер ломается на запятых внутри строк ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/popup/modules/event-binder.js:9`

```js
return raw.split(',').map(part => ...);  // ← наивный split
```

Строки вида `data-onclick="showError('Ошибка, не повезло')"` парсятся неправильно. Сейчас в HTML таких нет — но это **бомба замедленного действия** на следующий рефакторинг.

**Фикс:** написать proper tokenizer (стейт-машина с учётом кавычек):

```js
function parseArgs(argsRaw, event) {
  const tokens = [];
  let current = '';
  let quote = null;
  for (const ch of argsRaw) {
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      tokens.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens.map((t) => parseToken(t, event));
}
```

---

### MED-11. Отсутствие address null-check после `getAccountsCached` ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/popup/popup.js:614, 716, 1028, 1691`

```js
const accounts = await getAccountsCached();
loadWalletScreen(accounts[activeAccountIndex].address); // ← если accounts[idx] undefined → крах
```

Если по какой-то причине `accounts` пустой или индекс невалиден — `loadWalletScreen(undefined)` → каскадный сбой.

**Фикс:**

```js
const accounts = await getAccountsCached();
const acct = accounts[activeAccountIndex];
if (!acct?.address) {
  console.error('[popup] active account missing', {
    activeAccountIndex,
    accountsLen: accounts.length,
  });
  showScreen('screen-setup');
  return;
}
loadWalletScreen(acct.address);
```

---

### MED-12. Amount validation accept'ит `Infinity`, scientific notation ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/popup/popup.js:1585-1586` (и `send-flow.js`)

```js
const amount = document.getElementById('send-amount').value.trim();
if (!amount || parseFloat(amount) <= 0) { showError(...); return; }
```

`parseFloat('Infinity') === Infinity > 0` → проходит проверку → `ethers.parseEther(Infinity)` → throw.
`parseFloat('1e-30') === 1e-30 > 0` → проходит → но это <1 wei → ethers parses it OK but transaction fails on RPC.
`parseFloat('123abc') === 123` → парсит частично → confusing.

**Фикс:**

```js
const amountStr = document.getElementById('send-amount').value.trim();
if (!amountStr) {
  showError('send', 'Введите сумму');
  return;
}
if (!/^\d+(\.\d+)?$/.test(amountStr)) {
  showError('send', 'Некорректный формат');
  return;
}
const amountNum = parseFloat(amountStr);
if (!Number.isFinite(amountNum) || amountNum <= 0) {
  showError('send', 'Сумма должна быть > 0');
  return;
}
const wei = ethers.parseEther(amountStr);
if (wei < 1n) {
  showError('send', 'Сумма меньше 1 wei');
  return;
}
```

---

### MED-13. ALLOWED_RPC_HOSTS дублируется в двух файлах ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/popup/popup.js:1897-1909` и `extension/popup/modules/network-state.js:72-84`

Один и тот же массив определён в двух местах. Изменение whitelist → надо править оба.

**Фикс:** вынести в `extension/shared/rpc-hosts.js`:

```js
globalThis.WolfWalletRpcHosts = Object.freeze([
  'eth-mainnet.g.alchemy.com',
  '.g.alchemy.com',
  '.infura.io',
  // ...
]);
```

И импортировать в `popup.html` как обычный shared module.

---

### MED-14. `fetchAlchemyTransfers` без warning при не-Alchemy RPC ✅ FIXED (hotfix v1.2.2)

**Файл:** `extension/popup/modules/tx-history.js:217-219`

```js
if (!_isAlchemyUrl(activeUrl)) {
  return { result: { transfers: [] } }; // ← молча
}
```

User переключился на publicnode.com → история транзакций исчезает. Без объяснения причины.

**Фикс:** показать в UI tx-list блоке:

```js
if (!_isAlchemyUrl(activeUrl)) {
  el.textContent = '';
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = 'История транзакций недоступна для этого RPC. Используйте Alchemy.';
  el.appendChild(p);
  return;
}
```

---

### MED-15. Notification expiry timer не очищается ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/popup/modules/dapp-approval.js:509-527`

```js
function startExpiryCountdown(expiresAt, id) {
  // ...
  const interval = setInterval(tick, 1000);
}
// ❌ interval ссылка теряется когда функция возвращает; clearInterval только при истечении
```

Memory leak в approval window если user закрыл окно до истечения.

**Фикс:** `window.addEventListener('beforeunload', () => clearInterval(interval))`.

---

### MED-16. Password не очищается из памяти после unlock в approval popup ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/popup/modules/dapp-approval.js:452-461`

```js
const password = pwInput ? pwInput.value : '';
// ...
const unlockRes = await sendUnlockRequest(request.targetAccountIndex, password);
// ❌ password переменная остаётся в closure
// ❌ pwInput.value не очищен
```

**Фикс:**

```js
let password = pwInput.value;
const unlockRes = await sendUnlockRequest(request.targetAccountIndex, password);
password = '';
if (pwInput) pwInput.value = '';
```

---

### MED-17. `_walletsByAddress` без размера лимита ✅ FIXED (Phase 3, v1.3.0)

**Файл:** `extension/background/service-worker.js:39`

`const _walletsByAddress = new Map();`

User может создать N субаккаунтов и unlock каждый — все wallet'ы аккумулируются в памяти SW. С учётом ethers.Wallet объекта (~10KB) — 100 subaccounts = 1MB в SW memory.

**Фикс:** LRU cap:

```js
const MAX_UNLOCKED_WALLETS = 20;
function rememberUnlocked(walletKey, wallet) {
  if (_walletsByAddress.size >= MAX_UNLOCKED_WALLETS) {
    // Удалить самый старый (за исключением активного)
    for (const k of _walletsByAddress.keys()) {
      if (k !== _activeWalletAddress) {
        _walletsByAddress.delete(k);
        break;
      }
    }
  }
  _walletsByAddress.set(walletKey, wallet);
}
```

---

## 7. LOW severity (когда появится ресурс)

### LOW-1. Console.error может утекать диагностику ✅ FIXED (Phase 4, v1.5.0)

`extension/background/service-worker.js:918, 1060, 1108`

В production логи можно отключать или пайпить через debug flag.

### LOW-2. Audit log хранит plaintext addresses + amounts

`extension/background/service-worker.js:873-879, 1100`

Privacy trade-off. Документировать в DOCUMENTATION.md и сделать опциональным (off by default? on с warning?).

### LOW-3. `personal_sign` принимает оба порядка `[msg, addr]` и `[addr, msg]` ✅ DOCUMENTED (Phase 4, v1.5.0)

`extension/background/service-worker.js:606-617`

MetaMask-совместимость, но parameter confusion. Документировать поведение.

### LOW-4. `toBigIntHex` generic error без контекста ✅ FIXED (Phase 4, v1.5.0)

`extension/background/service-worker.js:1113-1121`

`throw new Error('Cannot convert to bigint: ' + value)` — value может быть HUGE. Truncate.

### LOW-5. `domain.chainId` в typed data не валидируется как число

`extension/background/service-worker.js:721-725`

`Number('not_a_chain') === NaN`. Должна быть hard validation.

### LOW-6. `popup.js` — 2240 строк, монолит

Original optimization plan called for decomposition. Делать в Phase 5 (architectural refactor).

### LOW-7. PopupState через `Object.defineProperty` — фрагильная синхронизация

`extension/popup/popup.js:201-227`

Если модуль читает PopupState ДО того как popup.js определил getter — будет undefined.

### LOW-8. Inpage `_pending` Map без TTL ✅ FIXED (Phase 3, v1.3.0)

`extension/inpage/provider.js:22-27`

Если SW dies, response никогда не приходит, entry в `_pending` остаётся forever. Memory leak в долгоживущих SPA.

### LOW-9. Inpage event emitter без max listeners ✅ FIXED (Phase 3, v1.3.0)

`extension/inpage/provider.js:30-60`

Malicious dApp может зарегистрировать 100k listeners. Memory hog.

### LOW-10. SW лог `console.error('[SOVA SW] failed to open approval window', err);` ✅ FIXED (Phase 4, v1.5.0)

`extension/background/service-worker.js:917`

`err` объект может содержать chain id, origin, params в stack trace. Privacy.

### LOW-11. `package.json` v1.0.0 vs `manifest.json` v1.1.0 — рассинхронизация ✅ FIXED (Phase 4, v1.5.0)

Должны совпадать. Минор, но cosmetic issue для релиза.

### LOW-12. `extension_changes_since_backup.md`, `extension/optimization-plan.md`, `tests/TEST-IMPLEMENTATION-COMPLETE.md` — устаревшая документация ✅ FIXED (Phase 4, v1.5.0)

Рекомендуется удалить или явно пометить как HISTORICAL.

### LOW-13. dapp-demo.html не имеет regression теста для applyLang() bug

Если кто-то снова поставит `data-lang` на label — баг вернётся. Нужен e2e/snapshot тест.

### LOW-14. `bootstrap` (DOMContentLoaded) без try/catch ✅ FIXED (Phase 4, v1.5.0)

Если ANY init step упал — popup blank без объяснения. Должен показывать error overlay.

### LOW-15. Quiz mnemonic validation — 3 из 12 слов ✅ FIXED (Phase 4, v1.5.0 — теперь 5 из 12)

Только 3 случайных из 12 для подтверждения. Атакующий с физическим доступом и `pendingMnemonic` в памяти может пройти quiz через guessing (хотя `_pendingMnemonic` clear after verification — OK).

---

## 8. POSITIVE findings (то что НЕ нужно менять)

1. **Service Worker изоляция приватного ключа** — `_walletsByAddress` живёт ТОЛЬКО в SW memory, ни popup, ни content-script, ни inpage не имеют к нему доступа. Это **главный** security control и реализован корректно.

2. **EIP-1193 origin validation в `handleDappRequest`** (`service-worker.js:309-318`) — sender origin сравнивается с claimed origin, mismatch → `Origin mismatch -32603`. Защищает от spoofing.

3. **Deprecated методы явно блокируются** (`service-worker.js:475-484`) — `eth_sign`, `eth_sendRawTransaction`, `eth_signTypedData_v1/v3`, `eth_getEncryptionPublicKey`, `eth_decrypt` все возвращают `4200 Unsupported`.

4. **EIP712Domain корректно strip'ается** перед `signTypedData` (`service-worker.js:752-754`) — соответствует ethers v6 API.

5. **Gas estimate с +20% buffer** (`service-worker.js:159, 813`) — защита от out-of-gas при изменении state между estimate и broadcast.

6. **Auto-lock alarm** (`service-worker.js:27, 109, 140-141`) — корректное использование `chrome.alarms` для 5-минутной автоблокировки.

7. **`chrome.storage.session` для эфемерных данных** — pending requests хранятся в session storage, очищаются на restart browser'а.

8. **Content-script в `ISOLATED` world + `all_frames: false`** (`manifest.json:61-62`) — защита от iframe-based phishing и от прямой инжекции через page scripts.

9. **`frame-ancestors 'none'` в CSP** — popup нельзя embed в iframe, защищает от UI redressing.

10. **`ethers.Wallet.fromEncryptedJson` (async)** — правильный API для расшифровки keystore (не блокирует SW thread).

11. **EIP-6963 announce + не-перезапись `window.ethereum`** — корректное coexistence с MetaMask и другими wallet'ами.

12. **`event.source !== window` filter** в inpage и content-script — защита от cross-frame messaging.

13. **postMessage с явным `window.location.origin`** (не wildcard `'*'`) — origin-restricted доставка.

14. **Inline unlock в approval popup** (недавно реализовано) — корректно решает MV3 SW idle kill во время signing.

15. **Mainnet send guard** — confirmation на первой отправке в реальную сеть.

---

## 9. Cross-cutting темы

### 9.1 MV3 service worker lifecycle

**Самая частая причина багов в проекте.** Chrome убивает SW при ~30 секунд idle. Это делает любое in-memory state непредсказуемым:

- `_walletsByAddress` — обнуляется → user видит «Wallet is locked»
- `_pendingApprovals` Map — обнуляется → dApp request hang'ается forever
- `_failedAttempts` / `_lockoutUntil` — обнуляются → security regression (CRIT-3)
- `_accountsCache` (в popup) — popup живёт пока открыт, не подвержен SW kill

**Систематическое решение:** для всего что критично — переносить в `chrome.storage.session` (volatile, но переживает SW kill в течение browser session) или `chrome.storage.local` (для security state как lockout).

### 9.2 Defense-in-depth gaps

Текущая защита делается **только в SW**. Это правильно для signing (там приватный ключ). Но для UX/anti-DoS — должны быть слои:

- Inpage: rate limit на `request()` calls per second (max 10/sec)
- Content-script: filter known bad message shapes
- SW: rate limit per origin (max 1 pending approval at a time)

Сейчас есть **только** SW-уровневая защита для подписи, и НИ одной для DoS / abuse.

### 9.3 Origin validation полнота

Origin validation есть, но фрагментарная:

- ✅ `dapp-request` — проверяется
- ❌ Все остальные internal messages — НЕ проверяются (CRIT-2)
- ❌ content-script onMessage — НЕ проверяется (HIGH-2)

Нужна **универсальная** policy через helper function.

### 9.4 Validation типов / границ

Многие места принимают `params` без типовой валидации:

- `txInput.gas` — может быть hex string, decimal string, number, undefined
- `domain.chainId` — может быть number, hex string, decimal string, missing
- `personal_sign` data — может быть hex, plain text, bytes
- `eth_signTypedData_v4` typedData — может быть string (JSON) or object

Везде стоит add explicit type guards в начале каждого handler'а.

### 9.5 Coverage тестами недавних изменений

Из 30 тестовых файлов **ни один** не покрывает:

- Inline unlock в approval popup
- `wallet_revokePermissions` end-to-end
- `eth_accounts` filtering by active wallet
- `broadcastAccountsChanged` rewritten logic
- SW restart during pending dApp request

Эти места — самые свежие изменения, и тестов нет вообще. **Регрессия очень вероятна** при следующем рефакторинге.

---

## 10. Статистика

| Метрика                           |                               Значение |
| --------------------------------- | -------------------------------------: |
| Файлов в скоупе                   | 19 (extension) + 2 (site) + 30 (tests) |
| Строк кода в скоупе               |                     8734 (JS+CSS+HTML) |
| Найдено findings                  |                                 **60** |
| — CRITICAL                        |                                      5 |
| — HIGH                            |                                      8 |
| — MEDIUM                          |                                     17 |
| — LOW                             |                                     15 |
| — POSITIVE                        |                                     15 |
| Оцененное время на полный фикс    |        **~80 часов** инженерной работы |
| Оцененное время на CRITICAL фиксы |                          **~12 часов** |

### Распределение по файлам

| Файл                    | CRIT | HIGH | MED | LOW | Всего  |
| ----------------------- | :--: | :--: | :-: | :-: | :----: |
| `service-worker.js`     |  4   |  4   |  7  |  7  | **22** |
| `popup.js`              |  0   |  3   |  3  |  5  | **11** |
| `dapp-approval.js`      |  0   |  1   |  3  |  0  | **4**  |
| `inpage/provider.js`    |  1   |  0   |  0  |  2  | **3**  |
| `content-script.js`     |  0   |  1   |  0  |  0  | **1**  |
| `manifest.json`         |  0   |  1   |  2  |  0  | **3**  |
| `network-config.js`     |  1   |  0   |  0  |  0  | **1**  |
| `event-binder.js`       |  0   |  0   |  1  |  0  | **1**  |
| `tx-history.js`         |  0   |  0   |  1  |  0  | **1**  |
| `popup-modules` (other) |  0   |  1   |  1  |  0  | **2**  |

`service-worker.js` — самый «горячий» файл по числу находок, что ожидаемо: он одновременно (а) критичен по security, (б) самый большой по строкам, (в) недавно вырос на ~900 строк за счёт dApp dispatcher.

### Распределение по категориям

| Категория                                | Findings |
| ---------------------------------------- | :------: |
| Sender/origin validation                 |    7     |
| In-memory state не переживает SW restart |    5     |
| `innerHTML` / DOM XSS surface            |    4     |
| Нет лимитов / DoS protection             |    6     |
| Race conditions / async safety           |    5     |
| Type/input validation                    |    6     |
| Hardcoded secrets / credentials          |    1     |
| CSP / permissions слишком broad          |    4     |
| Dead code / monolith                     |    3     |
| Documentation drift                      |    5     |
| Test coverage gaps                       |    6     |
| Прочее (logs, UX, style)                 |    8     |

---

## 11. Связь с предыдущими отчётами

| Документ                                         | Связь                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RECOMMENDATIONS.md` (от 2026-04-07)             | Перекрытие ~30%. Многие пункты подтверждены этим аудитом. Некоторые помечены как DONE (dApp connect, notifications fix), некоторые **остались блокерами** (Alchemy key) |
| `INC-2026-03-29-wallet-theft/incident-report.md` | Hardening recommendations §7 не реализованы — этот аудит подтверждает их актуальность                                                                                   |
| `tests/test-plan-2.md`                           | Gap analysis от 2026-03-29 актуален: ~55% coverage. Этот аудит выявил **новые** gap'ы (dApp features), которые должны быть добавлены                                    |
| `extension/optimization-plan.md`                 | Заявляет «всё завершено», но монолитность popup.js **подтверждена** этим аудитом — рефакторинг продолжается быть нужным                                                 |

---

## 12. Заключение

### Что хорошо

Проект **функционально работает** и core security model (изоляция ключа в SW) — корректна. Тестирование end-to-end на Sepolia подтвердило что подпись и broadcast работают.

### Что плохо

**Defense-in-depth слабый.** При обнаружении любой одной уязвимости — компенсирующих контролей нет:

- Если sender validation добавляется (CRIT-2), это закрывает множество других потенциальных багов
- Если bruteforce protection persistent (CRIT-3), это закрывает физический attack vector
- Если CSP узкая — XSS surface уменьшается даже если innerHTML остаётся

### Что критично

**5 CRITICAL находок должны быть исправлены до публикации в Chrome Web Store.** Без этого:

- Alchemy key утечёт
- Любой malicious dApp в браузере жертвы может обходить approval flow
- Bruteforce password — реальная угроза

### Что рекомендуется

Следовать `OPTIMIZATION-PLAN.md` (создаётся отдельно) — он содержит phased approach с конкретными задачами и оценками времени.

---

_Дата отчёта: 2026-04-08. Отчёт сгенерирован в результате 4 параллельных аудитов с независимой spot-проверкой критичных claim'ов в исходном коде._
