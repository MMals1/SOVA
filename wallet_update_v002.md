# ETH Wallet — Update v0.0.2

Дата: 2026-03-28
Статус: применено

---

## Обзор

Этот апдейт полностью посвящён безопасности и архитектуре.
Затронуто 7 файлов, ни одна пользовательская функция не удалена — только улучшена.

---

## 1. Исправление XSS-уязвимостей (`popup/popup.js`)

### Проблема
Четыре функции строили DOM через `innerHTML` с данными из внешних источников (блокчейн, пользователь). Любое имя токена или аккаунта вида `<img src=x onerror=alert(1)>` выполнялось бы как код.

### Исправление
Полная замена шаблонных строк в `innerHTML` на `createElement` + `textContent` во всех уязвимых местах.

| Функция | Уязвимые данные | Было | Стало |
|---|---|---|---|
| `loadTokenBalances` | `t.symbol`, `t.address` | `innerHTML` шаблон | `createElement` + `textContent` |
| `renderAccountMenu` | `acct.name`, `onclick` в строке | `innerHTML` шаблон | `createElement` + `addEventListener` |
| `loadTransactions` | `tx.asset`, `tx.hash`, `e.message` | `innerHTML` шаблон | `createElement` + `textContent` |
| `showSendScreen` | `t.symbol`, `t.address` в `<option>` | `innerHTML` шаблон | `createElement('option')` + `textContent` |
| `copyAddress` | восстановление SVG | `btn.innerHTML = svg` | `cloneNode` + `appendChild` |

**Дополнительно:** в `loadTransactions` хэш транзакции теперь попадает в `href` через `encodeURIComponent`. Сообщения об ошибках больше не рендерятся в DOM — только нейтральный текст.

---

## 2. Усиление CSP (`manifest.json`)

### Было
```json
"extension_pages": "script-src 'self'; object-src 'self'"
```

### Стало
```json
"extension_pages": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://eth-sepolia.g.alchemy.com; object-src 'none'; frame-ancestors 'none'; form-action 'none'"
```

### Что добавилось и зачем

| Директива | Эффект |
|---|---|
| `default-src 'none'` | Всё запрещено по умолчанию — только явно разрешённое работает |
| `connect-src` с явным доменом | fetch/XHR только на Alchemy — даже при XSS данные никуда не утекут |
| `object-src 'none'` | Запрет Flash и плагинов |
| `frame-ancestors 'none'` | Защита от clickjacking — попап нельзя встроить в iframe |
| `form-action 'none'` | Формы не могут отправлять данные |
| `style-src 'unsafe-inline'` | Оставлено — нужно для динамических стилей аватарок (`el.style.background`) |

---

## 3. Квиз на мнемоническую фразу (`popup.js`, `popup.html`, `dev.html`)

### Проблема
После показа фразы пользователь мог нажать «Я сохранил →» не глядя. Нет проверки что фраза действительно записана.

### Реализация
Добавлен новый экран `screen-quiz`. После нажатия «Я сохранил →» пользователь не попадает в кошелёк — открывается квиз.

**Механика:**
- Выбираются 3 случайных позиции из 12 слов (`_pickQuizPositions`)
- Позиции сортируются по возрастанию, уникальны, меняются при каждом открытии
- Поля рисуются через `createElement` (без `innerHTML`)
- Верные слова подсвечиваются зелёным, неверные — красным
- Кнопка «← Посмотреть фразу снова» возвращает на экран с фразой

**Безопасность памяти:**
- Фраза хранится в `_pendingMnemonic` (переменная в модуле, не в DOM и не в хранилище)
- После успешного прохождения квиза: `_pendingMnemonic = null` — переменная обнуляется немедленно

**Новые функции:**
- `confirmMnemonic()` — теперь открывает квиз вместо кошелька
- `_pickQuizPositions()` — выбор случайных позиций
- `_renderQuiz()` — рендер полей через `createElement`
- `verifyQuiz()` — проверка ответов
- `backToMnemonic()` — возврат к фразе с очисткой полей

---

## 4. Архитектурное исправление: приватный ключ переехал в Service Worker

### Проблема
Расшифрованный `ethers.Wallet` объект хранился в куче JS popup-страницы. Любой мог открыть DevTools → Console и получить `wallet.privateKey`. Кроме того, пароль требовался при каждой отправке транзакции.

### Новая архитектура

```
До:
  Popup.js
    ├── fromEncryptedJson(keystore, password)  ← ключ расшифровывался здесь
    ├── wallet.privateKey виден в DevTools     ← уязвимость
    └── wallet.connect(provider).send()

После:
  Popup.js                     Service Worker (изолирован)
    ├── sendToSW('unlock') ──→   fromEncryptedJson()
    │                            _wallet = ...  ← ключ только здесь
    ├── sendToSW('send-eth')──→  _wallet.sendTransaction()
    │                      ←──  { hash: '0x...' }  ← только хэш транзакции
    └── sendToSW('lock')   ──→  _wallet = null
```

### Изменения в `background/service-worker.js`

