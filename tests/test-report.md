# Отчет по тестированию SOVA Wallet

Дата: 2026-03-29

## 1) Что уже сделано

### 1.1 Unit-тесты
Реализованы и проходят:
- tests/unit/popup-helpers.test.js
- tests/unit/network-state.test.js
- tests/unit/tx-pagination.test.js
- tests/unit/token-scope.test.js

Покрытые области:
- форматирование адресов и сумм
- выбор explorer URL по сети
- scope-ключи транзакций по `network + address`
- пагинация истории транзакций
- изоляция токенов по сетям и logo URL helper-логика

### 1.2 Integration-тесты
Реализованы и проходят:
- tests/integration/popup-sw-session.test.js
- tests/integration/account-switch.test.js

Покрытые области:
- синхронизация состояния popup <-> service worker
- проверка корректного активного подписанта
- поведение при переключении аккаунтов
- защита от отправки со stale signer

### 1.3 E2E-тесты (Playwright)
Реализованы и проходят:
- tests/e2e/smoke.spec.js
- tests/e2e/unlock.spec.js
- tests/e2e/send-eth.spec.js
- tests/e2e/network-scope.spec.js
- tests/e2e/token-flow.spec.js
- tests/e2e/helpers/popup-fixture.js (мок-окружение для popup)

Покрытые пользовательские сценарии:
- открытие popup и базовая интерактивность
- unlock (успех и неверный пароль)
- ETH send: confirm-step, insufficient funds, successful send
- network scope: изоляция history/token state, корректные explorer links
- token flow: add, fallback-рендер, remove (в рамках текущей сети)

## 2) Текущий статус прогонов

### Unit + Integration
Команда:
- npm run test:unit

Результат:
- 6 test files passed
- 20 tests passed

### E2E
Команда:
- npx playwright test

Результат:
- 13 tests passed

## 3) Технические улучшения, сделанные для тестирования

- Добавлено устойчивое mock-окружение Chrome API для popup:
  - `chrome.storage.local/session` с поддержкой callback + promise стиля
  - `chrome.runtime.sendMessage` с ключевыми message-типами
- Добавлены JSON-RPC моки для `ethers` (включая batched requests)
- Стабилизированы e2e-переключения сети и проверки token/history scope

## 4) Что нужно сделать дальше

### Приоритет P1 (следующий шаг)
1. Добавить e2e для ERC-20 send flow:
   - confirm-step
   - insufficient funds / revert path
   - successful submit

2. Добавить e2e для mainnet send guard:
   - first-send confirmation
   - remembered acceptance behavior

### Приоритет P2
3. Добавить e2e на lifecycle авто-лока:
   - lock после таймаута
   - повторный unlock

4. Добавить e2e на recovery после service worker restart:
   - popup остается открыт
   - корректный переход на unlock

### Приоритет P3
5. Расширить negative-path покрытие RPC/network ошибок:
   - provider недоступен
   - нестабильный RPC
   - ошибки чтения токенов/истории

6. Добавить CI-шаги:
   - запуск `npm run test:unit`
   - запуск `npx playwright test`
   - публикация отчетов/артефактов

## 5) Критерий готовности тестового этапа

Этап можно считать завершенным после выполнения P1 + P2:
- покрыт полный send flow (ETH + ERC-20)
- покрыты lock/restart ключевые регрессии
- test suite стабильно проходит в локальном и CI окружении
