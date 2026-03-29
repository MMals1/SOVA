# ETH Wallet — Technical Specification v0.0.2

> **Назначение документа:** полное техническое описание проекта для аудита кода другим ИИ-агентом или разработчиком. Документ содержит архитектуру, все потоки данных, весь код с аннотациями, список принятых решений и известных проблем.

- **Дата:** 2026-03-28
- **Сеть:** Ethereum Sepolia testnet (Chain ID: 11155111)
- **Тип:** Chrome Extension, Manifest V3, некастодиальный кошелёк

---

## 1. Структура проекта

```
wallet/
├── extension/                        ← Chrome расширение (основной продукт)
│   ├── manifest.json                 ← конфиг расширения (MV3)
│   ├── dev-polyfill.js               ← mock Chrome API для локальной разработки
│   ├── background/
│   │   └── service-worker.js         ← фоновый процесс: хранит ключ, подписывает транзакции
│   ├── popup/
│   │   ├── popup.html                ← UI расширения (production)
│   │   ├── popup.js                  ← вся логика popup (936 строк)
│   │   └── dev.html                  ← UI для разработки (подключает polyfill)
│   └── libs/
│       └── ethers.umd.min.js         ← ethers.js v6, UMD bundle, аудированная библиотека
│
├── scripts/                          ← вспомогательные Python скрипты (не production)
│   ├── Accounts/                     ← генерация ключей, адресов, мнемоник
│   ├── Cyber/keystore.py             ← шифрование/расшифровка keystore (EIP-55)
│   └── Transactions/                 ← баланс и отправка через web3.py
│
├── study/                            ← учебные материалы и скрипты
├── recomendations/wallet_security.docx ← исходный security checklist
├── .gitignore                        ← исключены: .env, wallets/, keystore/, wallet.json
├── .env                              ← ALCHEMY_URL (не в репозитории)
├── requirements.txt                  ← Python зависимости
├── wallet_update_v002.md             ← этот файл
└── README.md
```

---

## 2. Архитектура безопасности

### 2.1 Ключевой принцип: изоляция приватного ключа

```
┌───────────────────────────────────────────────────────┐
│                    POPUP (popup.js)                   │
│                                                       │
│  Что знает popup:                                     │
│  • адрес кошелька (публичный)                         │
│  • зашифрованный keystore (из chrome.storage.local)   │
│  • баланс и транзакции (от Alchemy)                   │
│                                                       │
│  Чего НЕ знает popup:                                 │
│  • приватный ключ (никогда)                           │
│  • расшифрованный wallet объект                       │
└────────────────────┬──────────────────────────────────┘
                     │ chrome.runtime.sendMessage
                     │ { type, ...params }  →
                     │ ← { ok, ...result }
┌────────────────────▼──────────────────────────────────┐
│             SERVICE WORKER (service-worker.js)        │
│                                                       │
│  let _wallet = null  ← единственное место ключа      │
│                                                       │
│  Обрабатывает: unlock, lock, send-eth,                │
│                send-erc20, add-sub-account            │
│                                                       │
│  Возвращает popup только:                             │
│  • { ok: true } при успехе                            │
│  • { hash: '0x...' } при отправке транзакции         │
│  • { ok: false, error: '...' } при ошибке            │
└────────────────────┬──────────────────────────────────┘
                     │ JSON-RPC
                     ▼
              Alchemy (Sepolia RPC)
```

### 2.2 Жизненный цикл приватного ключа