Полная переработка. Теперь SW:
- Импортирует `ethers.js` через `importScripts`
- Держит `_wallet` в своей изолированной памяти (popup к ней не имеет доступа)
- Обрабатывает сообщения: `unlock`, `lock`, `reset-lock-timer`, `is-unlocked`, `send-eth`, `send-erc20`, `add-sub-account`
- При автоблокировке (5 мин) обнуляет `_wallet = null` и очищает session storage
- Если Chrome убивает SW в фоне — `_wallet` сбрасывается, пользователь видит экран разблокировки (стандартное поведение MetaMask)

### Изменения в `popup/popup.js`

Добавлены хелперы:
- `sendToSW(msg)` — отправляет сообщение в SW, возвращает Promise с ответом
- `handleSWLocked()` — если SW потерял ключ (был убит Chrome), редиректит на unlock

Переработаны функции:
- `unlockWallet()` — отправляет пароль в SW, получает только `{ ok: true/false }`
- `sendTransaction()` — отправляет параметры в SW, получает только `{ hash }`. Пароль больше не нужен при отправке
- `addSubAccount()` — деривация и шифрование происходят в SW
- `lockWallet()` — отправляет `lock` в SW (тот обнуляет ключ и очищает сессию)
- `createWallet()` и `importWallet()` — после создания сразу разблокируют SW

### Изменения в `popup/popup.html` и `popup/dev.html`

Удалено поле «Пароль кошелька» с экрана отправки — он больше не нужен. Ключ уже в SW, транзакция подписывается там.

### Изменения в `dev-polyfill.js`

Полная переработка `chrome.runtime.sendMessage` — теперь mock полностью зеркалит логику SW, включая расшифровку, подпись и деривацию субаккаунтов.

### Итоговые гарантии

| | Было | Стало |
|---|---|---|
| `wallet.privateKey` в DevTools | Виден | Недоступен (SW изолирован) |
| Пароль при отправке | Каждый раз | Только при разблокировке |
| Ключ в куче popup JS | Да | Нет |
| Wallet объект в popup | Да | Нет |

---

## 5. Выбор API ключа Alchemy (`popup.js`, `service-worker.js`, `dev-polyfill.js`, `popup.html`, `dev.html`)

### Проблема
API ключ Alchemy был жёстко прописан в `popup.js` и `service-worker.js`. Любой кто откроет исходники расширения получает доступ к ключу.

### Реализация

На экране создания/импорта кошелька добавлен блок:

```
[✓] Использовать встроенный API ключ     ← по умолчанию

[ ] Использовать встроенный API ключ
    Alchemy RPC URL (Sepolia)
    [https://eth-sepolia.g.alchemy.com/v2/ВАШ_КЛЮЧ]
    Бесплатный ключ: alchemy.com
```

**Логика хранения:**

| Выбор пользователя | `chrome.storage.local.rpcUrl` |
|---|---|
| Встроенный ключ | Ключ `rpcUrl` удаляется из хранилища |
| Свой ключ | URL сохраняется в `rpcUrl` |

При загрузке popup и при каждом RPC-запросе из SW — читается `rpcUrl` из хранилища. Если пусто — используется встроенный ключ.

**Новые функции в `popup.js`:**
- `_readRpcChoice()` — читает состояние чекбокса и поля, валидирует URL
- `_saveRpcChoice(choice)` — сохраняет или удаляет `rpcUrl`, обновляет провайдер
- `toggleCustomKey()` — показывает/скрывает поле ввода при переключении чекбокса
- `removeLocal(keys)` — новый хелпер для `chrome.storage.local.remove`

**Изменения в `service-worker.js`:**
Обработчики `send-eth` и `send-erc20` теперь читают `rpcUrl` из `chrome.storage.local` перед каждым запросом.

**Изменения в `dev-polyfill.js`:**
- Добавлен метод `remove` в mock `chrome.storage.local`
- Обработчики `send-eth` и `send-erc20` читают `rpcUrl` из `localStorage`

---

## Итог по файлам

| Файл | Тип изменений |
|---|---|
| `popup/popup.js` | XSS-fix, квиз, SW-архитектура, выбор RPC |
| `popup/popup.html` | Квиз-экран, удалён пароль из send, API-ключ UI, CSP стили |
| `popup/dev.html` | То же что popup.html |
| `background/service-worker.js` | Полная переработка — держит ключ, подписывает транзакции |
| `manifest.json` | Усиление CSP |
| `dev-polyfill.js` | Полная переработка — зеркалит SW логику, добавлен `remove` |

---

## Оставшиеся известные проблемы (следующие версии)

| # | Описание | Приоритет |
|---|---|---|
| 1 | Встроенный API ключ всё ещё виден в исходниках расширения | Высокий |
| 2 | Нет backend-прокси для RPC (IP пользователя привязывается к адресу кошелька) | Средний |
| 3 | Нет валидации сложности пароля (только минимум 8 символов) | Средний |
| 4 | Нет подтверждения транзакции UI перед отправкой (confirmation screen) | Средний |
| 5 | `chrome.storage.session` не шифруется нативно | Низкий |
