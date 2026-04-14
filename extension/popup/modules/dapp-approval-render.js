'use strict';

// ── SOVA dApp approval — render functions & DOM helpers ─────────────────
// Все функции отрисовки approval UI вынесены сюда из dapp-approval.js.
// Загружается ПЕРЕД dapp-approval.js (см. popup.html).

const api = {};

// ── DOM helpers ────────────────────────────────────────────────────────
function getEl(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = getEl(id);
  if (el) el.textContent = String(text || '');
}

function show(id) {
  const el = getEl(id);
  if (el) el.style.display = '';
}
function hide(id) {
  const el = getEl(id);
  if (el) el.style.display = 'none';
}

function formatWeiAsEth(hexWei) {
  try {
    if (!hexWei) return '0';
    const wei = typeof ethers !== 'undefined' ? ethers.toBigInt(hexWei) : BigInt(hexWei);
    const str =
      typeof ethers !== 'undefined' ? ethers.formatEther(wei) : (Number(wei) / 1e18).toFixed(6);
    return str;
  } catch {
    return '?';
  }
}

function shortAddr(addr) {
  if (!addr) return '';
  return `${String(addr).slice(0, 6)}\u2026${String(addr).slice(-4)}`;
}

// Expose DOM helpers for use by the logic module
api.getEl = getEl;
api.setText = setText;
api.show = show;
api.hide = hide;
api.formatWeiAsEth = formatWeiAsEth;
api.shortAddr = shortAddr;

// ── Safe DOM helpers (P2-3): защита от XSS через innerHTML ──────────────
// Используется вместо innerHTML с string interpolation. Гарантия что
// dApp-controlled данные никогда не интерпретируются как HTML.
function buildKvRow(label, value, opts = {}) {
  const row = document.createElement('div');
  row.className = 'dapp-kv';
  const k = document.createElement('span');
  k.className = 'dapp-k';
  k.textContent = String(label || '');
  const v = document.createElement('span');
  v.className = opts.mono === false ? 'dapp-v' : 'dapp-v mono';
  v.textContent = String(value == null ? '' : value);
  row.appendChild(k);
  row.appendChild(v);
  return row;
}

function buildTreeTitle(text) {
  const title = document.createElement('div');
  title.className = 'dapp-tree-title';
  title.textContent = String(text || '');
  return title;
}

function buildWarnBox(text, danger = false) {
  const warn = document.createElement('div');
  warn.className = 'dapp-warn-box' + (danger ? ' dapp-warn-danger' : '');
  warn.textContent = String(text || '');
  return warn;
}

api.buildKvRow = buildKvRow;
api.buildTreeTitle = buildTreeTitle;
api.buildWarnBox = buildWarnBox;

// ── Native asset symbol (по chainId) ──────────────────────────────────
function getNativeSymbolByChainId(chainId) {
  if (chainId === 56) return 'BNB';
  return 'ETH';
}
api.getNativeSymbolByChainId = getNativeSymbolByChainId;

// ── Recursive tree renderer ───────────────────────────────────────────
function renderTreeInto(parent, obj, depth) {
  if (depth > 4) {
    const truncated = document.createElement('div');
    truncated.className = 'dapp-kv';
    truncated.textContent = '\u2026';
    parent.appendChild(truncated);
    return;
  }
  if (obj === null || obj === undefined) {
    const row = document.createElement('div');
    row.className = 'dapp-kv';
    const v = document.createElement('span');
    v.className = 'dapp-v';
    v.textContent = obj === null ? 'null' : 'undefined';
    row.appendChild(v);
    parent.appendChild(row);
    return;
  }
  if (typeof obj !== 'object') {
    const row = document.createElement('div');
    row.className = 'dapp-kv';
    const v = document.createElement('span');
    v.className = 'dapp-v mono';
    v.textContent = String(obj);
    row.appendChild(v);
    parent.appendChild(row);
    return;
  }
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== null && typeof v === 'object') {
      const nested = document.createElement('div');
      nested.className = 'dapp-tree-nested';
      const key = document.createElement('div');
      key.className = 'dapp-tree-key';
      key.textContent = String(k);
      nested.appendChild(key);
      renderTreeInto(nested, v, depth + 1);
      parent.appendChild(nested);
    } else {
      parent.appendChild(buildKvRow(k, String(v)));
    }
  });
}
api.renderTreeInto = renderTreeInto;

// ── Security helpers: first-time recipient (per-origin, MED-5) ────────
async function checkFirstTimeRecipient(toAddress, origin) {
  try {
    const { knownRecipients = {} } = await new Promise((resolve) => {
      chrome.storage.local.get(['knownRecipients'], resolve);
    });
    const originMap = knownRecipients[origin] || {};
    const key = String(toAddress).toLowerCase();
    return !originMap[key];
  } catch {
    return false;
  }
}