```
1. СОЗДАНИЕ / ИМПОРТ
   createWallet() / importWallet()  →  ethers.Wallet.createRandom() / .fromPhrase()
   → wallet.encrypt(password)       →  keystore JSON (AES-128-CTR + scrypt)
   → setLocal({ accounts: [...] })  →  chrome.storage.local (только keystore)
   → sendToSW('unlock', password)   →  SW расшифровывает, _wallet = wallet объект

2. РАЗБЛОКИРОВКА (при повторном открытии)
   unlockWallet()  →  sendToSW('unlock', password, accountIndex)
   SW: fromEncryptedJson(keystore, password)  →  _wallet = wallet
   popup получает: { ok: true } или { ok: false }

3. ОТПРАВКА ТРАНЗАКЦИИ
   sendTransaction()  →  sendToSW('send-eth', { to, amount })
   SW: _wallet.connect(provider).sendTransaction(...)  →  { hash }
   popup получает только hash — ключ никогда не покидает SW

4. БЛОКИРОВКА
   lockWallet()  →  sendToSW('lock')
   SW: _wallet = null  +  chrome.storage.session.clear()

5. АВТОБЛОКИРОВКА (5 минут без активности)
   chrome.alarms 'auto-lock'  →  _wallet = null  +  session.clear()
```

### 2.3 Важное ограничение MV3 Service Workers

Chrome может убить SW в фоне (когда нет активности). При этом `_wallet = null` сбрасывается. Если пользователь затем пробует отправить транзакцию, SW вернёт `{ ok: false, error: 'locked' }`. Popup обрабатывает это через `handleSWLocked()` — редиректит на экран разблокировки. Это стандартное поведение (так работает MetaMask).

---

## 3. Файлы расширения — полное описание

### 3.1 `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "ETH Wallet",
  "version": "1.0.0",
  "description": "Некастодиальный Ethereum кошелёк · Sepolia testnet",
  "permissions": ["storage", "alarms", "clipboardWrite"],
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "ETH Wallet"
  },
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_security_policy": {
    "extension_pages": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://eth-sepolia.g.alchemy.com; object-src 'none'; frame-ancestors 'none'; form-action 'none'"
  }
}
```

**CSP расшифровка:**
| Директива | Значение |
|---|---|
| `default-src 'none'` | всё запрещено если не указано явно |
| `script-src 'self'` | только скрипты из папки расширения, никакого `eval()` |
| `style-src 'self' 'unsafe-inline'` | нужен `unsafe-inline` для `el.style.background` в `setAvatar()` |
| `connect-src https://eth-sepolia.g.alchemy.com` | fetch/XHR только на Alchemy — другие хосты заблокированы браузером |
| `object-src 'none'` | запрет Flash и плагинов |
| `frame-ancestors 'none'` | страницу нельзя встроить в iframe (clickjacking защита) |
| `form-action 'none'` | формы не могут отправлять данные |

---

### 3.2 `background/service-worker.js` (полный код с аннотациями)

