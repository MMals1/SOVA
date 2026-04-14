'use strict';

// ── SOVA dApp approval controller (logic only) ─────────────────────────
// Когда popup открывается с ?request=<id> в URL, мы обрабатываем
// incoming dApp-запрос: читаем pending request из SW, рендерим
// соответствующий approval UI (через WolfPopupDappApprovalRender),
// возвращаем ответ в SW.
//
// Render-функции и DOM-хелперы вынесены в dapp-approval-render.js
// (загружается перед этим файлом — см. popup.html).

const api = {};
const Render = globalThis.WolfPopupDappApprovalRender;

// ── URL parsing ────────────────────────────────────────────────────────
function getRequestIdFromUrl() {
  try {
    const params = new URLSearchParams(globalThis.location ? globalThis.location.search : '');
    const id = params.get('request');
    return id || null;
  } catch {
    return null;
  }
}
api.getRequestIdFromUrl = getRequestIdFromUrl;

// ── Fetch pending request ─────────────────────────────────────────────
async function fetchPendingRequest(id) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: MessageType.DAPP_GET_PENDING, id }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (!resp || !resp.request) {
          // SW может вернуть { request: null, reason: 'expired' } — пробрасываем reason
          resolve(resp && resp.reason ? { _missing: true, reason: resp.reason } : null);
          return;
        }
        resolve(resp.request);
      });
    } catch {
      resolve(null);
    }
  });
}
api.fetchPendingRequest = fetchPendingRequest;

async function sendApprovalResponse(id, payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: MessageType.DAPP_APPROVAL_RESPONSE, id, ...payload },
        (resp) => {
          resolve(resp || { ok: false });
        },
      );
    } catch {
      resolve({ ok: false });
    }
  });
}
api.sendApprovalResponse = sendApprovalResponse;

// ── Unlock RPC helpers ───────────────────────────────────────────────
async function sendUnlockRequest(accountIndex, password) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: MessageType.UNLOCK, accountIndex, password }, (resp) => {
        resolve(resp || { ok: false, error: 'no response' });
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

async function checkWalletUnlocked(address) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: MessageType.CHECK_WALLET_UNLOCKED, address }, (resp) => {
        resolve(resp?.unlocked === true);
      });
    } catch {
      resolve(false);
    }
  });
}