async function markRecipientKnown(toAddress, origin) {
  try {
    const { knownRecipients = {} } = await new Promise((resolve) => {
      chrome.storage.local.get(['knownRecipients'], resolve);
    });
    if (!knownRecipients[origin]) knownRecipients[origin] = {};
    knownRecipients[origin][String(toAddress).toLowerCase()] = Date.now();
    await new Promise((resolve) => {
      chrome.storage.local.set({ knownRecipients }, resolve);
    });
  } catch {
    /* ignore */
  }
}

api.checkFirstTimeRecipient = checkFirstTimeRecipient;
api.markRecipientKnown = markRecipientKnown;

// ── Render connect approval ────────────────────────────────────────────
// _connectAccounts хранит массив аккаунтов для использования в approve handler
let _connectAccounts = [];

/**
 * @param {object} request
 * @param {Array} accounts
 * @param {function} checkWalletUnlocked — injected from logic module
 */
async function renderConnect(request, accounts, checkWalletUnlocked) {
  _connectAccounts = accounts;
  setText('dapp-origin', request.origin);
  setText(
    'dapp-method-label',
    '\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435',
  );
  setText(
    'dapp-subtitle',
    '\u0417\u0430\u043f\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u043a SOVA Wallet',
  );

  const body = getEl('dapp-approval-body');
  if (!body) return;

  // Запрашиваем unlock-статус для каждого аккаунта
  const unlockStatuses = await Promise.all(
    accounts.map((acct) => checkWalletUnlocked(acct.address)),
  );

  const list = document.createElement('div');
  list.className = 'dapp-accounts-list';

  // Определяем preselect index.
  // Если SW прислал targetAccountIndex (locked-reconnect: re-auth конкретного
  // granted-аккаунта) — выбираем его, чтобы inline-поле пароля появилось сразу
  // под нужной строкой. Иначе fallback на активный аккаунт popup'а.
  const PopupState = globalThis.WolfPopupSharedState || {};
  const activeIdx = PopupState.activeAccountIndex || 0;
  const preselectIdx =
    typeof request.targetAccountIndex === 'number' &&
    request.targetAccountIndex >= 0 &&
    request.targetAccountIndex < accounts.length
      ? request.targetAccountIndex
      : activeIdx;

  accounts.forEach((acct, idx) => {
    const row = document.createElement('label');
    row.className = 'dapp-account-row';

    const rb = document.createElement('input');
    rb.type = 'radio';
    rb.name = 'dapp-account-select';
    rb.value = acct.address;
    rb.checked = idx === preselectIdx;
    rb.dataset.role = 'dapp-account-cb';
    rb.dataset.accountIndex = String(idx);
    rb.dataset.unlocked = unlockStatuses[idx] ? '1' : '0';

    const info = document.createElement('div');
    info.className = 'dapp-account-info';
    const name = document.createElement('span');
    name.className = 'dapp-account-name';
    name.textContent = acct.name || `Account ${idx + 1}`;
    info.appendChild(name);
    if (!unlockStatuses[idx]) {
      const lock = document.createElement('span');
      lock.className = 'dapp-account-lock';
      lock.title = '\u0417\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d';
      info.appendChild(lock);
    }

    const addr = document.createElement('span');
    addr.className = 'dapp-account-addr';
    addr.textContent = shortAddr(acct.address);

    row.appendChild(rb);
    row.appendChild(info);
    row.appendChild(addr);
    list.appendChild(row);
  });
  body.replaceChildren();
  const hint = document.createElement('p');
  hint.className = 'dapp-hint';
  hint.textContent =
    '\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u043a\u043a\u0430\u0443\u043d\u0442 \u0434\u043b\u044f \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u044f \u043a \u0441\u0430\u0439\u0442\u0443';
  body.appendChild(hint);
  body.appendChild(list);

  // Контейнер для динамического поля пароля (появится при выборе locked аккаунта)
  const pwContainer = document.createElement('div');
  pwContainer.id = 'dapp-connect-unlock-area';
  body.appendChild(pwContainer);

  body.appendChild(
    buildWarnBox(
      '\u26a0\ufe0f \u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u0434\u0430\u0441\u0442 \u0441\u0430\u0439\u0442\u0443 \u043f\u0440\u0430\u0432\u043e \u0447\u0438\u0442\u0430\u0442\u044c \u0430\u0434\u0440\u0435\u0441 \u0438 \u0437\u0430\u043f\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044c \u043f\u043e\u0434\u043f\u0438\u0441\u044c \u0442\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0439. \u041f\u0440\u0438\u0432\u0430\u0442\u043d\u044b\u0439 \u043a\u043b\u044e\u0447 \u043d\u0438\u043a\u043e\u0433\u0434\u0430 \u043d\u0435 \u043f\u043e\u043a\u0438\u0434\u0430\u0435\u0442 \u043a\u043e\u0448\u0435\u043b\u0451\u043a.',
    ),
  );

  // Реактивно показываем/прячем поле пароля при смене radio
  const updatePasswordVisibility = () => {
    const selected = document.querySelector('input[name="dapp-account-select"]:checked');
    const area = getEl('dapp-connect-unlock-area');
    const approveBtn = getEl('dapp-btn-approve');
    if (!selected || !area) return;
    const isLocked = selected.dataset.unlocked === '0';
    if (isLocked) {
      if (!getEl('dapp-connect-pw-input')) {
        area.replaceChildren();
        const title = document.createElement('div');
        title.className = 'dapp-kv-label';
        const lockEl = document.createElement('span');
        lockEl.className = 'dapp-account-lock';
        lockEl.style.marginRight = '6px';
        lockEl.style.verticalAlign = 'middle';
        title.appendChild(lockEl);
        title.appendChild(
          document.createTextNode(
            ' \u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d \u2014 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c:',
          ),
        );
        area.appendChild(title);
        const field = document.createElement('div');
        field.className = 'dapp-unlock-field';
        const input = document.createElement('input');
        input.type = 'password';
        input.id = 'dapp-connect-pw-input';
        input.placeholder = '\u041f\u0430\u0440\u043e\u043b\u044c';
        input.className = 'dapp-unlock-input';
        input.autocomplete = 'current-password';
        field.appendChild(input);
        area.appendChild(field);
        const err = document.createElement('div');
        err.id = 'dapp-connect-pw-error';
        err.className = 'dapp-unlock-error';
        area.appendChild(err);
        // Enter в поле пароля = approve
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const btn = getEl('dapp-btn-approve');
            if (btn && !btn.disabled) btn.click();
          }
        });
        input.focus();
      }
      if (approveBtn)
        approveBtn.textContent =
          '\u0420\u0430\u0437\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0438 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c';
    } else {
      area.replaceChildren();
      if (approveBtn)
        approveBtn.textContent = '\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c';
    }
  };

  // Навешиваем listener на все radio
  list.querySelectorAll('input[type="radio"]').forEach((rb) => {
    rb.addEventListener('change', updatePasswordVisibility);
  });
  // Инициализация для текущего выбранного
  updatePasswordVisibility();
}
api.renderConnect = renderConnect;

