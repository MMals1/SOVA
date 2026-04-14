'use strict';
(() => {
  let _debugEnabled = false;
  try {
    chrome.storage.local.get(['debugSW']).then((result) => {
      _debugEnabled = !!result.debugSW;
    });
  } catch {}
  const DAPP_REQUEST_TTL_MS = 60 * 1e3;
  const CONNECTED_ORIGIN_TTL_MS = 90 * 24 * 60 * 60 * 1e3;
  const MAX_LOCKOUT_MS = 15 * 60 * 1e3;
  const AUDIT_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
})();
