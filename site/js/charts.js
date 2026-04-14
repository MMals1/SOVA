// ══════════════════════════════════════════════════════════════════════
// charts.js — Canvas charts, IL heatmap, health factor gauge, rewards calc
// ══════════════════════════════════════════════════════════════════════
import { state } from './state.js';

const CURRENT_PRICE_VIZ = 3501.2;
let dragging = null;
const priceHistory = [];

function genPriceHistory() {
  let p = 3200;
  for (let i = 0; i < 120; i++) {
    p += (Math.random() - 0.48) * 40;
    p = Math.max(2800, Math.min(4200, p));
    priceHistory.push(p);
  }
  priceHistory[priceHistory.length - 1] = CURRENT_PRICE_VIZ;
}

function setRange(min, max) {
  state.rangeMin = Math.max(0, min);
  state.rangeMax = max;
}

function updateRangeInputs() {
  const minEl = document.getElementById('min-price');
  const maxEl = document.getElementById('max-price');
  if (minEl) minEl.value = state.rangeMin.toFixed(2);
  if (maxEl) maxEl.value = state.rangeMax.toFixed(2);
}

export function updateLPPreview() {
  const pct = ((state.rangeMax - state.rangeMin) / CURRENT_PRICE_VIZ) * 100;
  const eff = Math.max(1, 200 / Math.max(pct, 1)).toFixed(1);
  const rangeEl = document.getElementById('preview-range');
  const effEl = document.getElementById('preview-eff');
  if (rangeEl)
    rangeEl.textContent = state.rangeMin.toFixed(0) + ' \u2013 ' + state.rangeMax.toFixed(0);
  if (effEl) effEl.textContent = '~' + eff + '\u00d7';
}