// ── Render personal_sign approval ──────────────────────────────────────
function renderPersonalSign(request) {
  const p = request.params && request.params[0] ? request.params[0] : {};
  setText('dapp-origin', request.origin);
  setText(
    'dapp-method-label',
    '\u041f\u043e\u0434\u043f\u0438\u0441\u044c \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f',
  );
  setText(
    'dapp-subtitle',
    '\u0417\u0430\u043f\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 \u043f\u043e\u0434\u043f\u0438\u0441\u044c (personal_sign)',
  );

  const body = getEl('dapp-approval-body');
  if (!body) return;
  body.replaceChildren();

  body.appendChild(
    buildKvRow(
      '\u041f\u043e\u0434\u043f\u0438\u0441\u0430\u0442\u044c \u043e\u0442',
      shortAddr(p.address),
    ),
  );

  const msgLabel = document.createElement('div');
  msgLabel.className = 'dapp-kv-label';
  msgLabel.textContent = '\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435:';
  body.appendChild(msgLabel);

  const pre = document.createElement('pre');
  pre.className = 'dapp-message-pre';
  pre.textContent = String(p.message || '');
  body.appendChild(pre);

  // Warning если сообщение — 64 hex символа (похоже на raw hash)
  const raw = String(p.rawMessage || '');
  if (/^0x[0-9a-fA-F]{64}$/.test(raw) && p.message === raw) {
    body.appendChild(
      buildWarnBox(
        '\u26a0\ufe0f \u042d\u0442\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0432\u044b\u0433\u043b\u044f\u0434\u0438\u0442 \u043a\u0430\u043a raw hash. \u041f\u043e\u0434\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u043f\u0440\u043e\u0438\u0437\u0432\u043e\u043b\u044c\u043d\u044b\u0445 \u0445\u044d\u0448\u0435\u0439 \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c \u043e\u043f\u0430\u0441\u043d\u043e.',
      ),
    );
  }
}
api.renderPersonalSign = renderPersonalSign;