```javascript
'use strict';

importScripts('../libs/ethers.umd.min.js');  // ethers.js доступен в SW через importScripts

const RPC_URL        = 'https://eth-sepolia.g.alchemy.com/v2/lrmoWsP5qrMt8_aezkh4p';
const CHAIN_ID       = 11155111;   // Sepolia
const LOCK_ALARM     = 'auto-lock';
const LOCK_DELAY_MIN = 5;          // минут до автоблокировки

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
];

// ЕДИНСТВЕННОЕ место в приложении где хранится расшифрованный ключ.
// popup.js не имеет доступа к этой переменной — она изолирована в SW контексте.
let _wallet = null;

// Слушаем сообщения от popup.js
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(result => sendResponse({ ok: true,  ...result }))
    .catch(err   => sendResponse({ ok: false, error: err.message }));
  return true; // return true обязателен для async ответа в MV3
});

async function handleMessage(msg) {
  switch (msg.type) {

    // Расшифровываем keystore паролем, сохраняем wallet в памяти SW
    case 'unlock': {
      const { accounts } = await chrome.storage.local.get(['accounts']);
      if (!accounts?.[msg.accountIndex]?.keystore) throw new Error('Аккаунт не найден');
      // Если пароль неверный — fromEncryptedJson бросит ошибку, catch вернёт { ok: false }
      _wallet = await ethers.Wallet.fromEncryptedJson(
        accounts[msg.accountIndex].keystore,
        msg.password
      );
      await chrome.storage.session.set({ unlocked: true, unlockTime: Date.now() });
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
      return {};
    }

    // Обнуляем ключ из памяти
    case 'lock': {
      _wallet = null;
      await chrome.storage.session.clear();
      chrome.alarms.clear(LOCK_ALARM);
      return {};
    }

    // Отправка ETH: подписываем здесь, popup получает только hash
    case 'send-eth': {
      if (!_wallet) throw new Error('locked');
      const { rpcUrl } = await chrome.storage.local.get(['rpcUrl']);
      const provider  = new ethers.JsonRpcProvider(rpcUrl || RPC_URL);
      const connected = _wallet.connect(provider);
      const tx = await connected.sendTransaction({
        to:       msg.to,
        value:    ethers.parseEther(msg.amount),
        gasLimit: 21000n,
        chainId:  CHAIN_ID,
      });
      return { hash: tx.hash };
    }

    // Отправка ERC-20 токена
    case 'send-erc20': {
      if (!_wallet) throw new Error('locked');
      const { rpcUrl } = await chrome.storage.local.get(['rpcUrl']);
      const provider  = new ethers.JsonRpcProvider(rpcUrl || RPC_URL);
      const connected = _wallet.connect(provider);
      const contract  = new ethers.Contract(msg.tokenAddress, ERC20_ABI, connected);
      const tx = await contract.transfer(msg.to, ethers.parseUnits(msg.amount, msg.decimals));
      return { hash: tx.hash };
    }

    // Деривация субаккаунта по BIP-44 пути m/44'/60'/0'/0/N
    // _wallet не меняется — используем только для получения мнемоники
    case 'add-sub-account': {
      const { accounts = [] } = await chrome.storage.local.get(['accounts']);
      const main = await ethers.Wallet.fromEncryptedJson(accounts[0].keystore, msg.password);
      if (!main.mnemonic?.phrase) throw new Error('Кошелёк без мнемоники — субаккаунты недоступны');
      const nextIdx   = accounts.length;
      const newWallet = ethers.HDNodeWallet.fromPhrase(
        main.mnemonic.phrase, null, `m/44'/60'/0'/0/${nextIdx}`
      );
      const keystore = await newWallet.encrypt(msg.password);
      return { address: newWallet.address, keystore, index: nextIdx };
    }

    default:
      throw new Error(`Неизвестный тип сообщения: ${msg.type}`);
  }
}

// Автоблокировка по таймеру
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === LOCK_ALARM) {
    _wallet = null;
    chrome.storage.session.clear();
  }
});

// При установке создаём первый alarm
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
});
```

**Message API (контракт между popup и SW):**

| Тип | Входные параметры | Ответ при успехе | Ответ при ошибке |
|---|---|---|---|
| `unlock` | `{ password, accountIndex }` | `{ ok: true }` | `{ ok: false, error }` |
| `lock` | — | `{ ok: true }` | — |
| `send-eth` | `{ to, amount }` | `{ ok: true, hash }` | `{ ok: false, error: 'locked' \| '...' }` |
| `send-erc20` | `{ to, amount, tokenAddress, decimals }` | `{ ok: true, hash }` | `{ ok: false, error }` |
| `add-sub-account` | `{ password }` | `{ ok: true, address, keystore, index }` | `{ ok: false, error }` |

---

### 3.3 `popup/popup.js` — карта функций

#### Глобальные переменные
```javascript
const RPC_URL  = '...alchemy.com/v2/lrmoWsP5qrMt8_aezkh4p'; // дефолтный fallback
const CHAIN_ID = 11155111;
const AUTO_LOCK_MINUTES = 5;

const ERC20_ABI = [...]; // balanceOf, transfer, symbol, decimals, name

let provider = null;           // ethers.JsonRpcProvider, init в DOMContentLoaded
let activeAccountIndex = 0;   // индекс активного аккаунта

