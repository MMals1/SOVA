// ══════════════════════════════════════════════════════════════════════
// ui.js — UI helpers: connection state, result boxes, toasts, history
// ══════════════════════════════════════════════════════════════════════
import { state, cfg } from './state.js';
import { t } from './i18n.js';

// ── Network metadata for picker ──
export const NET_META = {
  '0x1': { label: 'Ethereum Mainnet', color: '#627eea' },
  '0xaa36a7': { label: 'Sepolia Testnet', color: '#9b59b6' },
};

export function syncNetPicker() {
  const hexId = state.chainId ? '0x' + state.chainId.toString(16) : '0x1';
  const meta = NET_META[hexId] || NET_META['0x1'];
  document.getElementById('net-label').textContent = meta.label;
  document.getElementById('net-dot').style.background = meta.color;
  document.getElementById('net-dot').style.color = meta.color;
  document
    .querySelectorAll('.net-picker-opt, .net-opt')
    .forEach((o) => o.classList.toggle('active', o.dataset.chain === hexId));
}

export function setConnected(connected) {
  const badge = document.getElementById('conn-badge');
  if (connected) {
    badge.className = 'status-tag ok';
    badge.innerHTML = '<span class="status-dot"></span><span>' + t('badgeConnected') + '</span>';
  } else {
    badge.className = 'status-tag err';
    badge.innerHTML = '<span class="status-dot"></span><span>' + t('badgeDisconnected') + '</span>';
  }
  document.getElementById('btn-connect').disabled = connected;
  document.getElementById('btn-disconnect').disabled = !connected;
}

export function showAccountUI() {
  if (!state.userAddress) return;
  document.getElementById('summary-bar').style.display = '';
  document.getElementById('ab-addr').textContent =
    state.userAddress.slice(0, 6) + '...' + state.userAddress.slice(-4);
  document.getElementById('account-badge').title = state.userAddress;
  const avatar = document.getElementById('acct-avatar');
  if (avatar) {
    const colors = ['#6366f1,#22d3ee', '#f472b6,#fb923c', '#34d399,#6366f1', '#fbbf24,#f472b6'];
    const idx = parseInt(state.userAddress.slice(2, 4), 16) % colors.length;
    avatar.style.background = `linear-gradient(135deg, ${colors[idx]})`;
  }
}

export function clearUI() {
  ['bal-eth', 'bal-usdc', 'bal-usdt', 'bal-steth'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '\u2014';
      el.classList.add('loading');
    }
  });
  ['dep-eth', 'dep-usdc', 'dep-usdt'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  document.getElementById('sum-wallet').textContent = '\u2014';
  document.getElementById('sum-aave').textContent = '\u2014';
  document.getElementById('sum-usd').textContent = '\u2014';
  const sumLido = document.getElementById('sum-lido');
  if (sumLido) sumLido.textContent = '\u2014';
  // Clear Lido UI
  ['lido-steth-bal', 'lido-wsteth-bal'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });
  ['bal-wsteth-dep'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  const wdList = document.getElementById('lido-withdrawal-list');
  if (wdList) wdList.innerHTML = '';
  const claimBtn =
    document.getElementById('btn-lido-claim') ||
    document.getElementById('btn-lido-request-withdraw');
  if (claimBtn) claimBtn.style.display = 'none';
  // Clear LP UI
  state.lpPositions = [];
  const lpList = document.getElementById('lp-positions-list');
  if (lpList)
    lpList.innerHTML = `<div style="font-size:12px; color:var(--text-muted); font-family:var(--font-mono); text-align:center; padding:20px 0;" data-lang="noPositions">${t('noPositions')}</div>`;
  const riskDash = document.getElementById('lp-risk-dashboard');
  if (riskDash) riskDash.style.display = 'none';
  clearApyDisplay();
}