// ── Render eth_signTypedData_v4 approval ───────────────────────────────
function renderSignTypedData(request) {
  const p = request.params && request.params[0] ? request.params[0] : {};
  setText('dapp-origin', request.origin);
  setText(
    'dapp-method-label',
    '\u041f\u043e\u0434\u043f\u0438\u0441\u044c \u0441\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u044b\u0445 \u0434\u0430\u043d\u043d\u044b\u0445',
  );
  setText(
    'dapp-subtitle',
    '\u0417\u0430\u043f\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 EIP-712 \u043f\u043e\u0434\u043f\u0438\u0441\u044c',
  );

  const body = getEl('dapp-approval-body');
  if (!body) return;
  body.replaceChildren();

  body.appendChild(
    buildKvRow(
      '\u041f\u043e\u0434\u043f\u0438\u0441\u0430\u0442\u044c \u043e\u0442',
      shortAddr(p.address),
    ),
  );

  // P2-4: chainId mismatch теперь блокируется в SW. Этот блок остался
  // для обратной совместимости, если в payload пришёл флаг.
  if (p.chainMismatch) {
    body.appendChild(
      buildWarnBox(
        '\u26a0\ufe0f \u0412\u043d\u0438\u043c\u0430\u043d\u0438\u0435: \u043f\u043e\u0434\u043f\u0438\u0441\u044c \u0434\u043b\u044f \u0434\u0440\u0443\u0433\u043e\u0439 \u0441\u0435\u0442\u0438! domain.chainId \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u0435\u0442 \u0441 \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0439. \u042d\u0442\u043e \u043c\u043e\u0436\u0435\u0442 \u0431\u044b\u0442\u044c phishing-\u0430\u0442\u0430\u043a\u0430.',
        true,
      ),
    );
  }

  const td = p.typedData || {};
  if (td.domain) {
    const dom = document.createElement('div');
    dom.className = 'dapp-tree';
    dom.appendChild(buildTreeTitle('Domain'));
    Object.entries(td.domain).forEach(([k, v]) => {
      dom.appendChild(buildKvRow(k, String(v)));
    });
    body.appendChild(dom);
  }

  if (td.primaryType) {
    body.appendChild(buildKvRow('primaryType', td.primaryType, { mono: false }));
  }

  if (td.message) {
    const msgBlock = document.createElement('div');
    msgBlock.className = 'dapp-tree';
    msgBlock.appendChild(buildTreeTitle('Message'));
    renderTreeInto(msgBlock, td.message, 0);
    body.appendChild(msgBlock);
  }
}
api.renderSignTypedData = renderSignTypedData;

// ── Render eth_sendTransaction approval ────────────────────────────────
function renderSendTransaction(request) {
  const p = request.params && request.params[0] ? request.params[0] : {};
  setText('dapp-origin', request.origin);
  setText(
    'dapp-method-label',
    '\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435 \u0442\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438',
  );
  setText(
    'dapp-subtitle',
    '\u0417\u0430\u043f\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0443 \u0442\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0438',
  );

  const body = getEl('dapp-approval-body');
  if (!body) return;
  body.replaceChildren();

  const native = getNativeSymbolByChainId(p.chainId || 1);
  const valueEth = formatWeiAsEth(p.value);
  const feeEth = formatWeiAsEth(p.feeWei);

  const rows = [
    ['\u041e\u0442', shortAddr(p.from)],
    [
      '\u041a\u043e\u043c\u0443',
      p.to
        ? shortAddr(p.to)
        : '\u2014 (\u0434\u0435\u043f\u043b\u043e\u0439 \u043a\u043e\u043d\u0442\u0440\u0430\u043a\u0442\u0430)',
    ],
    ['\u0421\u0443\u043c\u043c\u0430', `${valueEth} ${native}`],
    ['\u0413\u0430\u0437 (\u043e\u0446\u0435\u043d\u043a\u0430)', `${feeEth} ${native}`],
  ];
  rows.forEach(([k, v]) => {
    body.appendChild(buildKvRow(k, v));
  });

  if (p.data && p.data !== '0x') {
    const dataToggle = document.createElement('details');
    dataToggle.className = 'dapp-data-toggle';
    const sum = document.createElement('summary');
    sum.textContent = 'Raw data';
    dataToggle.appendChild(sum);
    const pre = document.createElement('pre');
    pre.className = 'dapp-data-pre';
    pre.textContent = p.data;
    dataToggle.appendChild(pre);
    body.appendChild(dataToggle);
  }

  // First-time recipient check — scoped per-origin (MED-5).
  // Раньше было глобально — отправка с dApp A засчитывала адрес как known
  // для dApp B, что позволяло dApp B скрыть warning через data leak.
  if (p.to) {
    checkFirstTimeRecipient(p.to, request.origin).then((isFirstTime) => {
      if (isFirstTime) {
        body.appendChild(
          buildWarnBox(
            '\u26a0\ufe0f \u0412\u044b \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u0442\u0435 \u043d\u0430 \u044d\u0442\u043e\u0442 \u0430\u0434\u0440\u0435\u0441 \u0432\u043f\u0435\u0440\u0432\u044b\u0435. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 \u2014 \u043f\u0435\u0440\u0432\u044b\u0435 \u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0435 \u0441\u0438\u043c\u0432\u043e\u043b\u044b.',
          ),
        );
      }
    });
  }
}
api.renderSendTransaction = renderSendTransaction;

