// ══════════════════════════════════════════════════════════════════════
// main.js — Entry point: imports, init, wiring
// ══════════════════════════════════════════════════════════════════════
import { ethers } from 'https://esm.sh/ethers@6.13.1';
window.ethers = ethers;

import { state } from './state.js';
import { t, applyLang, setupLangToggle } from './i18n.js';
import { renderPicker, initWalletDetection } from './wallet.js';
import { setupConnectHandlers } from './events.js';
import { updateFeatureVisibility } from './ui.js';
import { loadAll } from './balance.js';
import { setupAaveHandlers } from './aave.js';
import { setupSwapHandlers } from './swap.js';
import { setupLidoHandlers } from './lido.js';
import { setupLiquidityHandlers } from './liquidity.js';
import { initCharts, drawChart, drawILHeatmap, updateLPPreview } from './charts.js';
import { toast } from './ui.js';

// ── Tab navigation ──
document.getElementById('tab-bar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  btn.setAttribute('aria-selected', 'true');
  document.getElementById(`panel-${btn.dataset.tab}`)?.classList.add('active');
});

// ── Theme toggle ──
const themeBtn = document.getElementById('theme-btn');
const themeIcon = document.getElementById('theme-icon');
if (themeBtn) {
  const MOON_SVG =
    '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>';
  const SUN_SVG = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  let isDark = true;
  themeBtn.addEventListener('click', () => {
    isDark = !isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (themeIcon) themeIcon.innerHTML = isDark ? MOON_SVG : SUN_SVG;
    if (typeof drawChart === 'function') drawChart();
  });
}

// ── Token segments (v5 pattern) ──
document.querySelectorAll('.token-seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !btn.dataset.token) return;
    seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Toggle switches ──
document.querySelectorAll('.toggle').forEach((t) => {
  t.addEventListener('click', () => {
    t.classList.toggle('on');
    toast(t.classList.contains('on') ? 'Collateral enabled' : 'Collateral disabled', 'info');
  });
});

// ── Advanced wrap/unwrap toggle ──
const advToggle = document.getElementById('advanced-toggle');
if (advToggle) {
  advToggle.addEventListener('click', () => {
    const body = document.getElementById('advanced-wrap-body');
    const caret = document.getElementById('adv-caret');
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (caret) caret.style.transform = isOpen ? '' : 'rotate(180deg)';
  });
}

// ── Slippage pills ──
document.querySelectorAll('#slip-05,#slip-10,#slip-auto').forEach((b) => {
  if (b)
    b.addEventListener('click', () => {
      document
        .querySelectorAll('#slip-05,#slip-10,#slip-auto')
        .forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
});

// ── History filter ──
const histFilterRow = document.querySelector('#panel-history .row');
if (histFilterRow) {
  histFilterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-pill');
    if (!btn) return;
    histFilterRow.querySelectorAll('.btn-pill').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const filter = btn.dataset.filter || 'all';
    const rows = document.querySelectorAll('#history-log .hist-row');
    rows.forEach((r) => {
      if (filter === 'all') {
        r.style.display = '';
        return;
      }
      const badge = r.querySelector('.hist-badge');
      if (!badge) {
        r.style.display = '';
        return;
      }
      const cl = badge.className;
      const show =
        (filter === 'aave' && (cl.includes('hb-deposit') || cl.includes('hb-withdraw'))) ||
        (filter === 'swap' && cl.includes('hb-swap')) ||
        (filter === 'lido' &&
          (cl.includes('hb-stake') || cl.includes('hb-unstake') || cl.includes('hb-wrap'))) ||
        (filter === 'lp' &&
          (cl.includes('hb-mint') || cl.includes('hb-collect') || cl.includes('hb-remove')));
      r.style.display = show ? '' : 'none';
    });
  });
}

// ── ID Aliases: map current-JS IDs to v5-HTML IDs ──
(function aliasIds() {
  const placeholders = [
    'sum-lido-item',
    'sum-usd',
    'lp-metrics-grid',
    'lp-risk-pair',
    'lp-pool-price',
    'lp-range-presets',
    'lp-amount0-label',
    'lp-amount1-label',
    'lp-range-fill',
    'lp-range-marker',
    'lp-range-low-label',
    'lp-range-high-label',
  ];
  for (const pid of placeholders) {
    if (!document.getElementById(pid)) {
      const div = document.createElement('div');
      div.id = pid;
      div.style.display = 'none';
      document.body.appendChild(div);
    }
  }
  // Map lp-min-price -> min-price
  if (!document.getElementById('lp-min-price') && document.getElementById('min-price')) {
    document.getElementById('min-price').id = 'lp-min-price';
  }
  if (!document.getElementById('lp-max-price') && document.getElementById('max-price')) {
    document.getElementById('max-price').id = 'lp-max-price';
  }
  // sum-usd -> sum-total
  if (!document.getElementById('sum-usd') && document.getElementById('sum-total')) {
    const sumTot = document.getElementById('sum-total');
    const sumUsd = sumTot.cloneNode(false);
    sumUsd.id = 'sum-usd';
    sumUsd.style.display = 'none';
    sumTot.parentElement.appendChild(sumUsd);
  }
})();

// ── Init ──
applyLang();
setupLangToggle();
initWalletDetection();
renderPicker();
setupConnectHandlers();
updateFeatureVisibility();
setupAaveHandlers();
setupSwapHandlers();
setupLidoHandlers();
setupLiquidityHandlers();

// Auto-refresh
setInterval(() => {
  if (state.userAddress) loadAll();
}, 30000);

// Charts init
window.addEventListener('load', () => {
  initCharts();
  drawILHeatmap();
  updateLPPreview();
  setTimeout(drawChart, 100);
});
window.addEventListener('resize', drawChart);
