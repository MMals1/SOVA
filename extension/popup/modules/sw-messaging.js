'use strict';

// ── Service Worker messaging ──────────────────────────────────────────
// Обёртка вокруг chrome.runtime.sendMessage с таймаутом 15 секунд.
// SW в MV3 может быть idle-killed Chrome'ом — таймаут гарантирует что
// popup не зависнет навечно при мёртвом SW.

const SW_TIMEOUT_MS = 15000;

function sendToSW(msg) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: 'Service Worker не отвечает (timeout)' });
    }, SW_TIMEOUT_MS);
    chrome.runtime.sendMessage(msg, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

// Broadcast chainChanged всем подключённым dApp'ам через SW.
// Fire-and-forget: если SW мёртв, ошибка игнорируется.
function notifyChainChangedToDapps(networkKey) {
  const ns = globalThis.WolfPopupNetworkState;
  const NETWORKS = ns ? ns.NETWORKS : {};
  const cfg = NETWORKS[networkKey];
  if (!cfg) return;
  const chainIdHex = '0x' + Number(cfg.chainId).toString(16);
  try {
    chrome.runtime.sendMessage({ type: MessageType.NETWORK_CHANGED, chainIdHex }, () => {
      if (chrome.runtime.lastError) {
        /* noop */
      }
    });
  } catch {
    /* ignore */
  }
}

// Expose on globalThis (send-flow.js, unlock-flow.js и другие модули
// вызывают globalThis.sendToSW напрямую)
globalThis.sendToSW = sendToSW;

export const WolfPopupSwMessaging = {
  sendToSW,
  notifyChainChangedToDapps,
};
globalThis.WolfPopupSwMessaging = WolfPopupSwMessaging;