export function drawChart() {
  const canvas = document.getElementById('price-chart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  // Берём реальную CSS-ширину canvas через getBoundingClientRect —
  // это устойчиво к фулскрину, zoom'у и изменению размера окна, в отличие от
  // parentElement.offsetWidth (которое может давать устаревшее значение во
  // время layout thrashing и не учитывает собственные border/padding canvas).
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(1, Math.floor(rect.width));
  const H_px = 140;
  // Сбрасываем буфер только если размер реально поменялся — без этого каждый
  // вызов drawChart обнуляет context state (scale) и мешает.
  const needResize = canvas.width !== W * dpr || canvas.height !== H_px * dpr;
  if (needResize) {
    canvas.width = W * dpr;
    canvas.height = H_px * dpr;
    canvas.style.height = H_px + 'px';
    // style.width оставляем управляемым CSS (#price-chart { width: 100% }).
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  const PAD_L = 8,
    PAD_R = 8,
    PAD_T = 10,
    PAD_B = 20;
  const cW = W - PAD_L - PAD_R;
  const cH = H_px - PAD_T - PAD_B;
  const visMin = CURRENT_PRICE_VIZ * 0.55;
  const visMax = CURRENT_PRICE_VIZ * 1.45;
  const visRange = visMax - visMin;
  function priceToX(p) {
    return PAD_L + ((p - visMin) / visRange) * cW;
  }
  function xToPrice(x) {
    return visMin + ((x - PAD_L) / cW) * visRange;
  }
  ctx.clearRect(0, 0, W, H_px);
  ctx.fillStyle =
    document.documentElement.getAttribute('data-theme') === 'light' ? '#e8eaed' : '#0c0e12';
  ctx.fillRect(0, 0, W, H_px);
  ctx.strokeStyle =
    document.documentElement.getAttribute('data-theme') === 'light' ? '#d0d4dc' : '#1c1e24';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const y = PAD_T + (cH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(W - PAD_R, y);
    ctx.stroke();
  }

  // Liquidity curve
  const liqPoints = [];
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const p = visMin + (visRange * i) / steps;
    const d1 = (p - CURRENT_PRICE_VIZ) / (CURRENT_PRICE_VIZ * 0.08);
    const d2 = (p - CURRENT_PRICE_VIZ * 0.85) / (CURRENT_PRICE_VIZ * 0.05);
    const liq = Math.exp(-d1 * d1 * 0.5) * 0.85 + Math.exp(-d2 * d2 * 0.5) * 0.15;
    liqPoints.push({ x: priceToX(p), y: PAD_T + cH - liq * cH * 0.85 });
  }

  // Range fill
  const rMinX = Math.max(PAD_L, priceToX(state.rangeMin));
  const rMaxX = Math.min(W - PAD_R, priceToX(state.rangeMax));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(rMinX, PAD_T + cH);
  for (const pt of liqPoints) {
    if (pt.x >= rMinX && pt.x <= rMaxX) ctx.lineTo(pt.x, pt.y);
  }
  ctx.lineTo(rMaxX, PAD_T + cH);
  ctx.closePath();
  const rangeGrad = ctx.createLinearGradient(rMinX, 0, rMaxX, 0);
  rangeGrad.addColorStop(0, 'rgba(59,130,246,0.25)');
  rangeGrad.addColorStop(0.5, 'rgba(59,130,246,0.40)');
  rangeGrad.addColorStop(1, 'rgba(59,130,246,0.25)');
  ctx.fillStyle = rangeGrad;
  ctx.fill();
  ctx.restore();

  // Out-of-range areas
  for (const side of ['left', 'right']) {
    ctx.save();
    ctx.beginPath();
    if (side === 'left') {
      ctx.moveTo(PAD_L, PAD_T + cH);
      for (const pt of liqPoints) {
        if (pt.x <= rMinX) ctx.lineTo(pt.x, pt.y);
      }
      ctx.lineTo(rMinX, PAD_T + cH);
    } else {
      ctx.moveTo(rMaxX, PAD_T + cH);
      for (const pt of liqPoints) {
        if (pt.x >= rMaxX) ctx.lineTo(pt.x, pt.y);
      }
      ctx.lineTo(W - PAD_R, PAD_T + cH);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(30,30,60,0.5)';
    ctx.fill();
    ctx.restore();
  }

  // Liquidity line
  ctx.beginPath();
  liqPoints.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
  const curveGrad = ctx.createLinearGradient(PAD_L, 0, W - PAD_R, 0);
  curveGrad.addColorStop(0, 'rgba(59,130,246,0.4)');
  curveGrad.addColorStop(0.5, '#60a5fa');
  curveGrad.addColorStop(1, 'rgba(59,130,246,0.6)');
  ctx.strokeStyle = curveGrad;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Current price dashed line
  const cpX = priceToX(CURRENT_PRICE_VIZ);
  ctx.save();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cpX, PAD_T);
  ctx.lineTo(cpX, PAD_T + cH);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 9px IBM Plex Mono';
  ctx.textAlign = 'center';
  ctx.fillText('$' + CURRENT_PRICE_VIZ.toFixed(0), cpX, PAD_T + cH + 14);

  // Range handles
  function drawHandle(x, label, isMin) {
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, PAD_T);
    ctx.lineTo(x, PAD_T + cH);
    ctx.stroke();
    ctx.fillStyle = '#3b82f6';
    ctx.shadowColor = 'rgba(59,130,246,0.5)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(x, PAD_T + cH / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 9px IBM Plex Mono';
    ctx.textAlign = isMin ? 'right' : 'left';
    const lx = isMin ? x - 9 : x + 9;
    ctx.fillText('$' + parseFloat(label).toFixed(0), lx, PAD_T + cH / 2 + 3);
    ctx.textAlign = 'center';
  }
  drawHandle(Math.max(PAD_L + 6, rMinX), state.rangeMin, true);
  drawHandle(Math.min(W - PAD_R - 6, rMaxX), state.rangeMax, false);

  // X-axis labels
  ctx.fillStyle = '#343460';
  ctx.font = '8px IBM Plex Mono';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const p = visMin + (visRange * i) / 4;
    ctx.fillText('$' + p.toFixed(0), priceToX(p), H_px - 2);
  }

  // Store refs for drag
  canvas._rMinX = rMinX;
  canvas._rMaxX = rMaxX;
  canvas._priceToX = priceToX;
  canvas._xToPrice = xToPrice;
}

