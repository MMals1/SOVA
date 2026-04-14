'use strict';

/**
 * Global error boundary for SOVA Wallet popup.
 * Must be loaded BEFORE all other scripts to catch init failures.
 */
(function () {
  let shown = false;

  function showCrashScreen(message) {
    if (shown) return;
    shown = true;

    const app = document.getElementById('app');
    if (app) app.style.display = 'none';

    const overlay = document.createElement('div');
    overlay.id = 'error-boundary-overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:99999;background:#1a1a2e;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'padding:24px;text-align:center;font-family:system-ui,sans-serif;';

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:48px;margin-bottom:16px;';
    icon.textContent = '\u26A0\uFE0F';

    const title = document.createElement('h2');
    title.style.cssText = 'color:#f87171;margin:0 0 12px;font-size:18px;';
    title.textContent = '\u041E\u0448\u0438\u0431\u043A\u0430 SOVA Wallet';

    const desc = document.createElement('p');
    desc.style.cssText =
      'color:#94a3b8;font-size:13px;max-width:320px;word-break:break-word;' +
      'margin:0 0 20px;line-height:1.5;';
    desc.textContent =
      message ||
      '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430';

    const btn = document.createElement('button');
    btn.style.cssText =
      'background:#3b82f6;color:#fff;border:none;border-radius:8px;' +
      'padding:10px 24px;font-size:14px;cursor:pointer;';
    btn.textContent =
      '\u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C';
    btn.addEventListener('click', function () {
      location.reload();
    });

    overlay.appendChild(icon);
    overlay.appendChild(title);
    overlay.appendChild(desc);
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
  }

  window.onerror = function (message, source, lineno, colno, error) {
    const msg = error && error.message ? error.message : String(message);
    console.error('[SOVA ErrorBoundary]', msg, { source: source, line: lineno, col: colno });
    showCrashScreen(msg);
  };

  window.addEventListener('unhandledrejection', function (event) {
    const reason = event.reason;
    const msg =
      reason && reason.message
        ? reason.message
        : reason
          ? String(reason)
          : 'Unhandled promise rejection';
    console.error('[SOVA ErrorBoundary] unhandledrejection:', msg);
    showCrashScreen(msg);
  });
})();
