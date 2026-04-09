'use strict';

// ── SOVA dApp approval controller ─────────────────────────────────────────
// Когда popup открывается с ?request=<id> в URL, мы обрабатываем
// incoming dApp-запрос: читаем pending request из SW, рендерим
// соответствующий approval UI, возвращаем ответ в SW.

(function initDappApproval(root) {
  const api = {};

  // ── URL parsing ────────────────────────────────────────────────────────
  function getRequestIdFromUrl() {
    try {
      const params = new URLSearchParams(globalThis.location ? globalThis.location.search : '');
      const id = params.get('request');
      return id || null;
    } catch { return null; }
  }
  api.getRequestIdFromUrl = getRequestIdFromUrl;

  // ── Fetch pending request ─────────────────────────────────────────────
  async function fetchPendingRequest(id) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'dapp-get-pending', id }, (resp) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          if (!resp || !resp.request) {
            // SW может вернуть { request: null, reason: 'expired' } — пробрасываем reason
            resolve(resp && resp.reason ? { _missing: true, reason: resp.reason } : null);
            return;
          }
          resolve(resp.request);
        });
      } catch { resolve(null); }
    });
  }
  api.fetchPendingRequest = fetchPendingRequest;

  async function sendApprovalResponse(id, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'dapp-approval-response', id, ...payload }, (resp) => {
          resolve(resp || { ok: false });
        });
      } catch { resolve({ ok: false }); }
    });
  }
  api.sendApprovalResponse = sendApprovalResponse;

  // ── DOM helpers ────────────────────────────────────────────────────────
  function getEl(id) { return document.getElementById(id); }

  function setText(id, text) {
    const el = getEl(id);
    if (el) el.textContent = String(text || '');
  }

  function show(id) { const el = getEl(id); if (el) el.style.display = ''; }
  function hide(id) { const el = getEl(id); if (el) el.style.display = 'none'; }

  function formatWeiAsEth(hexWei) {
    try {
      if (!hexWei) return '0';
      const wei = typeof ethers !== 'undefined' ? ethers.toBigInt(hexWei) : BigInt(hexWei);
      const str = typeof ethers !== 'undefined'
        ? ethers.formatEther(wei)
        : (Number(wei) / 1e18).toFixed(6);
      return str;
    } catch { return '?'; }
  }

  function shortAddr(addr) {
    if (!addr) return '';
    return `${String(addr).slice(0, 6)}…${String(addr).slice(-4)}`;
  }

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

  // ── Native asset symbol (по chainId) ──────────────────────────────────
  function getNativeSymbolByChainId(chainId) {
    if (chainId === 56) return 'BNB';
    return 'ETH';
  }

  // ── Render connect approval ────────────────────────────────────────────
  async function renderConnect(request, accounts) {
    setText('dapp-origin', request.origin);
    setText('dapp-method-label', 'Подключение');
    setText('dapp-subtitle', 'Запрашивает подключение к SOVA Wallet');

    const body = getEl('dapp-approval-body');
    if (!body) return;

    const list = document.createElement('div');
    list.className = 'dapp-accounts-list';
    accounts.forEach((acct, idx) => {
      const row = document.createElement('label');
      row.className = 'dapp-account-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = acct.address;
      // По дефолту даём сайту доступ ко ВСЕМ аккаунтам — тогда переключение
      // в popup'е автоматически отражается в dApp через accountsChanged.
      // Пользователь может снять галочки для конкретных аккаунтов.
      cb.checked = true;
      cb.dataset.role = 'dapp-account-cb';
      const name = document.createElement('span');
      name.className = 'dapp-account-name';
      name.textContent = acct.name || `Account ${idx + 1}`;
      const addr = document.createElement('span');
      addr.className = 'dapp-account-addr';
      addr.textContent = shortAddr(acct.address);
      row.appendChild(cb);
      row.appendChild(name);
      row.appendChild(addr);
      list.appendChild(row);
    });
    body.innerHTML = '';
    const hint = document.createElement('p');
    hint.className = 'dapp-hint';
    hint.textContent = 'Выберите аккаунты, к которым сайт получит доступ';
    body.appendChild(hint);
    body.appendChild(list);

    body.appendChild(buildWarnBox(
      '⚠️ Подключение даст сайту право читать адрес и запрашивать подпись транзакций. Приватный ключ никогда не покидает кошелёк.'
    ));
  }

  // ── Render personal_sign approval ──────────────────────────────────────
  function renderPersonalSign(request) {
    const p = request.params && request.params[0] ? request.params[0] : {};
    setText('dapp-origin', request.origin);
    setText('dapp-method-label', 'Подпись сообщения');
    setText('dapp-subtitle', 'Запрашивает подпись (personal_sign)');

    const body = getEl('dapp-approval-body');
    if (!body) return;
    body.innerHTML = '';

    body.appendChild(buildKvRow('Подписать от', shortAddr(p.address)));

    const msgLabel = document.createElement('div');
    msgLabel.className = 'dapp-kv-label';
    msgLabel.textContent = 'Сообщение:';
    body.appendChild(msgLabel);

    const pre = document.createElement('pre');
    pre.className = 'dapp-message-pre';
    pre.textContent = String(p.message || '');
    body.appendChild(pre);

    // Warning если сообщение — 64 hex символа (похоже на raw hash)
    const raw = String(p.rawMessage || '');
    if (/^0x[0-9a-fA-F]{64}$/.test(raw) && p.message === raw) {
      body.appendChild(buildWarnBox(
        '⚠️ Это сообщение выглядит как raw hash. Подписание произвольных хэшей может быть опасно.'
      ));
    }
  }

  // ── Render eth_signTypedData_v4 approval ───────────────────────────────
  function renderSignTypedData(request) {
    const p = request.params && request.params[0] ? request.params[0] : {};
    setText('dapp-origin', request.origin);
    setText('dapp-method-label', 'Подпись структурированных данных');
    setText('dapp-subtitle', 'Запрашивает EIP-712 подпись');

    const body = getEl('dapp-approval-body');
    if (!body) return;
    body.innerHTML = '';

    body.appendChild(buildKvRow('Подписать от', shortAddr(p.address)));

    // P2-4: chainId mismatch теперь блокируется в SW. Этот блок остался
    // для обратной совместимости, если в payload пришёл флаг.
    if (p.chainMismatch) {
      body.appendChild(buildWarnBox(
        '⚠️ Внимание: подпись для другой сети! domain.chainId не совпадает с активной. Это может быть phishing-атака.',
        true
      ));
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

  function renderTreeInto(parent, obj, depth) {
    if (depth > 4) {
      const truncated = document.createElement('div');
      truncated.className = 'dapp-kv';
      truncated.textContent = '…';
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

  // ── Render eth_sendTransaction approval ────────────────────────────────
  function renderSendTransaction(request) {
    const p = request.params && request.params[0] ? request.params[0] : {};
    setText('dapp-origin', request.origin);
    setText('dapp-method-label', 'Подтверждение транзакции');
    setText('dapp-subtitle', 'Запрашивает отправку транзакции');

    const body = getEl('dapp-approval-body');
    if (!body) return;
    body.innerHTML = '';

    const native = getNativeSymbolByChainId(p.chainId || 1);
    const valueEth = formatWeiAsEth(p.value);
    const feeEth = formatWeiAsEth(p.feeWei);

    const rows = [
      ['От',     shortAddr(p.from)],
      ['Кому',   p.to ? shortAddr(p.to) : '— (деплой контракта)'],
      ['Сумма',  `${valueEth} ${native}`],
      ['Газ (оценка)', `${feeEth} ${native}`],
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
          body.appendChild(buildWarnBox(
            '⚠️ Вы отправляете на этот адрес впервые. Проверьте адрес — первые и последние символы.'
          ));
        }
      });
    }
  }

  // MED-5: per-origin scoped check. Разные dApp'ы видят разные «known» наборы.
  async function checkFirstTimeRecipient(toAddress, origin) {
    try {
      const { knownRecipients = {} } = await new Promise((resolve) => {
        chrome.storage.local.get(['knownRecipients'], resolve);
      });
      const originMap = knownRecipients[origin] || {};
      const key = String(toAddress).toLowerCase();
      return !originMap[key];
    } catch { return false; }
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
    } catch { /* ignore */ }
  }

  // ── Unlock RPC helper ────────────────────────────────────────────────
  async function sendUnlockRequest(accountIndex, password) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'unlock', accountIndex, password }, (resp) => {
          resolve(resp || { ok: false, error: 'no response' });
        });
      } catch (e) { resolve({ ok: false, error: e.message }); }
    });
  }

  // ── Render inline password field для locked wallet ────────────────────
  function renderUnlockPrompt(request) {
    const body = getEl('dapp-approval-body');
    if (!body) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'dapp-unlock-prompt';

    const title = document.createElement('div');
    title.className = 'dapp-kv-label';
    title.textContent = 'Кошелёк заблокирован — введите пароль для аккаунта:';
    wrapper.appendChild(title);

    wrapper.appendChild(buildKvRow('Адрес', shortAddr(request.targetAddress)));

    const field = document.createElement('div');
    field.className = 'dapp-unlock-field';
    const label = document.createElement('label');
    label.textContent = 'Пароль';
    label.className = 'dapp-unlock-label';
    const input = document.createElement('input');
    input.type = 'password';
    input.id = 'dapp-unlock-password';
    input.placeholder = 'Введите пароль';
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

  // ── Main entry: route request → render → handle buttons ──────────────
  async function handleRequest(id) {
    const request = await fetchPendingRequest(id);
    // Если request null или _missing — показываем «истёк» и просим повторить в dApp
    if (!request || request._missing) {
      const wasExpired = request && request.reason === 'expired';
      setText('dapp-origin', '');
      setText('dapp-method-label', wasExpired ? 'Запрос истёк' : 'Запрос не найден');
      setText('dapp-subtitle', wasExpired
        ? 'Service Worker был перезапущен. Повторите действие в dApp.'
        : 'Возможно, он истёк или уже обработан.');
      const body = getEl('dapp-approval-body');
      if (body) {
        body.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'dapp-hint';
        p.textContent = 'Окно можно закрыть. Если вы хотели одобрить транзакцию, повторите запрос в dApp.';
        body.appendChild(p);
      }
      const actions = getEl('dapp-approval-actions');
      if (actions) actions.style.display = 'none';
      return;
    }

    // Expiry display
    const expiresAt = request.expiresAt || (Date.now() + 60000);
    startExpiryCountdown(expiresAt, id);

    // Route
    if (request.method === 'eth_requestAccounts') {
      const accounts = await loadAccountsForApproval();
      await renderConnect(request, accounts);
    } else if (request.method === 'personal_sign') {
      renderPersonalSign(request);
    } else if (request.method === 'eth_signTypedData_v4') {
      renderSignTypedData(request);
    } else if (request.method === 'eth_sendTransaction') {
      renderSendTransaction(request);
    } else {
      setText('dapp-method-label', 'Неизвестный метод');
      setText('dapp-subtitle', String(request.method || ''));
      const body = getEl('dapp-approval-body');
      if (body) {
        body.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'dapp-hint';
        p.textContent = 'Этот метод не поддерживается. Отклоните запрос.';
        body.appendChild(p);
      }
    }

    // Если требуется unlock — добавляем inline поле пароля в конец body
    if (request.needsUnlock && request.targetAddress != null && request.targetAccountIndex != null) {
      renderUnlockPrompt(request);
      // Меняем лейбл кнопки Approve на "Разблокировать и одобрить"
      const approveBtn = getEl('dapp-btn-approve');
      if (approveBtn) approveBtn.textContent = 'Разблокировать и одобрить';
    }

    // Bind buttons
    const approveBtn = getEl('dapp-btn-approve');
    const rejectBtn = getEl('dapp-btn-reject');
    if (approveBtn) {
      approveBtn.onclick = async () => {
        approveBtn.disabled = true;
        if (rejectBtn) rejectBtn.disabled = true;

        // Если needsUnlock — сначала unlock
        if (request.needsUnlock) {
          const pwInput = getEl('dapp-unlock-password');
          let password = pwInput ? pwInput.value : '';
          const errEl = getEl('dapp-unlock-error');
          if (!password) {
            if (errEl) errEl.textContent = 'Введите пароль';
            approveBtn.disabled = false;
            if (rejectBtn) rejectBtn.disabled = false;
            return;
          }
          const unlockRes = await sendUnlockRequest(request.targetAccountIndex, password);
          // MED-16: сразу очищаем password из памяти и DOM после использования.
          password = '';
          if (pwInput) pwInput.value = '';
          if (!unlockRes?.ok) {
            if (errEl) errEl.textContent = unlockRes?.error || 'Неверный пароль';
            approveBtn.disabled = false;
            if (rejectBtn) rejectBtn.disabled = false;
            if (pwInput) pwInput.focus();
            return;
          }
        }

        let payload = { approved: true };
        if (request.method === 'eth_requestAccounts') {
          const cbs = document.querySelectorAll('[data-role="dapp-account-cb"]');
          const addresses = [];
          cbs.forEach((cb) => {
            if (cb.checked && cb.value) addresses.push(cb.value);
          });
          if (!addresses.length && cbs.length > 0) {
            addresses.push(cbs[0].value);
          }
          payload.addresses = addresses;
        }
        if (request.method === 'eth_sendTransaction') {
          const txParam = request.params && request.params[0] ? request.params[0] : {};
          if (txParam.to) markRecipientKnown(txParam.to, request.origin); // MED-5: per-origin
        }
        await sendApprovalResponse(id, payload);
        try { window.close(); } catch { /* ignore */ }
      };
    }
    if (rejectBtn) {
      rejectBtn.onclick = async () => {
        if (approveBtn) approveBtn.disabled = true;
        rejectBtn.disabled = true;
        await sendApprovalResponse(id, { approved: false, reason: 'user-rejected' });
        try { window.close(); } catch { /* ignore */ }
      };
    }

    // Handle window close as rejection
    const unloadHandler = () => {
      sendApprovalResponse(id, { approved: false, reason: 'window-closed' }).catch(() => {});
    };
    window.addEventListener('beforeunload', unloadHandler);
  }
  api.handleRequest = handleRequest;

  function startExpiryCountdown(expiresAt, id) {
    const el = getEl('dapp-expiry-timer');
    if (!el) return;
    let interval = null;
    const tick = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      const secs = Math.ceil(remaining / 1000);
      el.textContent = `Истекает через ${secs} сек`;
      if (remaining <= 0) {
        if (interval) { clearInterval(interval); interval = null; }
        el.textContent = 'Запрос истёк';
        const approveBtn = getEl('dapp-btn-approve');
        const rejectBtn = getEl('dapp-btn-reject');
        if (approveBtn) approveBtn.disabled = true;
        if (rejectBtn) rejectBtn.disabled = true;
      }
    };
    tick();
    interval = setInterval(tick, 1000);
    // MED-15: cleanup timer при закрытии окна (approval popup = отдельное
    // window которое закрывается после approve/reject/timeout). Без этого —
    // memory leak если beforeunload не fired по какой-то причине.
    window.addEventListener('beforeunload', () => {
      if (interval) { clearInterval(interval); interval = null; }
    });
  }

  async function loadAccountsForApproval() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['accounts'], ({ accounts }) => {
          resolve(Array.isArray(accounts) ? accounts : []);
        });
      } catch { resolve([]); }
    });
  }

  // ── Connected Sites screen support ────────────────────────────────────
  async function loadConnectedOrigins() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['connectedOrigins'], ({ connectedOrigins }) => {
          resolve(connectedOrigins && typeof connectedOrigins === 'object' ? connectedOrigins : {});
        });
      } catch { resolve({}); }
    });
  }
  api.loadConnectedOrigins = loadConnectedOrigins;

  async function disconnectOrigin(origin) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'dapp-disconnect-origin', origin }, (resp) => {
          resolve(resp || { ok: false });
        });
      } catch { resolve({ ok: false }); }
    });
  }
  api.disconnectOrigin = disconnectOrigin;

  async function renderConnectedSitesList(containerId) {
    const container = getEl(containerId);
    if (!container) return;
    const origins = await loadConnectedOrigins();
    const keys = Object.keys(origins);
    container.innerHTML = '';
    if (keys.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Нет подключённых сайтов';
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
      btn.textContent = 'Отключить';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await disconnectOrigin(origin);
        renderConnectedSitesList(containerId);
      });
      row.appendChild(info);
      row.appendChild(btn);
      container.appendChild(row);
    });
  }
  api.renderConnectedSitesList = renderConnectedSitesList;

  root.WolfPopupDappApproval = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
