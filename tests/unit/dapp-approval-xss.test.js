// ── dApp approval XSS protection tests (P2-3) ────────────────────────
// Тестирует что новые DOM helpers (buildKvRow, buildWarnBox, buildTreeTitle)
// в dapp-approval.js корректно защищают от XSS через textContent, а не innerHTML.
//
// До P2-3: код использовал `innerHTML = \`<span>${shortAddr(p.address)}</span>\``
// — что открывало XSS путь если dApp контролировал params.address.
// После P2-3: все dApp-controlled данные рендерятся через textContent.

import { describe, it, expect } from 'vitest';

// ── Mirror of dapp-approval.js DOM helpers ─────────────────────────────
// Реальные функции внутри IIFE модуля, поэтому зеркалируем сюда
// для изолированного тестирования. Если исходники разойдутся — тест сломается
// на integration level (см. structural test ниже).

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

function buildWarnBox(text, danger = false) {
  const warn = document.createElement('div');
  warn.className = 'dapp-warn-box' + (danger ? ' dapp-warn-danger' : '');
  warn.textContent = String(text || '');
  return warn;
}

function buildTreeTitle(text) {
  const title = document.createElement('div');
  title.className = 'dapp-tree-title';
  title.textContent = String(text || '');
  return title;
}

// ── Tests: XSS resistance ─────────────────────────────────────────────

describe('buildKvRow — XSS protection', () => {
  it('does not interpret value as HTML', () => {
    const row = buildKvRow('Amount', '<img src=x onerror="alert(1)">');
    const v = row.querySelector('.dapp-v');
    expect(v.textContent).toBe('<img src=x onerror="alert(1)">');
    expect(v.querySelector('img')).toBe(null);
    expect(v.innerHTML).not.toContain('<img');
  });

  it('does not interpret label as HTML', () => {
    const row = buildKvRow('<script>alert(1)</script>', 'v');
    const k = row.querySelector('.dapp-k');
    expect(k.textContent).toBe('<script>alert(1)</script>');
    expect(k.querySelector('script')).toBe(null);
  });

  it('escapes quotes and ampersands safely', () => {
    const row = buildKvRow('Q', `" onerror="x" '`);
    const v = row.querySelector('.dapp-v');
    expect(v.textContent).toBe(`" onerror="x" '`);
    expect(v.getAttribute('onerror')).toBe(null);
  });

  it('handles null/undefined label and value', () => {
    const row = buildKvRow(null, undefined);
    expect(row.querySelector('.dapp-k').textContent).toBe('');
    expect(row.querySelector('.dapp-v').textContent).toBe('');
  });

  it('handles addresses with checksums without issue', () => {
    const row = buildKvRow('Address', '0x7cf15e3010638bd548629a0B29700Ac4911589de');
    expect(row.querySelector('.dapp-v').textContent).toBe('0x7cf15e3010638bd548629a0B29700Ac4911589de');
  });

  it('handles unicode/emoji safely', () => {
    const row = buildKvRow('Name', 'Uniswap 🦄');
    expect(row.querySelector('.dapp-k').textContent).toBe('Name');
    expect(row.querySelector('.dapp-v').textContent).toBe('Uniswap 🦄');
  });

  it('uses mono class by default', () => {
    const row = buildKvRow('k', 'v');
    expect(row.querySelector('.dapp-v').className).toContain('mono');
  });

  it('disables mono when opts.mono === false', () => {
    const row = buildKvRow('k', 'v', { mono: false });
    expect(row.querySelector('.dapp-v').className).toBe('dapp-v');
  });

  it('coerces non-string values to string', () => {
    const row = buildKvRow('Gas', 21000);
    expect(row.querySelector('.dapp-v').textContent).toBe('21000');
  });

  it('handles bigint values (common in crypto)', () => {
    const row = buildKvRow('Wei', 1000000000000000000n);
    expect(row.querySelector('.dapp-v').textContent).toBe('1000000000000000000');
  });
});

