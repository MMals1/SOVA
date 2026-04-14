// ══════════════════════════════════════════════════════════════════════
// balance.js — Load balances, aTokens, summaries, APY
// ══════════════════════════════════════════════════════════════════════
import { state, cfg } from './state.js';
import { DECIMALS, ERC20_ABI, POOL_ABI, LIDO_ABI, WSTETH_ABI, SECONDS_PER_YEAR } from './config.js';
import { fmt, clearApyDisplay } from './ui.js';
import { t } from './i18n.js';
import { loadLidoApr, loadWithdrawalRequests } from './lido.js';
import { loadLPPositions, populatePoolSelect } from './liquidity.js';
import { updateSwapFromBal } from './swap.js';

export async function loadAll() {
  if (!state.userAddress || !state.ethProvider) return;
  const c = cfg();
  if (!c) return;
  ['bal-eth', 'bal-usdc', 'bal-usdt'].forEach((id) =>
    document.getElementById(id)?.classList.add('loading'),
  );

  const ethers = window.ethers;

  // ETH
  try {
    const w = await state.ethProvider.getBalance(state.userAddress);
    state.balances.ETH = parseFloat(ethers.formatEther(w));
  } catch {
    state.balances.ETH = 0;
  }
  setBalEl('bal-eth', state.balances.ETH);

  // ERC20
  for (const sym of ['USDC', 'USDT']) {
    if (!c.tokens[sym]) {
      state.balances[sym] = 0;
      setBalEl(`bal-${sym.toLowerCase()}`, 0);
      continue;
    }
    try {
      const ct = new ethers.Contract(c.tokens[sym], ERC20_ABI, state.ethProvider);
      const b = await ct.balanceOf(state.userAddress);
      state.balances[sym] = parseFloat(ethers.formatUnits(b, DECIMALS[sym]));
    } catch {
      state.balances[sym] = 0;
    }
    setBalEl(`bal-${sym.toLowerCase()}`, state.balances[sym]);
  }

  // aTokens
  for (const sym of ['ETH', 'USDC', 'USDT']) {
    const aAddr = c.aTokens?.[sym];
    const key = `a${sym}`;
    if (!aAddr) {
      state.balances[key] = 0;
      document.getElementById(`dep-${sym.toLowerCase()}`).textContent = '';
      continue;
    }
    try {
      const ct = new ethers.Contract(aAddr, ERC20_ABI, state.ethProvider);
      const b = await ct.balanceOf(state.userAddress);
      const d = sym === 'ETH' ? 18 : DECIMALS[sym];
      state.balances[key] = parseFloat(ethers.formatUnits(b, d));
    } catch {
      state.balances[key] = 0;
    }
    const depEl = document.getElementById(`dep-${sym.toLowerCase()}`);
    depEl.textContent = state.balances[key] > 0 ? fmt(state.balances[key]) : '';
  }

  // stETH / wstETH balances
  const cc = cfg();
  if (cc?.hasLido && cc.lido) {
    try {
      const stETHc = new ethers.Contract(cc.lido.stETH, LIDO_ABI, state.ethProvider);
      const b = await stETHc.balanceOf(state.userAddress);
      state.balances.stETH = parseFloat(ethers.formatEther(b));
    } catch {
      state.balances.stETH = 0;
    }
    try {
      const wstETHc = new ethers.Contract(cc.lido.wstETH, WSTETH_ABI, state.ethProvider);
      const b = await wstETHc.balanceOf(state.userAddress);
      state.balances.wstETH = parseFloat(ethers.formatEther(b));
    } catch {
      state.balances.wstETH = 0;
    }
    // Update Lido UI
    setBalEl('bal-steth', state.balances.stETH);
    const stethCard = document.getElementById('bal-card-steth');
    if (stethCard) stethCard.style.display = 'block';
    const wstDep = document.getElementById('bal-wsteth-dep');
    if (wstDep) wstDep.textContent = state.balances.wstETH > 0 ? fmt(state.balances.wstETH) : '';
    const lidoStBal = document.getElementById('lido-steth-bal');
    if (lidoStBal) lidoStBal.textContent = fmt(state.balances.stETH);
    const lidoWstBal = document.getElementById('lido-wsteth-bal');
    if (lidoWstBal) lidoWstBal.textContent = fmt(state.balances.wstETH);
    loadLidoApr();
    loadWithdrawalRequests();
  } else {
    state.balances.stETH = 0;
    state.balances.wstETH = 0;
    const stethCard = document.getElementById('bal-card-steth');
    if (stethCard) stethCard.style.display = 'none';
  }

  // LP positions
  if (cc?.hasLiquidity && cc.uniV3) {
    loadLPPositions();
    populatePoolSelect();
  }

  updateSummary();
  updateSwapFromBal();
  loadAaveApys();
  loadAavePosition();
  // Refresh allowance display for ERC-20 deposits
  import('./aave.js').then((m) => m.updateAllowanceInfo?.()).catch(() => {});
}

