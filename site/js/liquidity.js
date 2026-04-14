// ══════════════════════════════════════════════════════════════════════
// liquidity.js — UI handlers: mint, remove, collect, pool/fee select
// ══════════════════════════════════════════════════════════════════════
import { state, cfg } from './state.js';
import { DECIMALS, ERC20_ABI, NFPM_ABI, FEE_TICK_SPACING } from './config.js';
import { t } from './i18n.js';
import { setResult, toast, logHistory, showProgress, hideProgress, fmt } from './ui.js';
import { loadAll } from './balance.js';
import { sqrtPriceToPrice, priceToTick, nearestUsableTick } from './v3-math.js';
import {
  loadLPPositions,
  getPoolData,
  tokenSymbol,
  registerActionHandlers,
} from './v3-positions.js';

// ── Re-exports (preserve public API for balance.js / main.js) ──
export { loadLPPositions } from './v3-positions.js';
export {
  sqrtPriceToPrice,
  priceToTick,
  tickToPrice,
  nearestUsableTick,
  calculatePositionAmounts,
  calculateImpermanentLoss,
} from './v3-math.js';

// ── Pool selector ──

export function populatePoolSelect() {
  const c = cfg();
  const sel = document.getElementById('lp-pool-select');
  sel.innerHTML = '<option value="">-- Select Pool --</option>';
  if (!c?.uniV3?.pools) return;
  for (const [name, info] of Object.entries(c.uniV3.pools)) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `${name} (${(info.fee / 10000).toFixed(2)}%)`;
    sel.appendChild(opt);
  }
}

// ── Pool change handler ──

async function onPoolSelect(poolKey) {
  const c = cfg();
  if (!c?.uniV3?.pools || !poolKey) {
    state.selectedPool = null;
    return;
  }
  const poolInfo = c.uniV3.pools[poolKey];
  if (!poolInfo) return;
  state.selectedPool = poolKey;
  state.selectedFee = poolInfo.fee;
  document.querySelectorAll('#lp-fee-select button').forEach((b) => {
    b.classList.toggle('active', parseInt(b.dataset.fee) === state.selectedFee);
  });

  const parts = poolKey.split('/');
  const token0Sym = parts[0] === 'ETH' ? 'WETH' : parts[0];
  const token1Sym = parts[1] === 'ETH' ? 'WETH' : parts[1];
  const token0Addr =
    c.tokens[token0Sym] || (c.lido && token0Sym === 'wstETH' ? c.lido.wstETH : null);
  const token1Addr = c.tokens[token1Sym] || (c.lido && token1Sym === 'WETH' ? c.tokens.WETH : null);

  document.getElementById('lp-amount0-label').textContent = `Amount ${parts[0]}`;
  document.getElementById('lp-amount1-label').textContent = `Amount ${parts[1]}`;

  if (token0Addr && token1Addr) {
    const poolData = await getPoolData(token0Addr, token1Addr, state.selectedFee);
    if (poolData) {
      const dec0 = DECIMALS[token0Sym] || 18;
      const dec1 = DECIMALS[token1Sym] || 18;
      state.currentPoolPrice = sqrtPriceToPrice(poolData.sqrtPriceX96, dec0, dec1);
      document.getElementById('lp-current-price').textContent =
        state.currentPoolPrice.toFixed(6) + ` ${parts[1]}/${parts[0]}`;
      document.getElementById('lp-pool-price').style.display = 'block';
      setRangePreset('10');
      return;
    }
  }
  document.getElementById('lp-pool-price').style.display = 'none';
  state.currentPoolPrice = null;
}

// ── Range presets ──

function setRangePreset(preset) {
  if (!state.currentPoolPrice) return;
  let minP, maxP;
  if (preset === 'full') {
    minP = 0;
    maxP = 999999999;
  } else {
    const pct = parseInt(preset) / 100;
    minP = state.currentPoolPrice * (1 - pct);
    maxP = state.currentPoolPrice * (1 + pct);
  }
  document.getElementById('min-price').value = minP > 0 ? minP.toFixed(6) : '0';
  document.getElementById('max-price').value = maxP > 999999 ? 'Infinity' : maxP.toFixed(6);
}

// ── Remove Liquidity ──

async function removeLiquidity(tokenId) {
  if (!state.signer || !state.userAddress) return;
  const c = cfg();
  if (!c?.hasLiquidity || !c.uniV3) return;
  const ethers = window.ethers;
  const pos = state.lpPositions.find((p) => p.tokenId === tokenId);
  if (!pos || Number(pos.liquidity) === 0) {
    toast('No liquidity to remove', 'error');
    return;
  }

  try {
    const nfpm = new ethers.Contract(c.uniV3.nfpm, NFPM_ABI, state.signer);
    const deadline = Math.floor(Date.now() / 1000) + 1800;
    showProgress('lp-mint-progress', ['Remove Liquidity', 'Collect'], 0);
    const tx1 = await nfpm.decreaseLiquidity({
      tokenId: tokenId,
      liquidity: pos.liquidity,
      amount0Min: 0,
      amount1Min: 0,
      deadline,
    });
    await tx1.wait();
    showProgress('lp-mint-progress', ['Remove Liquidity', 'Collect'], 1);
    const MAX_UINT128 = 2n ** 128n - 1n;
    const tx2 = await nfpm.collect({
      tokenId: tokenId,
      recipient: state.userAddress,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    });
    toast(`Removed LP #${tokenId}`, 'success', c.explorer + tx2.hash);
    logHistory(
      'removelp',
      `Removed LP #${tokenId} ${tokenSymbol(pos.token0)}/${tokenSymbol(pos.token1)}`,
      tx2.hash,
    );
    await tx2.wait();
    hideProgress('lp-mint-progress');
    loadLPPositions();
    loadAll();
  } catch (e) {
    hideProgress('lp-mint-progress');
    toast(e.message?.slice(0, 60), 'error');
  }
}

