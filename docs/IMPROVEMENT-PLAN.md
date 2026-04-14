# План доработок SOVA Wallet → 5 звёзд

---

## 1. UX-безопасность (⭐⭐ → ⭐⭐⭐⭐⭐) — наибольший разрыв

| #   | Доработка                                         | Суть                                                                                                                                                                      | Сложность |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1.1 | ✅ **Password re-auth на mainnet send**           | `_requireMainnetReauth()` в send-flow.js. Перед отправкой на любом mainnet (isTestnet=false) — overlay с запросом пароля через `VERIFY_PASSWORD`. HTML: `#reauth-overlay` | Средняя   |
| 1.2 | ✅ **Предупреждение при отправке на новый адрес** | `_isFirstTimeRecipient()` + `_markRecipientKnown()` в send-flow.js. Жёлтый banner `#new-recipient-warning` + 5с countdown. Per-network tracking                           | Средняя   |
| 1.3 | ✅ **Дневной лимит расходов**                     | `_checkDailyLimit()` / `_recordSpending()` в send-flow.js (0.1 ETH default). Settings UI: `#settings-daily-limit` + today's spending. Превышение → re-auth                | Средняя   |
| 1.4 | ✅ **Экспорт/бэкап seed phrase**                  | `#screen-backup-seed` с re-auth через пароль (keystore decrypt). Blur по умолчанию, click-to-reveal, clipboard copy с авто-очисткой 30с                                   | Лёгкая    |
| 1.5 | ✅ **Auto-lock timeout настраиваемый**            | Сейчас хардкод 5 мин. Дать выбор: 1 / 5 / 15 / 30 мин через Settings. Реализовано: SW `getLockDelayMin()` + popup UI с 4 кнопками                                         | Лёгкая    |

---

## 2. Масштабируемость кода (⭐⭐ → ⭐⭐⭐⭐⭐)

| #   | Доработка                                     | Суть                                                                                                                                                                                                                                              | Сложность |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 2.1 | ✅ **TypeScript миграция (shared/)**          | `wallet-core.ts`, `networks.ts`, `rpc-hosts.ts`, `message-types.ts` — полная типизация, build.js компилирует .ts → .js для SW; popup entry импортирует .ts напрямую; `npm run typecheck`                                                          | Высокая   |
| 2.2 | ✅ **TypeScript миграция (background/)**      | Service worker модули: `sw-security.ts`, `sw-wallet.ts`, `sw-rpc.ts`, `sw-broadcast.ts` — полная типизация. Build.js компилирует background/_.ts → _.js; `tsconfig.json` включает `extension/background/*.ts`; `sw-globals.d.ts` очищен от дублей | Высокая   |
| 2.3 | ✅ **Message type enum**                      | Единый `MessageType` enum в `shared/message-types.ts` с `as const` и type exports. Используется по всей SW кодовой базе                                                                                                                           | Средняя   |
| 2.4 | ✅ **Event bus вместо globalThis**            | `event-bus.js`: pub/sub с `on/once/off/emit/clear`. Events constants (ACCOUNT_SWITCHED, NETWORK_CHANGED, TX_SENT и др.). Интеграция в accounts.js, unlock-flow.js, ui-state.js, network-state.js, send-flow.js. 15 unit-тестов                    | Высокая   |
| 2.5 | ✅ **ES modules для popup**                   | Заменить IIFE + script order на `import/export`. esbuild уже есть — добавить entry point. Реализовано: 30+ модулей с import/export, esbuild бандлит через popup-entry.js                                                                          | Средняя   |
| 2.6 | ✅ **`innerHTML = ''` → `replaceChildren()`** | Все вхождения удалены. Popup модули используют safe DOM helpers (`buildKvRow`, `buildWarnBox`, `replaceChildren`)                                                                                                                                 | Лёгкая    |

---

## 3. Качество кода (⭐⭐⭐ → ⭐⭐⭐⭐⭐)

| #   | Доработка                             | Суть                                                                                                                                                                                                                      | Сложность |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 3.1 | ✅ **ESLint + Prettier**              | Единый стиль. `eslint.config.js` (flat config v9) + `.prettierrc`. `eslint-plugin-security` для авто-детекции XSS/injection. Скрипты: `npm run lint`, `npm run format`                                                    | Лёгкая    |
| 3.2 | ✅ **Централизация магических чисел** | `shared/constants.ts` с TTL, caps, timeouts, alarm names, tx limits, quiz params. Единый источник истины                                                                                                                  | Лёгкая    |
| 3.3 | ✅ **Декомпозиция popup.js**          | Разбить 1263-строчный файл: state wiring → `popup-state-wiring.js`, utils → `popup-utils.js`, bootstrap → существующий `bootstrap.js`. Реализовано: popup.js сокращён до ~211 строк (wiring layer), 30+ модулей извлечены | Средняя   |
| 3.4 | ✅ **Error boundary в popup**         | `error-boundary.js` загружается первым в popup.html. `window.onerror` + `unhandledrejection` → crash-screen с кнопкой перезагрузки. Скрывает `#app`, показывает overlay                                                   | Лёгкая    |
| 3.5 | ✅ **JSDoc на public API модулей**    | Типизация через JSDoc (если TS не принят). Позволяет IDE подсказки без миграции. Реализовано: JSDoc на всех exported функциях send-flow.js, token-state.js, tx-history.js, dapp-approval-render.js                        | Средняя   |

---

## 4. Тестирование (⭐⭐⭐⭐ → ⭐⭐⭐⭐⭐)

