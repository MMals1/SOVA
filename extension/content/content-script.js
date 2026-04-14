'use strict';

// ── SOVA Wallet content-script (bridge) ────────────────────────────────────
// Живёт в isolated world расширения. Задачи:
//   1. Инжектировать inpage/provider.js в MAIN world страницы (до выполнения
//      скриптов dApp'а).
//   2. Форвардить сообщения от inpage → service worker и обратно.
//   3. Транслировать broadcast-события (accountsChanged, chainChanged) от SW
//      в inpage (через window.postMessage).
//
// Content-script не хранит никаких критичных данных — всё в SW.

(function initSovaContentScript() {
  const CONTENT_TARGET = 'sova-content';
  const INPAGE_TARGET = 'sova-inpage';

  // ── 1. Инжекция inpage скрипта ─────────────────────────────────────────────
  try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inpage/provider.js');
    script.setAttribute('data-sova-inpage', '1');
    script.onload = () => {
      script.remove();
    };
    script.onerror = () => {
      console.error('[SOVA] failed to load inpage provider');
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (err) {
    console.error('[SOVA] content-script injection failed', err);
  }

  // ── 2. inpage → content → SW ──────────────────────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.target !== CONTENT_TARGET) return;
    if (!data.id || !data.payload || typeof data.payload !== 'object') return;

    const { id, payload } = data;
    const origin = window.location.origin;

    try {
      chrome.runtime.sendMessage(
        {
          type: MessageType.DAPP_REQUEST,
          origin,
          payload: {
            id,
            method: payload.method,
            params: payload.params || [],
          },
        },
        (response) => {
          // Chrome runtime может вернуть lastError если SW не отвечает
          if (chrome.runtime.lastError) {
            postToInpage(id, null, {
              code: 4100,
              message: chrome.runtime.lastError.message || 'Service worker unavailable',
            });
            return;
          }
          if (!response || typeof response !== 'object') {
            postToInpage(id, null, { code: 4100, message: 'Empty SW response' });
            return;
          }
          if (response.error) {
            postToInpage(id, null, response.error);
          } else {
            postToInpage(id, response.result);
          }
        },
      );
    } catch (err) {
      postToInpage(id, null, { code: 4100, message: err.message || 'sendMessage failed' });
    }
  });

  function postToInpage(id, result, error) {
    const msg = { target: INPAGE_TARGET, id };
    if (error) msg.error = error;
    else msg.result = result;
    try {
      window.postMessage(msg, window.location.origin);
    } catch (err) {
      console.error('[SOVA] postMessage to inpage failed', err);
    }
  }

  // ── 3. SW → content → inpage (broadcast events) ───────────────────────────
  // Sender validation: принимаем сообщения только от НАШЕГО service worker.
  // Любое расширение может попытаться вызвать chrome.runtime.sendMessage
  // на нашу content-script — отклоняем всё что не из нашего extension'а.
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      // Защита: только из нашего расширения, и не от другого content-script'а
      // (наш SW не имеет sender.tab, content-script — имеет)
      if (!sender || sender.id !== chrome.runtime.id) return;
      if (sender.tab) return;
      // Whitelist allowed event types
      const ALLOWED_EVENTS = new Set([
        BroadcastEvent.ACCOUNTS_CHANGED,
        BroadcastEvent.CHAIN_CHANGED,
        BroadcastEvent.CONNECT,
        BroadcastEvent.DISCONNECT,
      ]);
      if (msg.type === MessageType.DAPP_EVENT && msg.event && ALLOWED_EVENTS.has(msg.event)) {
        try {
          window.postMessage(
            {
              target: INPAGE_TARGET,
              event: msg.event,
              data: msg.data,
            },
            window.location.origin,
          );
        } catch (err) {
          console.error('[SOVA] broadcast to inpage failed', err);
        }
        sendResponse({ ok: true });
        return;
      }
    });
  } catch (err) {
    console.error('[SOVA] failed to register onMessage listener', err);
  }
})();
