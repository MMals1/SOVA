// ══════════════════════════════════════════════════════════════════════
// v3-positions.js — Load, render, and inspect Uniswap V3 positions
// ══════════════════════════════════════════════════════════════════════
import { state, cfg } from './state.js';
import { DECIMALS, NFPM_ABI, UNI_FACTORY_ABI, UNI_POOL_ABI } from './config.js';
import { t } from './i18n.js';
import {
  sqrtPriceToPrice,
  tickToPrice,
  calculatePositionAmounts,
  calculateImpermanentLoss,
} from './v3-math.js';

// ── Token helpers ──

export function tokenSymbol(address) {
  if (!address) return '???';
  const c = cfg();
  if (!c) return address.slice(0, 6);
  const addr = address.toLowerCase();
  for (const [sym, a] of Object.entries(c.tokens)) {
    if (a.toLowerCase() === addr) return sym === 'WETH' ? 'WETH' : sym;
  }
  if (c.lido) {
    if (c.lido.stETH.toLowerCase() === addr) return 'stETH';
    if (c.lido.wstETH.toLowerCase() === addr) return 'wstETH';
  }
  return address.slice(0, 6);
}

export function tokenDecimals(address) {
  const sym = tokenSymbol(address);
  return DECIMALS[sym] || 18;
}

// ── Pool data fetcher ──

export async function getPoolData(token0, token1, fee) {
  const c = cfg();
  if (!c?.uniV3 || !state.ethProvider) return null;
  const ethers = window.ethers;
  try {
    const factory = new ethers.Contract(c.uniV3.factory, UNI_FACTORY_ABI, state.ethProvider);
    const poolAddr = await factory.getPool(token0, token1, fee);
    if (!poolAddr || poolAddr === ethers.ZeroAddress) return null;
    const pool = new ethers.Contract(poolAddr, UNI_POOL_ABI, state.ethProvider);
    const slot0 = await pool.slot0();
    const liq = await pool.liquidity();
    return { sqrtPriceX96: slot0[0], tick: Number(slot0[1]), liquidity: liq, poolAddr };
  } catch {
    return null;
  }
}

// ── Load Positions ──

export async function loadLPPositions() {
  if (!state.userAddress || !state.ethProvider) return;
  const c = cfg();
  if (!c?.hasLiquidity || !c.uniV3) return;
  const ethers = window.ethers;
  state.lpPositions = [];
  try {
    const nfpm = new ethers.Contract(c.uniV3.nfpm, NFPM_ABI, state.ethProvider);
    const count = await nfpm.balanceOf(state.userAddress);
    const n = Number(count);
    for (let i = 0; i < n; i++) {
      const tokenId = await nfpm.tokenOfOwnerByIndex(state.userAddress, i);
      const pos = await nfpm.positions(tokenId);
      state.lpPositions.push({
        tokenId: Number(tokenId),
        token0: pos[2],
        token1: pos[3],
        fee: Number(pos[4]),
        tickLower: Number(pos[5]),
        tickUpper: Number(pos[6]),
        liquidity: pos[7],
        tokensOwed0: pos[10],
        tokensOwed1: pos[11],
      });
    }
  } catch {
    /* skip */
  }
  renderLPPositions();
}

// ── Render positions list ──
// collectFees / removeLiquidity are passed in via _actionHandlers so that
// v3-positions does not depend on liquidity.js (avoids circular imports).

let _actionHandlers = { collectFees: null, removeLiquidity: null };

export function registerActionHandlers(handlers) {
  _actionHandlers = { ..._actionHandlers, ...handlers };
}

function renderLPPositions() {
  const ethers = window.ethers;
  const container = document.getElementById('lp-positions-list');
  if (!state.lpPositions.length) {
    container.innerHTML = `<div style="font-size:12px; color:var(--text-muted); font-family:var(--font-mono); text-align:center; padding:20px 0;" data-lang="noPositions">${t('noPositions')}</div>`;
    return;
  }
  container.innerHTML = '';
  for (const pos of state.lpPositions) {
    const sym0 = tokenSymbol(pos.token0);
    const sym1 = tokenSymbol(pos.token1);
    const feeStr = (pos.fee / 10000).toFixed(2) + '%';
    const inRange = Number(pos.liquidity) > 0;
    const rangeBadgeClass = inRange ? 'in-range' : 'out-of-range';
    const rangeBadgeText = inRange ? t('posInRange') : t('posOutOfRange');
    const owed0 = parseFloat(
      ethers.formatUnits(pos.tokensOwed0, tokenDecimals(pos.token0)),
    ).toFixed(6);
    const owed1 = parseFloat(
      ethers.formatUnits(pos.tokensOwed1, tokenDecimals(pos.token1)),
    ).toFixed(6);
    const priceLow = tickToPrice(pos.tickLower).toFixed(6);
    const priceHigh = tickToPrice(pos.tickUpper).toFixed(6);

    const card = document.createElement('div');
    card.className = 'lp-position-card';
    card.innerHTML = `
      <div class="lp-header">
        <span class="lp-pair">${sym0}/${sym1}</span>
        <span class="lp-fee">${feeStr}</span>
        <span class="lp-range-badge ${rangeBadgeClass}">${rangeBadgeText}</span>
      </div>
      <div class="lp-details">
        <span class="lp-dt">Token ID</span><span class="lp-dd">#${pos.tokenId}</span>
        <span class="lp-dt">Range</span><span class="lp-dd">${priceLow} \u2014 ${priceHigh}</span>
        <span class="lp-dt">Fees ${sym0}</span><span class="lp-dd">${owed0}</span>
        <span class="lp-dt">Fees ${sym1}</span><span class="lp-dd">${owed1}</span>
      </div>
      <div class="lp-actions">
        <button type="button" class="btn-ghost btn-sm" data-action="risk" data-token-id="${pos.tokenId}">Dashboard</button>
        <button type="button" class="btn-ghost btn-sm" data-action="collect" data-token-id="${pos.tokenId}">Collect Fees</button>
        <button type="button" class="btn-ghost btn-sm btn-danger" data-action="remove" data-token-id="${pos.tokenId}">Remove</button>
      </div>
    `;
    container.appendChild(card);
  }

  container.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tokenId = parseInt(btn.dataset.tokenId);
      const action = btn.dataset.action;
      if (action === 'risk') showPositionRisk(tokenId);
      else if (action === 'collect' && _actionHandlers.collectFees)
        _actionHandlers.collectFees(tokenId);
      else if (action === 'remove' && _actionHandlers.removeLiquidity)
        _actionHandlers.removeLiquidity(tokenId);
    });
  });
}