let _pendingMnemonic = null;   // фраза хранится ТОЛЬКО во время квиза, после — null
let _quizPositions   = [];     // три случайных индекса [0..11] для квиза
```

#### Инициализация (`DOMContentLoaded`)
```
1. Читаем rpcUrl из chrome.storage.local
2. provider = new JsonRpcProvider(rpcUrl || RPC_URL)
3. Миграция старого формата данных (keystore/address → accounts[])
4. Если нет accounts → screen-setup
5. Если сессия устарела (> 5 мин) → screen-unlock
6. Иначе → screen-wallet
```

#### Экраны и их функции

| Экран | ID | Функции |
|---|---|---|
| Настройка | `screen-setup` | `createWallet()`, `importWallet()`, `switchTab()`, `toggleCustomKey()` |
| Мнемоника | `screen-mnemonic` | `copyMnemonic()`, `confirmMnemonic()` |
| Квиз | `screen-quiz` | `verifyQuiz()`, `backToMnemonic()`, `_renderQuiz()`, `_pickQuizPositions()` |
| Разблокировка | `screen-unlock` | `unlockWallet()`, `resetWallet()` |
| Кошелёк | `screen-wallet` | `loadWalletScreen()`, `loadBalance()`, `refreshBalance()`, `loadTokenBalances()`, `loadTransactions()`, `toggleAccountMenu()`, `switchWalletTab()`, `lockWallet()`, `copyAddress()` |
| Отправка | `screen-send` | `showSendScreen()`, `sendTransaction()` |
| Токен | `screen-add-token` | `fetchTokenInfo()`, `addToken()`, `onTokenAddrChange()` |
| Субаккаунт | `screen-add-account` | `addSubAccount()` |

#### Поток создания кошелька
```
createWallet()
  1. валидация пароля (>= 8 символов)
  2. _readRpcChoice() — валидация выбора API ключа
  3. ethers.Wallet.createRandom() → wallet + mnemonic
  4. wallet.encrypt(password) → keystore JSON (scrypt, ~1-3 сек)
  5. setLocal({ accounts: [..., {address, keystore, name}] })
  6. _saveRpcChoice() → setLocal({rpcUrl}) или removeLocal('rpcUrl')
  7. sendToSW('unlock', password, accountIndex) → SW расшифровывает keystore
  8. _pendingMnemonic = mnemonic → screen-mnemonic
```

#### Поток квиза
```
screen-mnemonic → confirmMnemonic()
  _pickQuizPositions() → 3 случайных уникальных индекса из [0..11]
  _renderQuiz() → createElement для каждого поля (без innerHTML)
  → screen-quiz

verifyQuiz()
  words = _pendingMnemonic.split(' ')
  для каждого поля: проверяем inp.value === words[pos]
  если неверно → красная рамка + showError
  если верно → _pendingMnemonic = null → _quizPositions = [] → screen-wallet
```

#### Поток отправки транзакции
```
sendTransaction()
  1. валидация to (ethers.isAddress), amount (> 0)
  2. sendToSW('send-eth', { to, amount })
       ИЛИ
     sendToSW('send-erc20', { to, amount, tokenAddress, decimals })
  3. если result.error === 'locked' → handleSWLocked() → screen-unlock
  4. если result.ok → showSuccess с hash
```

#### XSS-защита — все места рендера внешних данных

Все следующие функции используют `createElement` + `textContent` вместо `innerHTML`:

| Функция | Источник данных | Защита |
|---|---|---|
| `loadTokenBalances()` | `t.symbol`, `t.address` из localStorage | `textContent` |
| `renderAccountMenu()` | `acct.name`, `acct.address` из localStorage | `textContent` |
| `loadTransactions()` | `tx.from`, `tx.to`, `tx.asset`, `tx.hash` из Alchemy | `textContent` + `encodeURIComponent` для href |
| `showSendScreen()` | `t.symbol`, `t.address` в `<option>` | `createElement('option')` + `textContent` |
| `copyAddress()` | SVG-иконка кнопки | `cloneNode(true)` + `appendChild` |

Ошибки (`e.message`) из внешних источников **не выводятся в DOM** — только нейтральный текст.

#### Выбор API ключа

```javascript
// На экране setup:
// [✓] Использовать встроенный API ключ   ← checked по умолчанию
// [ ] Использовать встроенный API ключ
//     [https://eth-sepolia.g.alchemy.com/v2/ВАШ_КЛЮЧ]