describe('buildWarnBox — XSS protection', () => {
  it('does not interpret text as HTML', () => {
    const warn = buildWarnBox('<script>alert("xss")</script>');
    expect(warn.textContent).toBe('<script>alert("xss")</script>');
    expect(warn.querySelector('script')).toBe(null);
  });

  it('applies danger class when flag set', () => {
    const warn = buildWarnBox('Critical!', true);
    expect(warn.className).toBe('dapp-warn-box dapp-warn-danger');
    expect(warn.textContent).toBe('Critical!');
  });

  it('default class without danger flag', () => {
    const warn = buildWarnBox('Info');
    expect(warn.className).toBe('dapp-warn-box');
  });

  it('safely renders the first-time recipient warning text', () => {
    const warn = buildWarnBox('⚠️ Вы отправляете на этот адрес впервые.');
    expect(warn.textContent).toContain('⚠️');
    expect(warn.innerHTML).not.toContain('<');
  });

  it('handles empty/null text', () => {
    expect(buildWarnBox(null).textContent).toBe('');
    expect(buildWarnBox(undefined).textContent).toBe('');
    expect(buildWarnBox('').textContent).toBe('');
  });
});

describe('buildTreeTitle — XSS protection', () => {
  it('does not interpret text as HTML', () => {
    const title = buildTreeTitle('<iframe src="evil"></iframe>');
    expect(title.textContent).toBe('<iframe src="evil"></iframe>');
    expect(title.querySelector('iframe')).toBe(null);
  });

  it('renders static EIP-712 section titles', () => {
    const title = buildTreeTitle('Domain');
    expect(title.textContent).toBe('Domain');
    expect(title.className).toBe('dapp-tree-title');
  });

  it('handles null', () => {
    expect(buildTreeTitle(null).textContent).toBe('');
  });
});

// ── Structural test: verify source file actually uses textContent ─────
// Гарантирует что реальный код в dapp-approval.js не вернулся к innerHTML
// с string interpolation. Это regression guard для P2-3.

describe('P2-3: dapp-approval.js source has no unsafe innerHTML interpolation', () => {
  const fs = require('fs');
  const path = require('path');

  const SOURCE_PATH = path.resolve(
    __dirname,
    '../../extension/popup/modules/dapp-approval.js'
  );
  const src = fs.readFileSync(SOURCE_PATH, 'utf8');

  it('has no innerHTML = `...${...}...` with string template interpolation', () => {
    // Regex: ищем innerHTML = `...${...}...` (template literal with interpolation)
    const pattern = /\.innerHTML\s*=\s*`[^`]*\$\{[^`]*`/g;
    const matches = src.match(pattern) || [];
    if (matches.length > 0) {
      throw new Error(
        `Found ${matches.length} unsafe innerHTML interpolations in dapp-approval.js:\n` +
        matches.map(m => `  - ${m.slice(0, 100)}...`).join('\n') +
        `\n\nUse buildKvRow/buildWarnBox/buildTreeTitle helpers instead.`
      );
    }
    expect(matches).toEqual([]);
  });

  it('has no innerHTML = "...${escapeHtml(...)}..."', () => {
    // Старый паттерн с escapeHtml — тоже плохо (removed с P2-3)
    const pattern = /innerHTML[^;]*escapeHtml/;
    expect(src).not.toMatch(pattern);
  });

  it('uses buildKvRow helper', () => {
    expect(src).toMatch(/buildKvRow/);
  });

  it('uses buildWarnBox helper', () => {
    expect(src).toMatch(/buildWarnBox/);
  });

  it('uses buildTreeTitle helper', () => {
    expect(src).toMatch(/buildTreeTitle/);
  });

  it('allowed innerHTML uses are only empty-string clearing', () => {
    // Позволенный паттерн: body.innerHTML = '' (очистка перед пересборкой)
    const allPattern = /\.innerHTML\s*=\s*([^;]+);/g;
    const all = [...src.matchAll(allPattern)];
    for (const m of all) {
      const assignment = m[1].trim();
      // Должно быть либо '' либо "" либо пусто
      const isEmptyString = /^['"]{2}$/.test(assignment);
      if (!isEmptyString) {
        throw new Error(
          `Unexpected innerHTML assignment in dapp-approval.js: ${m[0]}\n` +
          `Only empty string clearing is allowed, use DOM helpers otherwise.`
        );
      }
    }
  });
});