// ── Risk Dashboard ──

export async function showPositionRisk(tokenId) {
  const ethers = window.ethers;
  const pos = state.lpPositions.find((p) => p.tokenId === tokenId);
  if (!pos) return;
  const dashboard = document.getElementById('lp-risk-dashboard');
  const metricsGrid = document.getElementById('lp-metrics-grid');
  const pairLabel = document.getElementById('lp-risk-pair');
  const sym0 = tokenSymbol(pos.token0);
  const sym1 = tokenSymbol(pos.token1);
  pairLabel.textContent = `#${tokenId} ${sym0}/${sym1}`;
  dashboard.style.display = 'block';
  metricsGrid.innerHTML =
    '<div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">Loading pool data...</div>';

  const poolData = await getPoolData(pos.token0, pos.token1, pos.fee);
  if (!poolData) {
    metricsGrid.innerHTML =
      '<div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">Could not fetch pool data.</div>';
    return;
  }

  const dec0 = tokenDecimals(pos.token0);
  const dec1 = tokenDecimals(pos.token1);
  const currentPrice = sqrtPriceToPrice(poolData.sqrtPriceX96, dec0, dec1);
  const priceLow = tickToPrice(pos.tickLower);
  const priceHigh = tickToPrice(pos.tickUpper);
  const midPrice = (priceLow + priceHigh) / 2;
  const isInRange = poolData.tick >= pos.tickLower && poolData.tick < pos.tickUpper;

  const amounts = calculatePositionAmounts(
    pos.liquidity,
    poolData.sqrtPriceX96,
    pos.tickLower,
    pos.tickUpper,
    dec0,
    dec1,
  );
  const priceRatio = currentPrice / midPrice;
  const il = calculateImpermanentLoss(priceRatio);
  const fees0 = parseFloat(ethers.formatUnits(pos.tokensOwed0, dec0));
  const fees1 = parseFloat(ethers.formatUnits(pos.tokensOwed1, dec1));

  metricsGrid.innerHTML = `
    <div class="lp-metric-card">
      <div class="lp-metric-label">Position Value</div>
      <div class="lp-metric-value">${amounts.amount0.toFixed(4)} ${sym0}<br>${amounts.amount1.toFixed(4)} ${sym1}</div>
    </div>
    <div class="lp-metric-card">
      <div class="lp-metric-label">Uncollected Fees</div>
      <div class="lp-metric-value">${fees0.toFixed(6)} ${sym0}<br>${fees1.toFixed(6)} ${sym1}</div>
    </div>
    <div class="lp-metric-card">
      <div class="lp-metric-label">Range Status</div>
      <div class="lp-metric-value"><span class="lp-range-badge ${isInRange ? 'in-range' : 'out-of-range'}">${isInRange ? t('posInRange') : t('posOutOfRange')}</span></div>
    </div>
    <div class="lp-metric-card">
      <div class="lp-metric-label">${t('riskIL')}</div>
      <div class="lp-metric-value" style="color:${il < -0.01 ? 'var(--danger)' : 'var(--success)'}">${(il * 100).toFixed(2)}%</div>
    </div>
    <div class="lp-metric-card">
      <div class="lp-metric-label">Current Price</div>
      <div class="lp-metric-value">${currentPrice.toFixed(6)}</div>
    </div>
    <div class="lp-metric-card">
      <div class="lp-metric-label">${t('riskRangeHealth')}</div>
      <div class="lp-metric-value">${isInRange ? 'Healthy' : 'Out of Range'}</div>
    </div>
  `;

  renderRangeHealthBar(poolData.tick, pos.tickLower, pos.tickUpper);
}

function renderRangeHealthBar(currentTick, tickLower, tickUpper) {
  const fill = document.getElementById('lp-range-fill');
  const marker = document.getElementById('lp-range-marker');
  const lowLabel = document.getElementById('lp-range-low-label');
  const highLabel = document.getElementById('lp-range-high-label');

  const range = tickUpper - tickLower;
  const padding = range * 0.2;
  const barMin = tickLower - padding;
  const barMax = tickUpper + padding;
  const barRange = barMax - barMin;

  const fillLeft = ((tickLower - barMin) / barRange) * 100;
  const fillWidth = (range / barRange) * 100;
  fill.style.left = fillLeft + '%';
  fill.style.width = fillWidth + '%';

  const markerPos = Math.max(0, Math.min(100, ((currentTick - barMin) / barRange) * 100));
  marker.style.left = markerPos + '%';

  lowLabel.textContent = tickToPrice(tickLower).toFixed(4);
  highLabel.textContent = tickToPrice(tickUpper).toFixed(4);
}