_readRpcChoice()
  // читает checkbox #use-default-key и input #custom-rpc-url
  // возвращает { ok, useDefault, url }
  // валидация: url должен начинаться с 'https://'

_saveRpcChoice(choice)
  // useDefault=true  → removeLocal('rpcUrl')  → provider с RPC_URL
  // useDefault=false → setLocal({ rpcUrl })   → provider с custom URL

// В SW при send-eth / send-erc20:
const { rpcUrl } = await chrome.storage.local.get(['rpcUrl']);
const provider = new JsonRpcProvider(rpcUrl || RPC_URL);
// rpcUrl из storage перебивает константу RPC_URL
```

#### Вспомогательные функции

```javascript
// Storage wrappers
getLocal(keys)     → Promise<object>  // chrome.storage.local.get
setLocal(data)     → Promise<void>    // chrome.storage.local.set
removeLocal(keys)  → Promise<void>    // chrome.storage.local.remove ← новый
getSession(keys)   → Promise<object>  // chrome.storage.session.get
setSession(data)   → Promise<void>    // chrome.storage.session.set

// SW communication
sendToSW(msg)      → Promise<{ok, ...}>  // chrome.runtime.sendMessage wrapper
handleSWLocked()   → void               // очищает сессию, → screen-unlock

// UI
showError(prefix, msg)   // показывает #prefix-error
setStatus(prefix, msg)   // показывает #prefix-status
showSuccess(prefix, msg) // показывает #prefix-success
clearMessages(prefix)    // скрывает все три
setLoading(btnId, bool)  // disabled кнопки
showScreen(id)           // переключает активный экран

