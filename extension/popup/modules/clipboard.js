'use strict';

(function initPopupClipboard(root) {
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      Object.assign(ta.style, { position: 'fixed', opacity: '0' });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    }
  }

  root.WolfPopupClipboard = {
    copyText,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