| #   | Доработка                              | Суть                                                                                                                                                                                                                                   | Сложность |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 4.1 | ✅ **Coverage threshold**              | `vitest.config.js`: `coverage.thresholds = { lines: 60, functions: 60, branches: 50, statements: 60 }`. Скрипт `npm run test:unit:coverage`                                                                                            | Лёгкая    |
| 4.2 | ✅ **Тесты popup модулей**             | Сейчас слабо покрыты: `send-flow.js`, `token-state.js`, `tx-history.js`, `dapp-approval-render.js`. Реализовано: unit-тесты для всех 4 модулей (send-flow.test.js, token-state.test.js, tx-history.test.js, dapp-approval-xss.test.js) | Средняя   |
| 4.3 | ✅ **E2E с реальным расширением**      | `extension-fixture.js`: `launchWithExtension()` через `chromium.launchPersistentContext` с `--load-extension`. `extension-smoke.spec.js`: 5 тестов (setup screen, SW, console, tabs, network picker). CI-skip (headed only)            | Средняя   |
| 4.4 | ✅ **Mutation testing**                | `stryker-mutator` для проверки качества тестов — процент убитых мутантов. Реализовано: `@stryker-mutator/core` + `vitest-runner`, `stryker.config.mjs` (service-worker.js, network-state.js, wallet-core.ts), `npm run test:mutation`  | Средняя   |
| 4.5 | ✅ **Snapshot тесты для CSP/manifest** | `manifest-snapshot.test.js`: inline snapshot для permissions, snapshot для host_permissions, CSP, web_accessible_resources. Проверка отсутствия unsafe-inline/unsafe-eval                                                              | Лёгкая    |

---

## 5. DevOps (⭐⭐ → ⭐⭐⭐⭐⭐)

| #   | Доработка                              | Суть                                                                                                                                                     | Сложность |
| --- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 5.1 | ✅ **GitHub Actions CI**               | `.github/workflows/ci.yml`: 4 job (lint+format, typecheck, tests, build+verify). Bundle size guard ≤200 KB. Блокирует merge при падении                  | Средняя   |
| 5.2 | ✅ **Pre-commit hooks**                | `husky` + `lint-staged`: ESLint --fix + Prettier перед каждым коммитом. Конфиг в `package.json` lint-staged                                              | Лёгкая    |
| 5.3 | ✅ **Reproducible builds**             | `build.js` генерирует `build-hashes.json` (SHA-256 bundle + ethers + manifest). `npm run build:verify` сверяет хэши. CI job запускает verify после build | Средняя   |
| 5.4 | ✅ **Автоматическая сборка .crx/.zip** | CI `package` job: build → verify → zip (excludes .ts/.map) → upload-artifact. Скрипт `npm run package`                                                   | Средняя   |
| 5.5 | ✅ **Dependabot / Renovate**           | `.github/dependabot.yml`: weekly npm updates, grouped by dev/production deps, limit 10 PRs                                                               | Лёгкая    |

---

## 6. Архитектура безопасности (⭐⭐⭐⭐ → ⭐⭐⭐⭐⭐)

| #   | Доработка                                  | Суть                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Сложность |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| 6.1 | ✅ **Hardware wallet (Ledger)**            | 3-слойная архитектура: `ledger-transport.js` (WebHID APDU framing, 64-byte HID packets), `ledger-eth.js` (getAddress/signTransaction/signPersonalMessage, BIP44 m/44'/60'/0'/0/N), `ledger-ui.js` (подключение, деривация адресов, импорт Ledger-аккаунтов, popup-side signing). Account model: `type: 'ledger'` + derivationPath. Send flow: Ledger аккаунты подписывают в popup через WebHID, software — через SW. 15 unit-тестов. CSS + HTML screen | Высокая   |
| 6.2 | ✅ **RPC fallback для tx-history**         | При ошибке основного провайдера (Moralis/Etherscan) — авто-fallback на Blockscout для eth-mainnet/sepolia. Кэш обновляется fallback-данными                                                                                                                                                                                                                                                                                                            | Средняя   |
| 6.3 | ✅ **Subresource integrity для ethers.js** | SHA-384 integrity attribute на `<script>` в popup.html. `ethers-sri.test.js` верифицирует хэш и совпадение с popup.html                                                                                                                                                                                                                                                                                                                                | Лёгкая    |
| 6.4 | ✅ **Nonce management**                    | `getNextNonce()` / `resetNonce()` в sw-wallet.ts. LRU cache per address+chainId, 30s stale TTL, auto-reset on tx error. Используется в SEND_ETH, SEND_ERC20, eth_sendTransaction                                                                                                                                                                                                                                                                       | Средняя   |

---

## Сводка по приоритету и трудозатратам

| Сложность   | Кол-во задач | Выполнено | Перечень                                                                                                               |
| ----------- | ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Лёгкая**  | 11           | ✅ 11     | ✅ 1.4, ✅ 1.5, ✅ 2.6, ✅ 3.1, ✅ 3.2, ✅ 3.4, ✅ 4.1, ✅ 4.5, ✅ 5.2, ✅ 5.5, ✅ 6.3                                 |
| **Средняя** | 15           | ✅ 15     | ✅ 1.1, ✅ 1.2, ✅ 1.3, ✅ 2.3, ✅ 2.5, ✅ 3.3, ✅ 3.5, ✅ 4.2, ✅ 4.3, ✅ 5.1, ✅ 5.3, ✅ 5.4, ✅ 6.2, ✅ 6.4, ✅ 4.4 |
| **Высокая** | 4            | ✅ 4      | ✅ 2.1, ✅ 2.2, ✅ 2.4, ✅ 6.1                                                                                         |

> **Прогресс: 31 / 31 задач выполнено (100%)** ✅ Все задачи завершены.