// Форматирование
shortAddr(addr)    → '0x1234…5678'
formatAmount(val)  → строка без хвостовых нулей, '< 0.000001' для мелких
setAvatar(id, addr) → gradient + 2 символа по адресу
```

---

### 3.4 `popup/popup.html` и `popup/dev.html`

#### DOM-элементы (все ID)

| ID | Тип | Назначение |
|---|---|---|
| `screen-setup` | div.screen | экран создания/импорта |
| `screen-mnemonic` | div.screen | показ мнемоники |
| `screen-quiz` | div.screen | квиз на мнемонику |
| `screen-unlock` | div.screen | разблокировка |
| `screen-wallet` | div.screen | основной экран |
| `screen-send` | div.screen | отправка |
| `screen-add-token` | div.screen | добавление ERC-20 |
| `screen-add-account` | div.screen | создание субаккаунта |
| `import-mnemonic` | textarea | 12 слов при импорте |
| `import-password` | input[password] | пароль при импорте |
| `create-password` | input[password] | пароль при создании |
| `use-default-key` | input[checkbox] | выбор встроенного ключа |
| `custom-key-field` | div | контейнер для кастомного URL |
| `custom-rpc-url` | input[text] | кастомный Alchemy URL |
| `mnemonic-display` | div.mnemonic-box | показ фразы (textContent) |
| `quiz-inputs` | div | контейнер полей квиза (заполняется JS) |
| `quiz-error` | div.error | ошибка квиза |
| `btn-verify-quiz` | button | кнопка подтверждения квиза |
| `unlock-avatar` | div.avatar | аватарка на экране unlock |
| `unlock-address` | p.sub | адрес на экране unlock |
| `unlock-password` | input[password] | пароль при разблокировке |
| `unlock-error` | div.error | ошибка разблокировки |
| `unlock-status` | div.status | статус разблокировки |
| `btn-unlock` | button | кнопка разблокировки |
| `wallet-avatar` | div.avatar | аватарка в заголовке кошелька |
| `wallet-address` | span | обрезанный адрес |
| `wallet-balance` | span | баланс ETH |
| `header-acct-name` | div | имя аккаунта |
| `acct-menu` | div | меню аккаунтов (hidden/visible) |
| `acct-list` | div | список аккаунтов (заполняется JS) |
| `token-list` | div | список токенов (заполняется JS) |
| `tx-list` | div | список транзакций (заполняется JS) |
| `send-asset` | select | актив для отправки |
| `send-to` | input[text] | адрес получателя |
| `send-amount` | input[number] | сумма |
| `send-error` | div.error | ошибка отправки |
| `send-status` | div.status | статус отправки |
| `send-success` | div.success | успех отправки |
| `btn-send` | button | кнопка отправки |
| `token-address` | input[text] | адрес ERC-20 контракта |
| `token-symbol` | input[text] | символ токена |
| `token-decimals` | input[number] | decimals |
| `btn-fetch-token` | button | загрузить инфо о токене |
| `add-token-error` | div.error | ошибка добавления токена |
| `add-token-status` | div.status | статус добавления токена |
| `add-account-password` | input[password] | пароль для субаккаунта |
| `add-account-error` | div.error | ошибка субаккаунта |
| `add-account-status` | div.status | статус субаккаунта |
| `btn-add-account` | button | кнопка создания субаккаунта |

#### Динамически создаваемые ID (через JS)
| Шаблон | Функция | Использование |
|---|---|---|
| `quiz-inp-0`, `quiz-inp-1`, `quiz-inp-2` | `_renderQuiz()` | `verifyQuiz()`, `backToMnemonic()` |
| `tb-{addr.slice(2,10)}` | `loadTokenBalances()` | обновление баланса токена |
| `acct-av-{i}` | `renderAccountMenu()` | `setAvatar()` |

#### Различия popup.html vs dev.html

| | popup.html | dev.html |
|---|---|---|
| `dev-polyfill.js` | не подключён | подключён после ethers.js |
| DEV badge | нет | есть (зелёный, fixed position) |
| Назначение | установленное расширение | локальная разработка через HTTP сервер |

---

### 3.5 `dev-polyfill.js` — mock Chrome API

Используется только в `dev.html`. Полностью заменяет:
- `chrome.storage.local` → `localStorage` (ключи с префиксом `dev_local_`)
- `chrome.storage.session` → `sessionStorage` (ключи с префиксом `dev_session_`)
- `chrome.runtime.sendMessage` → async `handleDevMessage()` (зеркалит логику SW)
- `chrome.alarms` → заглушки (no-op)

**Реализованные типы сообщений (полностью синхронизированы с SW):**
- `unlock` — расшифровывает keystore, хранит `_devWallet` в модульной переменной
- `lock` — `_devWallet = null`, очищает sessionStorage
- `send-eth` — подписывает и отправляет ETH через Alchemy
- `send-erc20` — подписывает и отправляет ERC-20 transfer
- `add-sub-account` — деривирует новый аккаунт, шифрует, возвращает keystore

**Как запустить dev-режим:**
```bash
cd ~/Desktop/wallet/extension
python3 -m http.server 8080
# открыть http://localhost:8080/popup/dev.html
```

---

## 4. Хранилище данных

### `chrome.storage.local` (постоянное, не очищается при закрытии)

| Ключ | Тип | Содержимое |
|---|---|---|
| `accounts` | `Array<{address, keystore, name}>` | все кошельки пользователя |
| `activeAccount` | `number` | индекс активного аккаунта |
| `tokens` | `Array<{address, symbol, decimals}>` | добавленные ERC-20 токены |
| `rpcUrl` | `string \| undefined` | кастомный Alchemy URL; если отсутствует — используется встроенный |

### `chrome.storage.session` (очищается при закрытии браузера / блокировке)

| Ключ | Тип | Содержимое |
|---|---|---|
| `unlocked` | `boolean` | флаг разблокировки |
| `unlockTime` | `number` | timestamp последней разблокировки (мс) |

### Логика истечения сессии
```javascript
const expired = !unlockTime || (Date.now() - unlockTime > AUTO_LOCK_MINUTES * 60 * 1000);
if (!unlocked || expired) → screen-unlock
```

---

## 5. Keystore формат

Используется стандарт Ethereum Keystore V3 (EIP-55):

```json
{
  "version": 3,
  "id": "uuid",
  "address": "0x...",
  "crypto": {
    "cipher": "aes-128-ctr",
    "cipherparams": { "iv": "hex" },
    "ciphertext": "hex",
    "kdf": "scrypt",
    "kdfparams": {
      "n": 262144,    // итерации (2^18) — защита от brute-force
      "r": 8,
      "p": 1,
      "dklen": 32,
      "salt": "hex"
    },
    "mac": "hex"      // HMAC для верификации пароля без расшифровки
  }
}
```

Шифрование производится через `ethers.Wallet.encrypt(password)` — стандартная реализация ethers.js v6.

---

## 6. Внешние API

### Alchemy (Sepolia RPC)

**Используется в popup.js:**
- `provider.getBalance(address)` — баланс ETH (через eth_getBalance)
- `contract.balanceOf(address)` — баланс ERC-20
- `contract.symbol()`, `contract.decimals()` — инфо о токене
- `fetchAlchemyTransfers(address, 'from'/'to')` — история транзакций

```javascript
// Метод Alchemy для истории (не стандартный JSON-RPC):
{
  method: 'alchemy_getAssetTransfers',
  params: [{
    fromBlock: '0x0', toBlock: 'latest',
    category: ['external', 'erc20'],
    excludeZeroValue: true,
    maxCount: '0x14',  // 20 транзакций
    fromAddress: address  // ИЛИ toAddress
  }]
}
```

**Используется в service-worker.js:**
- `wallet.connect(provider).sendTransaction(tx)` — отправка ETH
- `contract.transfer(to, amount)` — отправка ERC-20

**ИСПРАВЛЕНО (v0.0.2):** `fetchAlchemyTransfers` читает `rpcUrl` из `chrome.storage.local` и использует его как адрес запроса, падая обратно на `RPC_URL` если кастомный ключ не задан. История транзакций корректно использует выбранный пользователем ключ.

---

## 7. Аудит безопасности — проведённые исправления

### 7.1 XSS — ИСПРАВЛЕНО

**До (уязвимо):**
```javascript
el.innerHTML = tokens.map(t => `<div>${t.symbol}</div>`).join('');
// t.symbol = '<img src=x onerror=steal(privateKey)>' → выполнится
```

**После (безопасно):**
```javascript
const div = document.createElement('div');
div.textContent = t.symbol; // экранирует всё автоматически
el.appendChild(div);
```

Все 5 мест заменены. Проверить: `grep -n "innerHTML" popup.js` должен вернуть 0 результатов.

### 7.2 Изоляция ключа в SW — ИСПРАВЛЕНО

Popup.js больше не вызывает `ethers.Wallet.fromEncryptedJson()` — только SW.
Проверить: `grep -n "fromEncryptedJson" popup.js` должен вернуть 0 результатов.

### 7.3 CSP — УСИЛЕНО

До: `script-src 'self'; object-src 'self'`
После: полная CSP с `default-src 'none'` и `connect-src` ограниченным Alchemy.

### 7.4 Квиз мнемоники — ДОБАВЛЕНО

`_pendingMnemonic` обнуляется после успешного квиза. Поля рисуются через `createElement`.

### 7.5 Фантомный ID `header-avatar` — ИСПРАВЛЕНО

Строка `setAvatar('header-avatar', address)` удалена — элемента с таким ID нет в HTML. `setAvatar()` имеет null-guard (`if (!el || !address) return`), поэтому ошибки не было, но вызов был бесполезным.

### 7.6 Null-guard в `verifyQuiz` — ДОБАВЛЕНО

```javascript
const inp = document.getElementById(`quiz-inp-${i}`);
if (!inp) { allCorrect = false; return; } // защита если DOM не готов
```

---

## 8. Известные проблемы (не исправлены)

| # | Описание | Файл | Приоритет |
|---|---|---|---|
| 1 | **Встроенный API ключ виден в исходниках** (`RPC_URL` в popup.js и service-worker.js). Любой кто распакует расширение (.crx → zip) получит ключ. Решение: backend proxy или пользовательский ключ. | popup.js, service-worker.js | Высокий |
| 2 | ~~**`fetchAlchemyTransfers` игнорирует кастомный rpcUrl**~~ **ИСПРАВЛЕНО:** функция теперь читает `rpcUrl` из storage перед fetch. | popup.js | ✅ Закрыт |
| 3 | **Нет IP-приватности** — все RPC запросы идут напрямую от браузера к Alchemy. Alchemy видит IP пользователя → адрес кошелька. | popup.js, service-worker.js | Средний |
| 4 | **Пароль только минимум 8 символов** — нет проверки на цифры, регистр, словарные слова. `aaaaaaaa` проходит. | popup.js | Средний |
| 5 | **Нет экрана подтверждения транзакции** — транзакция отправляется без показа деталей для подтверждения (сумма, газ, адрес). | popup.js, popup.html | Средний |
| 6 | **SW может быть убит Chrome** — при длительном бездействии Chrome завершает SW. `_wallet = null`. Пользователь обнаружит это только при следующей транзакции. Это поведение стандартно для MV3, но неочевидно для пользователя. | service-worker.js | Низкий |
| 7 | **scrypt вместо Argon2id** — ethers.js v6 использует scrypt для шифрования keystore (стандарт EIP-55). Argon2id более устойчив к GPU-атакам, но не поддерживается стандартом. | service-worker.js | Низкий |

---

## 9. Зависимости

### JavaScript (extension)
| Библиотека | Версия | Назначение | Источник |
|---|---|---|---|
| ethers.js | v6 (UMD) | Wallet, HDNodeWallet, Contract, JsonRpcProvider | `libs/ethers.umd.min.js` |

### Python (вспомогательные скрипты, не production)
| Пакет | Назначение |
|---|---|
| `eth-account` | управление аккаунтами |
| `web3` v7 | RPC клиент |
| `mnemonic` | BIP39 генерация |
| `pycryptodome` | AES, scrypt |
| `python-dotenv` | загрузка .env |

---

## 10. Инструкция по аудиту для ИИ-агента

Для полноценного аудита рекомендуется проверить следующее:

### Критические проверки
```bash
# XSS: не должно быть innerHTML с переменными
grep -n "innerHTML" extension/popup/popup.js

