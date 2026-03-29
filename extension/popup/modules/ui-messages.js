'use strict';

(function initPopupUiMessages(root) {
  root.WolfPopupUiMessages = {
    showError(prefix, msg) {
      const el = document.getElementById(`${prefix}-error`);
      if (el) {
        el.textContent = msg;
        el.style.display = 'block';
      }
    },

    setStatus(prefix, msg) {
      const el = document.getElementById(`${prefix}-status`);
      if (el) {
        el.textContent = msg;
        el.style.display = msg ? 'block' : 'none';
      }
    },

    showSuccess(prefix, msg) {
      const el = document.getElementById(`${prefix}-success`);
      if (el) {
        el.textContent = `✓ ${msg}`;
        el.style.display = 'block';
      }
    },

    clearMessages(prefix) {
      ['error', 'status', 'success'].forEach((type) => {
        const el = document.getElementById(`${prefix}-${type}`);
        if (el) el.style.display = 'none';
      });
    },

    setLoading(btnId, loading) {
      const btn = document.getElementById(btnId);
      if (btn) btn.disabled = loading;
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