export function drawILHeatmap() {
  const el = document.getElementById('il-heatmap');
  if (!el) return;
  const moves = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
  const W = 28,
    H = 28;
  const svgW = moves.length * (W + 2) + 4;
  let svg =
    '<svg viewBox="0 0 ' +
    svgW +
    ' ' +
    (H + 22) +
    '" width="' +
    svgW +
    '" height="' +
    (H + 22) +
    '">';
  moves.forEach((m, i) => {
    const r = 1 + m / 100;
    const il = Math.abs((2 * Math.sqrt(r)) / (1 + r) - 1) * 100;
    const intensity = Math.min(il / 8, 1);
    const r_c = Math.round(239 * intensity);
    const g_c = Math.round(68 + (180 - 68) * (1 - intensity));
    const b_c = Math.round(68 * (1 - intensity));
    const color = 'rgb(' + r_c + ',' + g_c + ',' + b_c + ')';
    const x = i * (W + 2) + 2;
    svg +=
      '<rect x="' +
      x +
      '" y="0" width="' +
      W +
      '" height="' +
      H +
      '" rx="3" fill="' +
      color +
      '" opacity="0.85"/>';
    svg +=
      '<text x="' +
      (x + W / 2) +
      '" y="' +
      (H / 2 + 4) +
      '" text-anchor="middle" font-family="IBM Plex Mono" font-size="7" fill="' +
      (il > 4 ? '#fff' : '#e8eaf0') +
      '">' +
      il.toFixed(1) +
      '%</text>';
    svg +=
      '<text x="' +
      (x + W / 2) +
      '" y="' +
      (H + 14) +
      '" text-anchor="middle" font-family="IBM Plex Mono" font-size="7" fill="#6b7585">' +
      (m > 0 ? '+' : '') +
      m +
      '%</text>';
  });
  svg += '</svg>';
  el.innerHTML = svg;
}

export function drawHealthFactorGauge(hf) {
  const el = document.getElementById('hf-number');
  if (!el) return;
  const num = parseFloat(hf);
  if (isNaN(num)) {
    el.textContent = '\u2014';
    return;
  }
  if (!isFinite(num)) {
    el.textContent = '\u221e'; // ∞
    el.className = 'hf-number hf-safe';
    return;
  }
  el.textContent = num.toFixed(2);
  el.className = 'hf-number ' + (num >= 2 ? 'hf-safe' : num >= 1.2 ? 'hf-warn' : 'hf-danger');
}

export function updateRewardsCalc(apr, amount) {
  if (!apr || !amount) return;
  const daily = (amount * apr) / 100 / 365;
  const weekly = daily * 7;
  const monthly = daily * 30;
  const yearly = (amount * apr) / 100;
  const d = document.getElementById('rc-daily');
  const w = document.getElementById('rc-weekly');
  const m = document.getElementById('rc-monthly');
  const y = document.getElementById('rc-yearly');
  if (d) d.textContent = '+' + daily.toFixed(6) + ' ETH';
  if (w) w.textContent = '+' + weekly.toFixed(6) + ' ETH';
  if (m) m.textContent = '+' + monthly.toFixed(5) + ' ETH';
  if (y) y.textContent = '+' + yearly.toFixed(5) + ' ETH';
}