# Ключ не должен попадать в popup
grep -n "fromEncryptedJson" extension/popup/popup.js

# Проверить что все sendToSW типы обрабатываются в SW
grep -n "sendToSW" extension/popup/popup.js       # что отправляет popup
grep -n "case '" extension/background/service-worker.js  # что обрабатывает SW
```

### Совместимость DOM
Все ID вызываемые через `getElementById` в popup.js должны существовать в popup.html и dev.html. Список всех ID в разделе 3.4.

### Синхронизация SW ↔ polyfill
Типы сообщений в `handleMessage()` (service-worker.js) и `handleDevMessage()` (dev-polyfill.js) должны совпадать. Текущий список: `unlock`, `lock`, `send-eth`, `send-erc20`, `add-sub-account`.

### Порядок загрузки скриптов в dev.html
```html
<script src="../libs/ethers.umd.min.js"></script>  <!-- 1: ethers -->
<script src="../dev-polyfill.js"></script>           <!-- 2: chrome API mock -->
<script src="popup.js"></script>                     <!-- 3: логика -->
```
Polyfill должен быть загружен ДО popup.js — иначе `chrome` будет undefined.

### ✅ Баг #2 закрыт (fetchAlchemyTransfers)
В `popup.js` функция `fetchAlchemyTransfers` теперь читает `rpcUrl` из storage:
```javascript
const { rpcUrl } = await getLocal(['rpcUrl']);
const activeUrl = rpcUrl || RPC_URL;
const res = await fetch(activeUrl, { ... }); // учитывает кастомный ключ
```