export function setBalEl(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('loading');
  el.textContent = fmt(val);
}

export function updateSummary() {
  const b = state.balances;
  const c = cfg();

  // Wallet
  const sumWallet = document.getElementById('sum-wallet');
  const sumWalletSub = document.getElementById('sum-wallet-sub');
  if (sumWallet) {
    sumWallet.textContent = `${fmt(b.ETH)} ETH`;
    sumWallet.classList.remove('loading');
  }
  if (sumWalletSub) {
    const usdcVal = b.USDC + b.USDT;
    sumWalletSub.textContent = usdcVal > 0 ? `+ ${fmt(b.USDC)} USDC + ${fmt(b.USDT)} USDT` : '';
  }

  // AAVE — заполняется в loadAavePosition() через #sum-aave
  const sumAave = document.getElementById('sum-aave');
  const sumAaveSub = document.getElementById('sum-aave-sub');
  if (sumAave && sumAave.textContent === '\u2014') {
    // Fallback если loadAavePosition ещё не вызван
    if (b.aETH > 0 || b.aUSDC > 0 || b.aUSDT > 0) {
      sumAave.textContent = `${fmt(b.aETH)} ETH + ${fmt(b.aUSDC)} USDC`;
    }
    sumAave.classList.remove('loading');
  }
  if (sumAaveSub) {
    // Net APY из кеша
    const apyC = state.apyCache || {};
    const totalAave = b.aETH + b.aUSDC + b.aUSDT;
    if (totalAave > 0 && (apyC.ETH || apyC.USDC || apyC.USDT)) {
      const weighted =
        (b.aETH * (apyC.ETH || 0) + b.aUSDC * (apyC.USDC || 0) + b.aUSDT * (apyC.USDT || 0)) /
        totalAave;
      sumAaveSub.innerHTML = `<span class="pf-change up">APY ${weighted.toFixed(2)}%</span>`;
    } else {
      sumAaveSub.textContent = '';
    }
  }

  // Lido
  const sumLidoItem = document.getElementById('sum-lido-item');
  const sumLido = document.getElementById('sum-lido');
  const sumLidoSub = document.getElementById('sum-lido-sub');
  if (c?.hasLido) {
    if (sumLidoItem) sumLidoItem.style.display = '';
    if (sumLido) {
      if (b.stETH > 0 || b.wstETH > 0) {
        sumLido.textContent = `${fmt(b.stETH)} stETH`;
      } else {
        sumLido.textContent = '\u2014';
      }
      sumLido.classList.remove('loading');
    }
    if (sumLidoSub) {
      if (state.lidoApr && state.lidoApr > 0) {
        sumLidoSub.innerHTML = `<span class="pf-change up">APR ${state.lidoApr.toFixed(2)}%</span>`;
      } else {
        sumLidoSub.textContent = '';
      }
    }
  } else {
    if (sumLidoItem) sumLidoItem.style.display = 'none';
  }

  // LP — будет заполняться из loadLPPositions
  const sumLp = document.getElementById('sum-lp');
  const sumLpSub = document.getElementById('sum-lp-sub');
  if (sumLp) sumLp.classList.remove('loading');
  if (sumLpSub) sumLpSub.textContent = '';

  // Total — сумма всего
  const sumTotal = document.getElementById('sum-total');
  const sumTotalSub = document.getElementById('sum-total-sub');
  if (sumTotal) sumTotal.classList.remove('loading');
  if (sumTotalSub) sumTotalSub.textContent = '';
}