// ── Render inline password field для locked wallet ────────────────────
function renderUnlockPrompt(request) {
  const body = getEl('dapp-approval-body');
  if (!body) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'dapp-unlock-prompt';

  const title = document.createElement('div');
  title.className = 'dapp-kv-label';
  title.textContent =
    '\u041a\u043e\u0448\u0435\u043b\u0451\u043a \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d \u2014 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c \u0434\u043b\u044f \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u0430:';
  wrapper.appendChild(title);

  wrapper.appendChild(
    buildKvRow('\u0410\u0434\u0440\u0435\u0441', shortAddr(request.targetAddress)),
  );

  const field = document.createElement('div');
  field.className = 'dapp-unlock-field';
  const label = document.createElement('label');
  label.textContent = '\u041f\u0430\u0440\u043e\u043b\u044c';
  label.className = 'dapp-unlock-label';
  const input = document.createElement('input');
  input.type = 'password';
  input.id = 'dapp-unlock-password';
  input.placeholder =
    '\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0430\u0440\u043e\u043b\u044c';
  input.className = 'dapp-unlock-input';
  input.autocomplete = 'current-password';
  field.appendChild(label);
  field.appendChild(input);
  wrapper.appendChild(field);

  const err = document.createElement('div');
  err.id = 'dapp-unlock-error';
  err.className = 'dapp-unlock-error';
  wrapper.appendChild(err);

  body.appendChild(wrapper);

  // Фокус на поле пароля и Enter = approve
  setTimeout(() => input.focus(), 50);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const btn = getEl('dapp-btn-approve');
      if (btn && !btn.disabled) btn.click();
    }
  });
}
api.renderUnlockPrompt = renderUnlockPrompt;

// ── Connected Sites list renderer ─────────────────────────────────────
/**
 * @param {string} containerId
 * @param {function} loadConnectedOrigins — injected from logic module
 * @param {function} disconnectOrigin — injected from logic module
 */
async function renderConnectedSitesList(containerId, loadConnectedOrigins, disconnectOrigin) {
  const container = getEl(containerId);
  if (!container) return;
  const origins = await loadConnectedOrigins();
  const keys = Object.keys(origins);
  container.replaceChildren();
  if (keys.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent =
      '\u041d\u0435\u0442 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0451\u043d\u043d\u044b\u0445 \u0441\u0430\u0439\u0442\u043e\u0432';
    container.appendChild(empty);
    return;
  }
  keys.forEach((origin) => {
    const record = origins[origin];
    const row = document.createElement('div');
    row.className = 'connected-site-row';
    const info = document.createElement('div');
    info.className = 'connected-site-info';
    const domain = document.createElement('div');
    domain.className = 'connected-site-domain';
    domain.textContent = origin;
    const addrs = document.createElement('div');
    addrs.className = 'connected-site-addrs';
    const first = (record.addresses && record.addresses[0]) || '';
    addrs.textContent = first
      ? `${shortAddr(first)}${record.addresses.length > 1 ? ` +${record.addresses.length - 1}` : ''}`
      : '';
    info.appendChild(domain);
    info.appendChild(addrs);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-danger btn-sm';
    btn.textContent = '\u041e\u0442\u043a\u043b\u044e\u0447\u0438\u0442\u044c';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await disconnectOrigin(origin);
      renderConnectedSitesList(containerId, loadConnectedOrigins, disconnectOrigin);
    });
    row.appendChild(info);
    row.appendChild(btn);
    container.appendChild(row);
  });
}
api.renderConnectedSitesList = renderConnectedSitesList;

export const WolfPopupDappApprovalRender = api;
globalThis.WolfPopupDappApprovalRender = WolfPopupDappApprovalRender;
