(function () {
  'use strict';

  function bindDeclarativeHandlers() {
    const parseArgs = (argsRaw, event) => {
      const raw = String(argsRaw || '').trim();
      if (!raw) return [];

      return raw.split(',').map((part) => {
        const token = part.trim();
        if (token === 'event') return event;
        if (token === 'true') return true;
        if (token === 'false') return false;
        if (token === 'null') return null;
        if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);

        const quoted = token.match(/^['"](.*)['"]$/);
        if (quoted) return quoted[1];

        return token;
      });
    };

    const bindAttribute = (attrName, eventName) => {
      document.querySelectorAll(`[${attrName}]`).forEach((el) => {
        const expr = (el.getAttribute(attrName) || '').trim();
        if (!expr) return;

        const enterGuard = expr.match(/^if\s*\(\s*event\.key\s*===\s*['"]Enter['"]\s*\)\s*([A-Za-z_$][\w$]*)\(\s*\)\s*$/);
        if (enterGuard) {
          const fnName = enterGuard[1];
          el.addEventListener(eventName, (event) => {
            if (event.key !== 'Enter') return;
            const fn = globalThis[fnName];
            if (typeof fn === 'function') fn();
          });
          return;
        }

        const call = expr.match(/^([A-Za-z_$][\w$]*)\((.*)\)\s*$/);
        if (!call) return;

        const fnName = call[1];
        const argsRaw = call[2];
        el.addEventListener(eventName, (event) => {
          const fn = globalThis[fnName];
          if (typeof fn !== 'function') return;
          const args = parseArgs(argsRaw, event);
          fn(...args);
        });
      });
    };

    bindAttribute('data-onclick', 'click');
    bindAttribute('data-onchange', 'change');
    bindAttribute('data-oninput', 'input');
    bindAttribute('data-onkeydown', 'keydown');
  }

  globalThis.WolfPopupEventBinder = {
    bindDeclarativeHandlers,
  };
})();