// ── AAVE Position (on-chain via getUserAccountData) ──
export async function loadAavePosition() {
  if (!state.ethProvider || !state.userAddress) return;
  const c = cfg();
  if (!c?.hasAave || !c.pool) return;
  const ethers = window.ethers;
  const pool = new ethers.Contract(c.pool, POOL_ABI, state.ethProvider);

  try {
    const data = await pool.getUserAccountData(state.userAddress);
    // data: totalCollateralBase, totalDebtBase, availableBorrowsBase,
    //       currentLiquidationThreshold, ltv, healthFactor
    // All values in BASE_CURRENCY units (USD with 8 decimals on AAVE V3)
    const totalSupplied = Number(data.totalCollateralBase) / 1e8;
    const totalBorrowed = Number(data.totalDebtBase) / 1e8;
    const availableBorrow = Number(data.availableBorrowsBase) / 1e8;
    const ltv = Number(data.ltv) / 100; // basis points → %
    const hf = data.totalDebtBase > 0n ? Number(data.healthFactor) / 1e18 : null; // no debt = no health factor

    // Update DOM
    const elSupplied = document.getElementById('aave-total-supplied');
    const elBorrowed = document.getElementById('aave-total-borrowed');
    const elApy = document.getElementById('aave-net-apy');
    const elAvail = document.getElementById('aave-available-borrow');
    const elLtv = document.getElementById('aave-ltv');
    const elHfStatus = document.getElementById('hf-status');

    if (elSupplied)
      elSupplied.textContent = totalSupplied > 0 ? `$${totalSupplied.toFixed(2)}` : '$0.00';
    if (elBorrowed) {
      elBorrowed.textContent = totalBorrowed > 0 ? `$${totalBorrowed.toFixed(2)}` : '$0.00';
      elBorrowed.className = 'stat-val' + (totalBorrowed > 0 ? ' text-warn' : '');
    }
    if (elAvail)
      elAvail.textContent = availableBorrow > 0 ? `$${availableBorrow.toFixed(2)}` : '$0.00';
    if (elLtv) elLtv.textContent = ltv > 0 ? `${ltv.toFixed(1)}%` : '—';

    // Net APY — weighted average of supplied asset APYs
    if (elApy && state.apyCache) {
      const aETHval = state.balances.aETH * (state.apyCache.ETH || 0);
      const aUSDCval = state.balances.aUSDC * (state.apyCache.USDC || 0);
      const aUSDTval = state.balances.aUSDT * (state.apyCache.USDT || 0);
      const totalVal = state.balances.aETH + state.balances.aUSDC + state.balances.aUSDT;
      const netApy = totalVal > 0 ? (aETHval + aUSDCval + aUSDTval) / totalVal : 0;
      elApy.textContent = netApy > 0.01 ? `+${netApy.toFixed(2)}%` : '—';
    }

    // Health Factor gauge
    const { drawHealthFactorGauge } = await import('./charts.js');
    if (hf !== null) {
      drawHealthFactorGauge(hf);
      // Update HF status text
      if (elHfStatus) {
        if (hf >= 2) {
          elHfStatus.textContent = '● Safe';
          elHfStatus.style.color = 'var(--ok)';
        } else if (hf >= 1.2) {
          elHfStatus.textContent = '● Warning';
          elHfStatus.style.color = 'var(--warn)';
        } else {
          elHfStatus.textContent = '● Danger';
          elHfStatus.style.color = 'var(--err)';
        }
      }
      // Update SVG arc fill based on HF
      updateHfArc(hf);
    } else {
      // No debt — show infinite/safe
      drawHealthFactorGauge(Infinity);
      if (elHfStatus) {
        if (totalSupplied > 0) {
          elHfStatus.textContent = '● No debt';
          elHfStatus.style.color = 'var(--ok)';
        } else {
          elHfStatus.textContent = '—';
          elHfStatus.style.color = 'var(--t2)';
        }
      }
    }

    // Update summary bar with real $ value
    const sumAave = document.getElementById('sum-aave');
    if (sumAave) {
      sumAave.textContent = totalSupplied > 0 ? `$${totalSupplied.toFixed(2)}` : '—';
      sumAave.classList.remove('loading');
    }
  } catch (e) {
    console.warn('[loadAavePosition]', e.message);
  }
}

// Update the SVG arc fill length based on health factor
function updateHfArc(hf) {
  const arc = document.getElementById('hf-arc');
  if (!arc) return;
  // Map HF to percentage: 0→0%, 1→33%, 2→66%, 3+→100%
  const pct = Math.min(1, Math.max(0, hf / 3));
  // Arc goes from (10,65) to (110,65) through top — a semicircle
  // We compute the endpoint at pct of the arc
  const angle = Math.PI * (1 - pct); // from PI (left) to 0 (right)
  const cx = 60,
    cy = 65,
    r = 55;
  const ex = cx + r * Math.cos(angle);
  const ey = cy - r * Math.sin(angle);
  const largeArc = pct > 0.5 ? 1 : 0;
  arc.setAttribute('d', `M10 65 A55 55 0 ${largeArc} 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`);
}

// ── AAVE APY ──
function rayToAPY(liquidityRate) {
  const apr = Number(liquidityRate) / 1e27;
  return (Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1) * 100;
}

export async function loadAaveApys() {
  if (!state.ethProvider) return;
  const c = cfg();
  if (!c?.hasAave || !c.pool) return;
  const ethers = window.ethers;
  const pool = new ethers.Contract(c.pool, POOL_ABI, state.ethProvider);
  const assets = { ETH: c.tokens.WETH, USDC: c.tokens.USDC, USDT: c.tokens.USDT };
  for (const [sym, addr] of Object.entries(assets)) {
    if (!addr) continue;
    try {
      const data = await pool.getReserveData(addr);
      const rate = data[2];
      const apy = rayToAPY(rate);
      state.apyCache[sym] = apy;
      const el = document.getElementById(`apy-${sym.toLowerCase()}`);
      if (el) el.textContent = apy > 0.01 ? `APY ${apy.toFixed(2)}%` : '';
    } catch {
      /* skip */
    }
  }
  updateDepositApyBadge();
}

export function updateDepositApyBadge() {
  const badge = document.getElementById('deposit-apy-badge');
  if (!badge) return;
  const apy = state.apyCache[state.depositToken];
  badge.textContent = apy != null && apy > 0.01 ? `APY ${apy.toFixed(2)}%` : '';
}