export function initCharts() {
  genPriceHistory();

  // ── Resize handling ──
  // Canvas с CSS width:100% и фиксированным drawing buffer не перерисовывается
  // автоматически при изменении размера окна или переключении fullscreen.
  // Без этого график визуально едет (текст плющится, позиции хэндлов не
  // совпадают с реальным drag-target'ом). Навешиваем ResizeObserver на
  // контейнер + window.resize как fallback для старых браузеров.
  let resizeRaf = 0;
  const scheduleRedraw = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      drawChart();
    });
  };
  const chartContainer = document.querySelector('.chart-container');
  if (chartContainer && typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(scheduleRedraw);
    ro.observe(chartContainer);
  } else {
    window.addEventListener('resize', scheduleRedraw);
  }
  // Fullscreen / DPR changes (external monitor swap) — тоже триггерят
  // нужную перерисовку, даже если контейнер внешне не поменялся.
  document.addEventListener('fullscreenchange', scheduleRedraw);
  if (typeof window.matchMedia === 'function') {
    try {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mq.addEventListener?.('change', scheduleRedraw);
    } catch {
      /* ignore — старые браузеры */
    }
  }

  // Canvas drag logic
  const chartCanvas = document.getElementById('price-chart');
  if (chartCanvas) {
    function getCanvasX(e) {
      const rect = chartCanvas.getBoundingClientRect();
      return (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    }
    function onDragStart(e) {
      const x = getCanvasX(e);
      if (Math.abs(x - (chartCanvas._rMinX || 0)) < 14) dragging = 'min';
      else if (Math.abs(x - (chartCanvas._rMaxX || 0)) < 14) dragging = 'max';
      if (dragging) {
        e.preventDefault();
        chartCanvas.style.cursor = 'ew-resize';
      }
    }
    function onDragMove(e) {
      if (!dragging) return;
      e.preventDefault();
      const x = getCanvasX(e);
      const price = chartCanvas._xToPrice ? chartCanvas._xToPrice(x) : 0;
      if (dragging === 'min') state.rangeMin = Math.max(0, Math.min(state.rangeMax - 50, price));
      else state.rangeMax = Math.max(state.rangeMin + 50, price);
      updateRangeInputs();
      drawChart();
      updateLPPreview();
    }
    function onDragEnd() {
      dragging = null;
      chartCanvas.style.cursor = 'crosshair';
    }
    chartCanvas.addEventListener('mousedown', onDragStart);
    chartCanvas.addEventListener('mousemove', onDragMove);
    chartCanvas.addEventListener('mouseup', onDragEnd);
    chartCanvas.addEventListener('mouseleave', onDragEnd);
    chartCanvas.addEventListener('touchstart', onDragStart, { passive: false });
    chartCanvas.addEventListener('touchmove', onDragMove, { passive: false });
    chartCanvas.addEventListener('touchend', onDragEnd);
  }

  // Price input sync
  const minPriceEl = document.getElementById('min-price');
  const maxPriceEl = document.getElementById('max-price');
  if (minPriceEl)
    minPriceEl.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v < state.rangeMax) {
        state.rangeMin = v;
        drawChart();
        updateLPPreview();
      }
    });
  if (maxPriceEl)
    maxPriceEl.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      if (!isNaN(v) && v > state.rangeMin) {
        state.rangeMax = v;
        drawChart();
        updateLPPreview();
      }
    });

  // adjustPrice global for onclick handlers
  function adjustPrice(which, pct) {
    if (which === 'min') state.rangeMin = state.rangeMin * (1 + pct / 100);
    else state.rangeMax = state.rangeMax * (1 + pct / 100);
    updateRangeInputs();
    drawChart();
    updateLPPreview();
  }
  window.adjustPrice = adjustPrice;

  // Preset range buttons
  const presetBtns = document.getElementById('preset-btns');
  if (presetBtns) {
    presetBtns.addEventListener('click', (e) => {
      const btn = e.target.closest('.preset-btn');
      if (!btn) return;
      document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const P = CURRENT_PRICE_VIZ;
      const pct = btn.dataset.preset;
      if (pct === 'full') {
        setRange(0, P * 5);
      } else {
        const d = parseFloat(pct) / 100;
        setRange(P * (1 - d), P * (1 + d));
      }
      updateRangeInputs();
      drawChart();
      updateLPPreview();
    });
  }

  // Fee tier (v5 visual)
  const feeGrid = document.getElementById('fee-grid');
  if (feeGrid) {
    feeGrid.addEventListener('click', (e) => {
      const opt = e.target.closest('.fee-opt');
      if (!opt) return;
      feeGrid.querySelectorAll('.fee-opt').forEach((x) => x.classList.remove('active'));
      opt.classList.add('active');
      drawChart();
    });
  }
}