export function updateFeatureVisibility() {
  const c = cfg();
  const connected = !!state.userAddress;

  // Если кошелёк не подключён — показываем UI (пустые данные), скрываем warnings
  // Если подключён но сеть не поддерживает фичу — показываем warning, скрываем UI

  const setVis = (unsupId, uiId, hasFeature, uiDisplay = 'block') => {
    const unsup = document.getElementById(unsupId);
    const ui = document.getElementById(uiId);
    if (!connected) {
      // Не подключён — показываем UI (с прочерками), скрываем warning
      if (unsup) unsup.style.display = 'none';
      if (ui) ui.style.display = uiDisplay;
    } else if (hasFeature) {
      // Подключён + фича поддерживается
      if (unsup) unsup.style.display = 'none';
      if (ui) ui.style.display = uiDisplay;
    } else {
      // Подключён + фича НЕ поддерживается на этой сети
      if (unsup) unsup.style.display = 'block';
      if (ui) ui.style.display = 'none';
    }
  };

  setVis('aave-unsupported', 'aave-ui', c?.hasAave, 'grid');
  setVis('swap-mainnet-only', 'swap-ui', c?.hasSwap, 'block');
  setVis('lido-unsupported', 'lido-ui', c?.hasLido, 'grid');

  const lpUnsup =
    document.getElementById('liquidity-unsupported') || document.getElementById('lp-unsupported');
  const lpUi = document.getElementById('liquidity-ui') || document.getElementById('lp-ui');
  if (!connected) {
    if (lpUnsup) lpUnsup.style.display = 'none';
    if (lpUi) lpUi.style.display = 'block';
  } else if (c?.hasLiquidity) {
    if (lpUnsup) lpUnsup.style.display = 'none';
    if (lpUi) lpUi.style.display = 'block';
  } else {
    if (lpUnsup) lpUnsup.style.display = 'block';
    if (lpUi) lpUi.style.display = 'none';
  }
}

export function setResult(id, text, kind) {
  const el = document.getElementById(id);
  const kmap = { success: 'ok', error: 'err' };
  el.className = 'result' + (kind ? ' ' + (kmap[kind] || kind) : '');
  el.textContent = text;
}

export function toast(msg, kind, linkUrl) {
  const c = document.getElementById('toast-container');
  const toastEl = document.createElement('div');
  const tmap = { success: 'ok', error: 'err' };
  toastEl.className = `toast ${tmap[kind] || kind}`;
  const icon = kind === 'success' ? '\u2713' : '\u2715';
  toastEl.innerHTML = `<span class="toast-icon">${icon}</span><span>${linkUrl ? msg + ' \u00b7 <a href="' + linkUrl + '" target="_blank">explorer \u2197</a>' : msg}</span>`;
  c.appendChild(toastEl);
  setTimeout(() => toastEl.remove(), 5000);
}

export function logHistory(action, detail, hash) {
  const log = document.getElementById('history-log');
  if (log.querySelector('[data-lang="historyEmpty"]')) log.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'hist-row';
  const time = new Date().toTimeString().slice(0, 5);
  const tEl = document.createElement('span');
  tEl.className = 'hist-time';
  tEl.textContent = time;
  const badgeClass = 'hist-badge hb-' + action;
  const aEl = document.createElement('span');
  aEl.className = badgeClass;
  aEl.textContent = action.toUpperCase();
  const dEl = document.createElement('span');
  dEl.className = 'hist-detail';
  if (hash) {
    const c = cfg();
    dEl.textContent = detail + ' \u2014 ';
    const l = document.createElement('a');
    l.href = (c?.explorer || '') + hash;
    l.target = '_blank';
    l.textContent = hash.slice(0, 10) + '...';
    dEl.appendChild(l);
  } else {
    dEl.textContent = detail;
  }
  row.appendChild(tEl);
  row.appendChild(aEl);
  row.appendChild(dEl);
  log.insertBefore(row, log.firstChild);
}

export function showProgress(containerId, steps, activeIdx) {
  const el = document.getElementById(containerId);
  el.style.display = 'flex';
  el.innerHTML = '';
  steps.forEach((label, i) => {
    if (i > 0) {
      const line = document.createElement('div');
      line.className = 'tx-step-line' + (i <= activeIdx ? '' : '');
      if (i < activeIdx) line.classList.add('done');
      el.appendChild(line);
    }
    const step = document.createElement('div');
    step.className = 'tx-step' + (i < activeIdx ? ' done' : i === activeIdx ? ' active' : '');
    const dot = document.createElement('div');
    dot.className = 'step-dot';
    dot.textContent = i < activeIdx ? '\u2713' : i + 1;
    const txt = document.createElement('span');
    txt.textContent = label;
    step.appendChild(dot);
    step.appendChild(txt);
    el.appendChild(step);
  });
}

export function hideProgress(id) {
  document.getElementById(id).style.display = 'none';
  document.getElementById(id).innerHTML = '';
}

export function fmt(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  if (!n || n === 0) return '0';
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  if (Math.abs(n) >= 0.000001) return n.toFixed(6);
  return '< 0.000001';
}

export function clearApyDisplay() {
  ['apy-eth', 'apy-usdc', 'apy-usdt', 'apy-lido'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  const badge = document.getElementById('deposit-apy-badge');
  if (badge) badge.textContent = '';
  const lidoBadge = document.getElementById('lido-apr-badge');
  if (lidoBadge) lidoBadge.textContent = '';
}
