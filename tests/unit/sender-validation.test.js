// ── Sender validation tests ─────────────────────────────────────────────
// Проверяет что:
//  1. Все сообщения, которые popup.js отправляет в SW, ВКЛЮЧЕНЫ в whitelist
//     POPUP_ONLY_MESSAGE_TYPES. (Бугор который проскочил: send-eth/send-erc20
//     были удалены из whitelist при P1-2 fix, и вся Send flow сломалась.)
//  2. Sender validation helpers (isFromExtensionContext, isFromOurContentScript)
//     корректно отличают popup от content-script от другого расширения.
//  3. Cross-context спуфинг отклоняется: malicious content-script не может
//     отправить POPUP_ONLY сообщение.
//
// Стратегия: мы не можем импортировать service-worker.js (он использует
// importScripts + chrome.*), но можем зеркалить его whitelist/helper логику
// и протестировать её изолированно. Также проверяем что реальный popup.js
// отправляет ТОЛЬКО whitelisted типы.

const fs = require('fs');
const path = require('path');

// ── Mirror of sender validation logic from service-worker.js ──────────
// ВАЖНО: approval window открыт через chrome.windows.create({ type:'popup' })
// имеет sender.tab СЕТ, но tab.url — chrome-extension://<id>/popup/... URL.
// Поэтому мы отличаем "наш extension page" от "content-script на http" по
// префиксу URL.

const EXT_ID = 'sova-ext-id';
const OUR_PREFIX = `chrome-extension://${EXT_ID}/`;

function isFromExtensionContext(sender) {
  if (!sender) return false;
  if (sender.id !== EXT_ID) return false;
  if (!sender.tab) return true; // классический popup — tab undefined
  const tabUrl = String(sender.tab.url || sender.url || '');
  return tabUrl.startsWith(OUR_PREFIX);
}

function isFromOurContentScript(sender) {
  if (!sender || !sender.tab || !sender.tab.url) return false;
  if (sender.id !== EXT_ID) return false;
  const tabUrl = String(sender.tab.url);
  if (tabUrl.startsWith(OUR_PREFIX)) return false;
  return true;
}

// Эти константы должны 100% совпадать с service-worker.js POPUP_ONLY_MESSAGE_TYPES
// и CONTENT_SCRIPT_MESSAGE_TYPES. Если не совпадают — один из двух списков stale.
const EXPECTED_POPUP_ONLY_TYPES = new Set([
  'unlock',
  'lock',
  'activate-account',
  'add-sub-account',
  'reset-lock-timer',
  'get-wallet-address',
  'check-wallet-unlocked',
  'network-changed',
  'send-eth',
  'send-erc20',
  'verify-password',
  'dapp-approval-response',
  'dapp-disconnect-origin',
  'dapp-get-pending',
]);

const EXPECTED_CONTENT_SCRIPT_TYPES = new Set(['dapp-request']);

// ── Helper: извлекаем whitelist прямо из исходника service-worker.js ──
// Это гарантирует что тест останется в синке с кодом.

function loadSwSource() {
  // После декомпозиции SW: sender validation constants в sw-dapp.js,
  // message handler в sw-handlers.js. Конкатенируем для полного покрытия.
  const files = [
    path.resolve(__dirname, '../../extension/background/sw-dapp.js'),
    path.resolve(__dirname, '../../extension/background/sw-handlers.js'),
    path.resolve(__dirname, '../../extension/background/service-worker.js'),
  ];
  return files
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
}

// Load message-types.js so we can resolve MessageType.XXX → string values
const messageTypesPath = path.resolve(__dirname, '../../extension/shared/message-types.js');
require(messageTypesPath);
const _MessageType = globalThis.MessageType;

function resolveMessageTypeRefs(body) {
  // Matches: MessageType.UNLOCK, MessageType.SEND_ETH, etc.
  const refs = [...body.matchAll(/MessageType\.([A-Z_0-9]+)/g)].map((m) => m[1]);
  return new Set(
    refs.map((key) => {
      if (!(key in _MessageType)) throw new Error(`Unknown MessageType.${key}`);
      return _MessageType[key];
    }),
  );
}

