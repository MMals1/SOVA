(function () {
  'use strict';

  // MED-10: proper tokenizer, который корректно обрабатывает запятые
  // внутри строковых литералов. Раньше `raw.split(',')` ломал выражения
  // типа `showError('create', 'Ошибка, не повезло')` на 3 фрагмента.
  function splitArgsAware(raw) {
    const tokens = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quote) {
        if (ch === quote && raw[i - 1] !== '\\') {
          quote = null;
        }
        current += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        current += ch;
      } else if (ch === ',') {
        tokens.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) tokens.push(current.trim());
    return tokens;
  }

  function bindDeclarativeHandlers() {
    const parseArgs = (argsRaw, event) => {
      const raw = String(argsRaw || '').trim();
      if (!raw) return [];

      return splitArgsAware(raw).map((token) => {
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