// ── Collect Fees ──

async function collectFees(tokenId) {
  if (!state.signer || !state.userAddress) return;
  const c = cfg();
  if (!c?.hasLiquidity || !c.uniV3) return;
  const ethers = window.ethers;

  try {
    const nfpm = new ethers.Contract(c.uniV3.nfpm, NFPM_ABI, state.signer);
    const MAX_UINT128 = 2n ** 128n - 1n;
    showProgress('lp-mint-progress', ['Collect Fees'], 0);
    const tx = await nfpm.collect({
      tokenId: tokenId,
      recipient: state.userAddress,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128,
    });
    const pos = state.lpPositions.find((p) => p.tokenId === tokenId);
    toast(`Collected fees for #${tokenId}`, 'success', c.explorer + tx.hash);
    logHistory(
      'collect',
      `Collected fees #${tokenId} ${pos ? tokenSymbol(pos.token0) + '/' + tokenSymbol(pos.token1) : ''}`,
      tx.hash,
    );
    await tx.wait();
    hideProgress('lp-mint-progress');
    loadLPPositions();
    loadAll();
  } catch (e) {
    hideProgress('lp-mint-progress');
    toast(e.message?.slice(0, 60), 'error');
  }
}

// ── Setup all liquidity event handlers ──

export function setupLiquidityHandlers() {
  const ethers = window.ethers;

  // Register collect/remove callbacks so v3-positions can invoke them from cards
  registerActionHandlers({ collectFees, removeLiquidity });

  // Pool select
  document.getElementById('lp-pool-select').addEventListener('change', (e) => {
    onPoolSelect(e.target.value);
  });

  // Fee tier selector
  document.getElementById('lp-fee-select').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    document.querySelectorAll('#lp-fee-select button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.selectedFee = parseInt(btn.dataset.fee);
  });

  // MAX buttons for LP amounts
  document.getElementById('lp-amount0-max').addEventListener('click', () => {
    if (!state.selectedPool) return;
    const parts = state.selectedPool.split('/');
    const sym0 = parts[0] === 'ETH' ? 'ETH' : parts[0];
    const bal =
      sym0 === 'ETH' ? Math.max(0, state.balances.ETH - 0.005) : state.balances[sym0] || 0;
    document.getElementById('lp-amount0').value = fmt(bal);
  });
  document.getElementById('lp-amount1-max').addEventListener('click', () => {
    if (!state.selectedPool) return;
    const parts = state.selectedPool.split('/');
    const sym1 = parts[1] === 'ETH' ? 'ETH' : parts[1];
    const bal =
      sym1 === 'ETH' ? Math.max(0, state.balances.ETH - 0.005) : state.balances[sym1] || 0;
    document.getElementById('lp-amount1').value = fmt(bal);
  });

  // Mint Position
  const btnMint = document.getElementById('btn-lp-mint');
  btnMint.addEventListener('click', async () => {
    if (btnMint.disabled) return;
    if (!state.signer || !state.userAddress) return;
    const c = cfg();
    if (!c?.hasLiquidity || !c.uniV3) return;
    if (!state.selectedPool || !state.currentPoolPrice) {
      setResult('lp-mint-result', 'Select a pool first', 'error');
      return;
    }

    const parts = state.selectedPool.split('/');
    const sym0 = parts[0] === 'ETH' ? 'WETH' : parts[0];
    const sym1 = parts[1] === 'ETH' ? 'WETH' : parts[1];
    const token0 = c.tokens[sym0] || (c.lido && sym0 === 'wstETH' ? c.lido.wstETH : null);
    const token1 = c.tokens[sym1] || (c.lido && sym1 === 'WETH' ? c.tokens.WETH : null);
    if (!token0 || !token1) {
      setResult('lp-mint-result', 'Token addresses not found', 'error');
      return;
    }

    const dec0 = DECIMALS[sym0] || 18;
    const dec1 = DECIMALS[sym1] || 18;
    const amt0Str = document.getElementById('lp-amount0').value.trim();
    const amt1Str = document.getElementById('lp-amount1').value.trim();
    if ((!amt0Str || parseFloat(amt0Str) <= 0) && (!amt1Str || parseFloat(amt1Str) <= 0)) {
      setResult('lp-mint-result', t('errEnterAmount'), 'error');
      return;
    }
    const amount0Desired =
      amt0Str && parseFloat(amt0Str) > 0 ? ethers.parseUnits(amt0Str, dec0) : 0n;
    const amount1Desired =
      amt1Str && parseFloat(amt1Str) > 0 ? ethers.parseUnits(amt1Str, dec1) : 0n;

    const minPriceStr = document.getElementById('min-price').value.trim();
    const maxPriceStr = document.getElementById('max-price').value.trim();
    if (!minPriceStr || !maxPriceStr) {
      setResult('lp-mint-result', 'Set price range', 'error');
      return;
    }
    const minPrice = parseFloat(minPriceStr) || 0;
    const maxPrice = maxPriceStr === 'Infinity' ? 887272 : parseFloat(maxPriceStr);

    const tickSpacing = FEE_TICK_SPACING[state.selectedFee] || 60;
    let tickLower, tickUpper;
    if (minPrice <= 0) {
      tickLower = nearestUsableTick(-887272, tickSpacing);
    } else {
      tickLower = nearestUsableTick(priceToTick(minPrice), tickSpacing);
    }
    if (maxPrice >= 887272) {
      tickUpper = nearestUsableTick(887272, tickSpacing);
    } else {
      tickUpper = nearestUsableTick(priceToTick(maxPrice), tickSpacing);
    }
    if (tickLower >= tickUpper) {
      setResult('lp-mint-result', 'Invalid price range', 'error');
      return;
    }

    let orderedToken0 = token0,
      orderedToken1 = token1;
    let orderedAmt0 = amount0Desired,
      orderedAmt1 = amount1Desired;
    let orderedTickLower = tickLower,
      orderedTickUpper = tickUpper;
    if (BigInt(token0) > BigInt(token1)) {
      orderedToken0 = token1;
      orderedToken1 = token0;
      orderedAmt0 = amount1Desired;
      orderedAmt1 = amount0Desired;
      orderedTickLower = -tickUpper;
      orderedTickUpper = -tickLower;
    }

    btnMint.disabled = true;
    try {
      const isFromETH = parts[0] === 'ETH' || parts[1] === 'ETH';
      const steps = isFromETH ? ['Approve', 'Mint'] : ['Approve Token0', 'Approve Token1', 'Mint'];
      let stepIdx = 0;
      showProgress('lp-mint-progress', steps, stepIdx);

      if (!isFromETH || parts[0] !== 'ETH') {
        if (orderedAmt0 > 0n) {
          const tk0 = new ethers.Contract(orderedToken0, ERC20_ABI, state.signer);
          const allow = await tk0.allowance(state.userAddress, c.uniV3.nfpm);
          if (allow < orderedAmt0) {
            const atx = await tk0.approve(c.uniV3.nfpm, orderedAmt0);
            await atx.wait();
          }
        }
      }
      stepIdx++;
      showProgress('lp-mint-progress', steps, stepIdx);

      if (!isFromETH) {
        if (orderedAmt1 > 0n) {
          const tk1 = new ethers.Contract(orderedToken1, ERC20_ABI, state.signer);
          const allow = await tk1.allowance(state.userAddress, c.uniV3.nfpm);
          if (allow < orderedAmt1) {
            const atx = await tk1.approve(c.uniV3.nfpm, orderedAmt1);
            await atx.wait();
          }
        }
        stepIdx++;
        showProgress('lp-mint-progress', steps, stepIdx);
      }

      const nfpm = new ethers.Contract(c.uniV3.nfpm, NFPM_ABI, state.signer);
      const deadline = Math.floor(Date.now() / 1000) + 1800;
      const mintParams = {
        token0: orderedToken0,
        token1: orderedToken1,
        fee: state.selectedFee,
        tickLower: orderedTickLower,
        tickUpper: orderedTickUpper,
        amount0Desired: orderedAmt0,
        amount1Desired: orderedAmt1,
        amount0Min: 0,
        amount1Min: 0,
        recipient: state.userAddress,
        deadline,
      };

      let ethValue = 0n;
      if (isFromETH) {
        if (parts[0] === 'ETH') ethValue = amount0Desired;
        else if (parts[1] === 'ETH') ethValue = amount1Desired;
      }

      const tx = await nfpm.mint(mintParams, ethValue > 0n ? { value: ethValue } : {});
      toast(`Minted LP: ${state.selectedPool}`, 'success', c.explorer + tx.hash);
      logHistory(
        'mint',
        `LP ${state.selectedPool} (${(state.selectedFee / 10000).toFixed(2)}%)`,
        tx.hash,
      );
      await tx.wait();
      hideProgress('lp-mint-progress');
      setResult('lp-mint-result', '\u2713 Position created', 'success');
      document.getElementById('lp-amount0').value = '';
      document.getElementById('lp-amount1').value = '';
      loadLPPositions();
      loadAll();
    } catch (e) {
      hideProgress('lp-mint-progress');
      setResult('lp-mint-result', e.message?.slice(0, 80), 'error');
      toast(e.message?.slice(0, 60), 'error');
    } finally {
      btnMint.disabled = false;
    }
  });
}