function extractPopupOnlyTypesFromSource(src) {
  const match = src.match(/const POPUP_ONLY_MESSAGE_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  if (!match) throw new Error('POPUP_ONLY_MESSAGE_TYPES not found in service-worker.js');
  return resolveMessageTypeRefs(match[1]);
}

function extractContentScriptTypesFromSource(src) {
  const match = src.match(/const CONTENT_SCRIPT_MESSAGE_TYPES = new Set\(\[([\s\S]*?)\]\)/);
  if (!match) throw new Error('CONTENT_SCRIPT_MESSAGE_TYPES not found in service-worker.js');
  return resolveMessageTypeRefs(match[1]);
}

function extractMessageTypesSentByPopup() {
  // Ищем во всех popup-side файлах все вызовы sendToSW({ type: MessageType.X })
  // или chrome.runtime.sendMessage({ type: MessageType.X })
  const files = [
    path.resolve(__dirname, '../../extension/popup/popup.js'),
    path.resolve(__dirname, '../../extension/popup/modules/network-state.js'),
    path.resolve(__dirname, '../../extension/popup/modules/token-state.js'),
    path.resolve(__dirname, '../../extension/popup/modules/tx-history.js'),
    path.resolve(__dirname, '../../extension/popup/modules/send-flow.js'),
    path.resolve(__dirname, '../../extension/popup/modules/dapp-approval.js'),
    path.resolve(__dirname, '../../extension/popup/modules/unlock-flow.js'),
    path.resolve(__dirname, '../../extension/popup/modules/wallet-create-import.js'),
    path.resolve(__dirname, '../../extension/popup/modules/accounts.js'),
    path.resolve(__dirname, '../../extension/popup/modules/refresh-loop.js'),
  ];

  const types = new Set();
  const pattern =
    /(?:sendToSW|chrome\.runtime\.sendMessage)\s*\(\s*\{\s*type:\s*MessageType\.([A-Z_0-9]+)/g;

  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(pattern)) {
      const key = m[1];
      if (key in _MessageType) types.add(_MessageType[key]);
    }
  }
  return types;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('sender validation: isFromExtensionContext', () => {
  it('returns true when sender has no tab and correct extension id', () => {
    expect(isFromExtensionContext({ id: 'sova-ext-id' })).toBe(true);
    expect(isFromExtensionContext({ id: 'sova-ext-id', tab: undefined })).toBe(true);
  });

  // REGRESSION: approval window открыт через chrome.windows.create({ type:'popup' })
  // имеет sender.tab с URL вида chrome-extension://<id>/popup/popup.html?request=…
  // Раньше isFromExtensionContext отвергал такие запросы (if (sender.tab) return false)
  // → popup видел "Запрос не найден" т.к. SW падал на sender validation до lookup'а.
  it('returns true for approval window (chrome.windows.create popup tab with extension URL)', () => {
    const sender = {
      id: 'sova-ext-id',
      tab: { url: 'chrome-extension://sova-ext-id/popup/popup.html?request=appr-abc' },
    };
    expect(isFromExtensionContext(sender)).toBe(true);
  });

  it('returns true for main popup tab (chrome.action) on extension URL', () => {
    const sender = {
      id: 'sova-ext-id',
      tab: { url: 'chrome-extension://sova-ext-id/popup/popup.html' },
    };
    expect(isFromExtensionContext(sender)).toBe(true);
  });

  it('returns false when sender has tab with http(s) URL (that is content-script)', () => {
    const sender = { id: 'sova-ext-id', tab: { url: 'https://evil.com' } };
    expect(isFromExtensionContext(sender)).toBe(false);
  });

  it('returns false when sender has tab with http URL (local dev site)', () => {
    const sender = { id: 'sova-ext-id', tab: { url: 'http://127.0.0.1:5173/dapp-demo.html' } };
    expect(isFromExtensionContext(sender)).toBe(false);
  });

  it('returns false when sender tab URL is another extension', () => {
    const sender = {
      id: 'sova-ext-id',
      tab: { url: 'chrome-extension://malicious-ext-id/popup.html' },
    };
    expect(isFromExtensionContext(sender)).toBe(false);
  });

  it('returns false when sender is from another extension', () => {
    const sender = { id: 'malicious-ext-id' };
    expect(isFromExtensionContext(sender)).toBe(false);
  });

  it('returns false for null/undefined sender', () => {
    expect(isFromExtensionContext(null)).toBe(false);
    expect(isFromExtensionContext(undefined)).toBe(false);
  });
});

describe('sender validation: isFromOurContentScript', () => {
  it('returns true when sender has tab.url and correct extension id', () => {
    const sender = { id: 'sova-ext-id', tab: { url: 'https://uniswap.org' } };
    expect(isFromOurContentScript(sender)).toBe(true);
  });

  it('returns true for local dev site (http://127.0.0.1)', () => {
    const sender = { id: 'sova-ext-id', tab: { url: 'http://127.0.0.1:5173/dapp-demo.html' } };
    expect(isFromOurContentScript(sender)).toBe(true);
  });

  it('returns false when sender has no tab (popup context)', () => {
    expect(isFromOurContentScript({ id: 'sova-ext-id' })).toBe(false);
    expect(isFromOurContentScript({ id: 'sova-ext-id', tab: null })).toBe(false);
  });

  it('returns false when tab exists but no url', () => {
    expect(isFromOurContentScript({ id: 'sova-ext-id', tab: {} })).toBe(false);
  });

  // REGRESSION: approval window — это НЕ content-script, хотя имеет sender.tab.
  // Отличается по префиксу tab.url — chrome-extension://<our-id>/...
  it('returns false for approval window (extension URL tab, not a real content-script)', () => {
    const sender = {
      id: 'sova-ext-id',
      tab: { url: 'chrome-extension://sova-ext-id/popup/popup.html?request=appr-xyz' },
    };
    expect(isFromOurContentScript(sender)).toBe(false);
  });

  it('returns false for different extension id', () => {
    const sender = { id: 'malicious-ext', tab: { url: 'https://attacker.com' } };
    expect(isFromOurContentScript(sender)).toBe(false);
  });

  it('returns false for null sender', () => {
    expect(isFromOurContentScript(null)).toBe(false);
  });
});

describe('POPUP_ONLY_MESSAGE_TYPES whitelist content', () => {
  let actualWhitelist;

  beforeAll(() => {
    actualWhitelist = extractPopupOnlyTypesFromSource(loadSwSource());
  });

  // Это КРИТИЧЕСКИЙ тест — он ловит именно тот баг что проскочил недавно.
  it('includes send-eth (regression guard)', () => {
    expect(actualWhitelist.has('send-eth')).toBe(true);
  });

  it('includes send-erc20 (regression guard)', () => {
    expect(actualWhitelist.has('send-erc20')).toBe(true);
  });

  it('includes all unlock/lock/activate operations', () => {
    expect(actualWhitelist.has('unlock')).toBe(true);
    expect(actualWhitelist.has('lock')).toBe(true);
    expect(actualWhitelist.has('activate-account')).toBe(true);
    expect(actualWhitelist.has('add-sub-account')).toBe(true);
  });

  it('includes auto-lock + session helpers', () => {
    expect(actualWhitelist.has('reset-lock-timer')).toBe(true);
    expect(actualWhitelist.has('get-wallet-address')).toBe(true);
    expect(actualWhitelist.has('network-changed')).toBe(true);
  });

  it('includes dApp approval lifecycle (popup → SW)', () => {
    expect(actualWhitelist.has('dapp-approval-response')).toBe(true);
    expect(actualWhitelist.has('dapp-disconnect-origin')).toBe(true);
    expect(actualWhitelist.has('dapp-get-pending')).toBe(true);
  });

  it('does NOT include dapp-request (это content-script тип)', () => {
    expect(actualWhitelist.has('dapp-request')).toBe(false);
  });

  it('actual whitelist matches expected set exactly', () => {
    // Если здесь падает — либо в SW добавили/удалили тип без обновления этого теста,
    // либо случайная опечатка в константе.
    const actualArr = [...actualWhitelist].sort();
    const expectedArr = [...EXPECTED_POPUP_ONLY_TYPES].sort();
    expect(actualArr).toEqual(expectedArr);
  });
});

describe('CONTENT_SCRIPT_MESSAGE_TYPES whitelist content', () => {
  let actualWhitelist;

  beforeAll(() => {
    actualWhitelist = extractContentScriptTypesFromSource(loadSwSource());
  });

  it('includes dapp-request', () => {
    expect(actualWhitelist.has('dapp-request')).toBe(true);
  });

  it('has exactly one entry (dapp-request is the only allowed content-script message)', () => {
    expect(actualWhitelist.size).toBe(1);
  });

  it('does NOT overlap with POPUP_ONLY_MESSAGE_TYPES', () => {
    const popupOnly = extractPopupOnlyTypesFromSource(loadSwSource());
    for (const type of actualWhitelist) {
      expect(popupOnly.has(type)).toBe(false);
    }
  });
});

describe('popup → SW message types are all whitelisted', () => {
  // Этот тест извлекает ВСЕ типы сообщений что popup.js (и его модули)
  // реально отправляют в SW, и проверяет что каждый из них присутствует
  // в POPUP_ONLY_MESSAGE_TYPES. Если нет — regression.

  let whitelist;
  let sentByPopup;

  beforeAll(() => {
    whitelist = extractPopupOnlyTypesFromSource(loadSwSource());
    sentByPopup = extractMessageTypesSentByPopup();
  });

  it('all popup-sent message types are in whitelist', () => {
    const notWhitelisted = [...sentByPopup].filter((t) => !whitelist.has(t));
    if (notWhitelisted.length > 0) {
      throw new Error(
        `The following message types are sent from popup but NOT in POPUP_ONLY_MESSAGE_TYPES:\n` +
          notWhitelisted.map((t) => `  - ${t}`).join('\n') +
          `\n\nThis will cause "Unknown message type" errors in SW.\n` +
          `Add them to extension/background/service-worker.js POPUP_ONLY_MESSAGE_TYPES.`,
      );
    }
    expect(notWhitelisted).toEqual([]);
  });

  it('found at least the expected critical types (sanity check)', () => {
    expect(sentByPopup.has('unlock')).toBe(true);
    expect(sentByPopup.has('send-eth')).toBe(true);
    expect(sentByPopup.has('send-erc20')).toBe(true);
  });
});

describe('cross-context spoofing scenarios', () => {
  // Эти тесты симулируют атакующий content-script который пытается
  // отправить POPUP_ONLY сообщение. Реальный SW должен отклонять.

  function validateMessage(msg, sender) {
    const popupOnly = EXPECTED_POPUP_ONLY_TYPES;
    const csOnly = EXPECTED_CONTENT_SCRIPT_TYPES;

    if (popupOnly.has(msg.type)) {
      if (!isFromExtensionContext(sender)) {
        throw new Error(`Permission denied: '${msg.type}' must come from extension popup`);
      }
    } else if (csOnly.has(msg.type)) {
      if (!isFromOurContentScript(sender)) {
        throw new Error(`Permission denied: '${msg.type}' must come from content script`);
      }
    } else {
      throw new Error(`Unknown message type: ${msg.type}`);
    }
    return true;
  }

  it('accepts unlock from popup context', () => {
    const msg = { type: 'unlock', accountIndex: 0, password: 'x' };
    const sender = { id: 'sova-ext-id' };
    expect(validateMessage(msg, sender)).toBe(true);
  });

  it('rejects unlock from content-script context (spoofing attempt)', () => {
    const msg = { type: 'unlock', accountIndex: 0, password: 'x' };
    const sender = { id: 'sova-ext-id', tab: { url: 'https://malicious.com' } };
    expect(() => validateMessage(msg, sender)).toThrow(/Permission denied.*unlock/);
  });

  it('rejects send-eth from content-script context', () => {
    const msg = { type: 'send-eth', to: '0xdead', amount: '0.1' };
    const sender = { id: 'sova-ext-id', tab: { url: 'https://evil.com' } };
    expect(() => validateMessage(msg, sender)).toThrow(/Permission denied.*send-eth/);
  });

  it('rejects dapp-approval-response from content-script (approval bypass attempt)', () => {
    const msg = { type: 'dapp-approval-response', id: 'appr-xxx', approved: true };
    const sender = { id: 'sova-ext-id', tab: { url: 'https://phishing.com' } };
    expect(() => validateMessage(msg, sender)).toThrow(/Permission denied.*dapp-approval-response/);
  });

  it('rejects dapp-disconnect-origin from content-script (target other origin)', () => {
    const msg = { type: 'dapp-disconnect-origin', origin: 'https://uniswap.org' };
    const sender = { id: 'sova-ext-id', tab: { url: 'https://attacker.com' } };
    expect(() => validateMessage(msg, sender)).toThrow(/Permission denied/);
  });

  it('rejects dapp-get-pending from content-script (info leak attempt)', () => {
    const msg = { type: 'dapp-get-pending', id: 'appr-xxx' };
    const sender = { id: 'sova-ext-id', tab: { url: 'https://attacker.com' } };
    expect(() => validateMessage(msg, sender)).toThrow(/Permission denied/);
  });

  it('accepts dapp-request from content-script (correct path)', () => {
    const msg = {
      type: 'dapp-request',
      origin: 'https://uniswap.org',
      payload: { method: 'eth_chainId' },
    };
    const sender = { id: 'sova-ext-id', tab: { url: 'https://uniswap.org' } };
    expect(validateMessage(msg, sender)).toBe(true);
  });

  it('rejects dapp-request from popup (wrong path)', () => {
    const msg = {
      type: 'dapp-request',
      origin: 'https://uniswap.org',
      payload: { method: 'eth_chainId' },
    };
    const sender = { id: 'sova-ext-id' }; // no tab = popup
    expect(() => validateMessage(msg, sender)).toThrow(/Permission denied.*dapp-request/);
  });

  it('rejects unknown message types', () => {
    const msg = { type: 'totally-unknown', foo: 'bar' };
    const sender = { id: 'sova-ext-id' };
    expect(() => validateMessage(msg, sender)).toThrow(/Unknown message type/);
  });

  it('rejects message from unknown extension id', () => {
    const msg = { type: 'unlock', password: 'x' };
    const sender = { id: 'different-ext-id' };
    expect(() => validateMessage(msg, sender)).toThrow(/Permission denied/);
  });
});