// ── Main entry: route request → render → handle buttons ──────────────
async function handleRequest(id) {
  const request = await fetchPendingRequest(id);
  // Если request null или _missing — показываем «истёк» и просим повторить в dApp
  if (!request || request._missing) {
    const wasExpired = request && request.reason === 'expired';
    Render.setText('dapp-origin', '');
    Render.setText('dapp-method-label', wasExpired ? 'Запрос истёк' : 'Запрос не найден');
    Render.setText(
      'dapp-subtitle',
      wasExpired
        ? 'Service Worker был перезапущен. Повторите действие в dApp.'
        : 'Возможно, он истёк или уже обработан.',
    );
    const body = Render.getEl('dapp-approval-body');
    if (body) {
      body.replaceChildren();
      const p = document.createElement('p');
      p.className = 'dapp-hint';
      p.textContent =
        'Окно можно закрыть. Если вы хотели одобрить транзакцию, повторите запрос в dApp.';
      body.appendChild(p);
    }
    const actions = Render.getEl('dapp-approval-actions');
    if (actions) actions.style.display = 'none';
    return;
  }

  // Expiry display
  const expiresAt = request.expiresAt || Date.now() + 60000;
  startExpiryCountdown(expiresAt, id);

  // Route
  if (request.method === 'eth_requestAccounts') {
    const accounts = await loadAccountsForApproval();
    await Render.renderConnect(request, accounts, checkWalletUnlocked);
  } else if (request.method === 'personal_sign') {
    Render.renderPersonalSign(request);
  } else if (request.method === 'eth_signTypedData_v4') {
    Render.renderSignTypedData(request);
  } else if (request.method === 'eth_sendTransaction') {
    Render.renderSendTransaction(request);
  } else {
    Render.setText('dapp-method-label', 'Неизвестный метод');
    Render.setText('dapp-subtitle', String(request.method || ''));
    const body = Render.getEl('dapp-approval-body');
    if (body) {
      body.replaceChildren();
      const p = document.createElement('p');
      p.className = 'dapp-hint';
      p.textContent = 'Этот метод не поддерживается. Отклоните запрос.';
      body.appendChild(p);
    }
  }

  // Если требуется unlock — добавляем inline поле пароля в конец body
  if (request.needsUnlock && request.targetAddress != null && request.targetAccountIndex != null) {
    Render.renderUnlockPrompt(request);
    // Меняем лейбл кнопки Approve на "Разблокировать и одобрить"
    const approveBtn = Render.getEl('dapp-btn-approve');
    if (approveBtn) approveBtn.textContent = 'Разблокировать и одобрить';
  }

  // Bind buttons
  const approveBtn = Render.getEl('dapp-btn-approve');
  const rejectBtn = Render.getEl('dapp-btn-reject');
  if (approveBtn) {
    approveBtn.onclick = async () => {
      approveBtn.disabled = true;
      if (rejectBtn) rejectBtn.disabled = true;

      // Если needsUnlock задан SW'ом (personal_sign, eth_sendTransaction, locked reconnect)
      if (request.needsUnlock) {
        const pwInput = Render.getEl('dapp-unlock-password');
        let password = pwInput ? pwInput.value : '';
        const errEl = Render.getEl('dapp-unlock-error');
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

      const payload = { approved: true };
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

        // ── Динамическая проверка: если выбранный аккаунт НЕ разблокирован,
        // а request.needsUnlock не был задан SW'ом (новое подключение) —
        // требуем ввод пароля прямо здесь ──
        if (!request.needsUnlock && addresses.length > 0) {
          const selectedRb = document.querySelector('input[name="dapp-account-select"]:checked');
          const isLocked = selectedRb && selectedRb.dataset.unlocked === '0';
          if (isLocked) {
            const pwInput = Render.getEl('dapp-connect-pw-input');
            let password = pwInput ? pwInput.value : '';
            const errEl = Render.getEl('dapp-connect-pw-error');
            if (!password) {
              if (errEl) errEl.textContent = 'Введите пароль для разблокировки';
              approveBtn.disabled = false;
              if (rejectBtn) rejectBtn.disabled = false;
              if (pwInput) pwInput.focus();
              return;
            }
            const acctIdx = parseInt(selectedRb.dataset.accountIndex, 10);
            const unlockRes = await sendUnlockRequest(acctIdx, password);
            password = '';
            if (pwInput) pwInput.value = '';
            if (!unlockRes?.ok) {
              if (errEl) errEl.textContent = unlockRes?.error || 'Неверный пароль';
              approveBtn.disabled = false;
              if (rejectBtn) rejectBtn.disabled = false;
              if (pwInput) pwInput.focus();
              return;
            }
            // Успешно разблокирован — обновляем статус
            if (selectedRb) selectedRb.dataset.unlocked = '1';
          }
        }
      }
      if (request.method === 'eth_sendTransaction') {
        const txParam = request.params && request.params[0] ? request.params[0] : {};
        if (txParam.to) Render.markRecipientKnown(txParam.to, request.origin); // MED-5: per-origin
      }
      await sendApprovalResponse(id, payload);
      try {
        window.close();
      } catch {
        /* ignore */
      }
    };
  }
  if (rejectBtn) {
    rejectBtn.onclick = async () => {
      if (approveBtn) approveBtn.disabled = true;
      rejectBtn.disabled = true;
      await sendApprovalResponse(id, { approved: false, reason: 'user-rejected' });
      try {
        window.close();
      } catch {
        /* ignore */
      }
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
  const el = Render.getEl('dapp-expiry-timer');
  if (!el) return;
  let interval = null;
  const tick = () => {
    const remaining = Math.max(0, expiresAt - Date.now());
    const secs = Math.ceil(remaining / 1000);
    el.textContent = `Истекает через ${secs} сек`;
    if (remaining <= 0) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      el.textContent = 'Запрос истёк';
      const approveBtn = Render.getEl('dapp-btn-approve');
      const rejectBtn = Render.getEl('dapp-btn-reject');
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
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  });
}

async function loadAccountsForApproval() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['accounts'], ({ accounts }) => {
        resolve(Array.isArray(accounts) ? accounts : []);
      });
    } catch {
      resolve([]);
    }
  });
}

// ── Connected Sites screen support ────────────────────────────────────
async function loadConnectedOrigins() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['connectedOrigins'], ({ connectedOrigins }) => {
        resolve(connectedOrigins && typeof connectedOrigins === 'object' ? connectedOrigins : {});
      });
    } catch {
      resolve({});
    }
  });
}
api.loadConnectedOrigins = loadConnectedOrigins;

async function disconnectOrigin(origin) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: MessageType.DAPP_DISCONNECT_ORIGIN, origin }, (resp) => {
        resolve(resp || { ok: false });
      });
    } catch {
      resolve({ ok: false });
    }
  });
}
api.disconnectOrigin = disconnectOrigin;

// Convenience wrapper: delegates to Render, injecting logic dependencies
async function renderConnectedSitesList(containerId) {
  return Render.renderConnectedSitesList(containerId, loadConnectedOrigins, disconnectOrigin);
}
api.renderConnectedSitesList = renderConnectedSitesList;

export const WolfPopupDappApproval = api;
globalThis.WolfPopupDappApproval = WolfPopupDappApproval;
