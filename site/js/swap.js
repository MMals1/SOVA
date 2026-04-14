// ══════════════════════════════════════════════════════════════════════
// swap.js — Uniswap V3 swap handlers
// ══════════════════════════════════════════════════════════════════════
import { state, cfg } from './state.js';
import { DECIMALS, ERC20_ABI, QUOTER_ABI, SWAP_ROUTER_ABI } from './config.js';
import { setResult, toast, logHistory, showProgress, hideProgress, fmt } from './ui.js';
import { loadAll } from './balance.js';

let quoteTimer = null;

export function updateSwapFromBal() {
  const sym = document.getElementById('swap-from').value;
  const bal = sym === 'ETH' ? state.balances.ETH : state.balances[sym] || 0;
  document.getElementById('swap-from-bal').textContent = bal > 0 ? `Balance: ${fmt(bal)}` : '';
}

async function getQuote() {
  if (!state.ethProvider || !cfg()?.hasSwap) return;
  const ethers = window.ethers;
  const c = cfg();
  const fromSym = document.getElementById('swap-from').value;
  const toSym = document.getElementById('swap-to').value;
  const amtStr = document.getElementById('swap-amount').value.trim();
  if (!amtStr || parseFloat(amtStr) <= 0 || fromSym === toSym) {
    document.getElementById('swap-receive').value = '';
    document.getElementById('swap-details').style.display = 'none';
    state.swapQuoteData = null;
    document.getElementById('btn-swap').disabled = true;
    return;
  }
  const tokenIn = fromSym === 'ETH' ? c.tokens.WETH : c.tokens[fromSym];
  const tokenOut = toSym === 'ETH' ? c.tokens.WETH : c.tokens[toSym];
  const decIn = DECIMALS[fromSym] || 18;
  const decOut = DECIMALS[toSym] || 18;
  const amountIn = ethers.parseUnits(amtStr, decIn);
  try {
    const q = new ethers.Contract(c.quoter, QUOTER_ABI, state.ethProvider);
    const res = await q.quoteExactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      amountIn,
      fee: state.swapFeeTier || 3000,
      sqrtPriceLimitX96: 0,
    });
    const amountOut = res[0] ?? res.amountOut;
    const outFmt = ethers.formatUnits(amountOut, decOut);
    const minOut = (parseFloat(outFmt) * 0.995).toFixed(decOut === 6 ? 2 : 6);
    const rate = (parseFloat(outFmt) / parseFloat(amtStr)).toFixed(4);
    document.getElementById('swap-receive').value = fmt(outFmt);
    document.getElementById('sd-rate').textContent = `1 ${fromSym} = ${rate} ${toSym}`;
    document.getElementById('sd-min').textContent = `${minOut} ${toSym}`;
    document.getElementById('swap-details').style.display = 'flex';
    state.swapQuoteData = {
      tokenIn,
      tokenOut,
      amountIn,
      amountOut,
      minOut: ethers.parseUnits(minOut, decOut),
      fromSym,
      toSym,
      amtStr,
    };
    document.getElementById('btn-swap').disabled = false;
  } catch (e) {
    document.getElementById('swap-receive').value = '';
    document.getElementById('swap-details').style.display = 'none';
    state.swapQuoteData = null;
    document.getElementById('btn-swap').disabled = true;
  }
}

function updateRouteViz() {
  const from = document.getElementById('swap-from').value;
  const to = document.getElementById('swap-to').value;
  const fee = state.swapFeeTier || 3000;
  const el = (id) => document.getElementById(id);
  if (el('route-from')) el('route-from').textContent = from;
  if (el('route-to')) el('route-to').textContent = to;
  if (el('route-pool')) el('route-pool').textContent = `Uniswap V3 (${(fee / 10000).toFixed(2)}%)`;
}

export function setupSwapHandlers() {
  // Flip
  document.getElementById('swap-flip-btn').addEventListener('click', () => {
    const f = document.getElementById('swap-from');
    const to = document.getElementById('swap-to');
    const tmp = f.value;
    f.value = to.value;
    to.value = tmp;
    // Swap pill visuals
    const fromIcon = document.getElementById('swap-from-icon');
    const fromLabel = document.getElementById('swap-from-label');
    const toIcon = document.getElementById('swap-to-icon');
    const toLabel = document.getElementById('swap-to-label');
    if (fromIcon && toIcon && fromLabel && toLabel) {
      const tmpIcon = fromIcon.src;
      const tmpLbl = fromLabel.textContent;
      fromIcon.src = toIcon.src;
      fromLabel.textContent = toLabel.textContent;
      toIcon.src = tmpIcon;
      toLabel.textContent = tmpLbl;
    }
    document.getElementById('swap-receive').value = '';
    document.getElementById('swap-details').style.display = 'none';
    state.swapQuoteData = null;
    document.getElementById('btn-swap').disabled = true;
    updateSwapFromBal();
    updateRouteViz();
  });

  // Live quote on input (debounced)
  document.getElementById('swap-amount').addEventListener('input', () => {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(getQuote, 600);
  });
  document.getElementById('swap-from').addEventListener('change', () => {
    updateSwapFromBal();
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(getQuote, 300);
  });
  document.getElementById('swap-to').addEventListener('change', () => {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(getQuote, 300);
  });

  // Token dropdowns
  function setupTokenDropdown(btnId, dropdownId, selectId, iconId, labelId) {
    const btn = document.getElementById(btnId);
    const dropdown = document.getElementById(dropdownId);
    const select = document.getElementById(selectId);
    if (!btn || !dropdown || !select) return;

    btn.addEventListener('click', (e) => {
      if (e.target.closest('.swap-token-dropdown')) return;
      document.querySelectorAll('.swap-token-dropdown').forEach((d) => {
        if (d !== dropdown) d.style.display = 'none';
      });
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });

    dropdown.addEventListener('click', (e) => {
      const opt = e.target.closest('button');
      if (!opt) return;
      const token = opt.dataset.token;
      const icon = opt.dataset.icon;
      select.value = token;
      const iconEl = document.getElementById(iconId);
      const labelEl = document.getElementById(labelId);
      if (iconEl) iconEl.src = icon;
      if (labelEl) labelEl.textContent = token;
      dropdown.style.display = 'none';
      select.dispatchEvent(new Event('change'));
      updateRouteViz();
    });
  }

  setupTokenDropdown(
    'swap-from-btn',
    'swap-from-dropdown',
    'swap-from',
    'swap-from-icon',
    'swap-from-label',
  );
  setupTokenDropdown('swap-to-btn', 'swap-to-dropdown', 'swap-to', 'swap-to-icon', 'swap-to-label');

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.swap-token-pick')) {
      document.querySelectorAll('.swap-token-dropdown').forEach((d) => (d.style.display = 'none'));
    }
  });

  // Settings toggle
  document.getElementById('swap-settings-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('swap-settings-panel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  // Custom slippage
  document.getElementById('swap-custom-slippage')?.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v > 0 && v <= 50) {
      state.slippage = v / 100;
      document.querySelectorAll('[data-slip]').forEach((b) => b.classList.remove('active'));
      const slipEl = document.getElementById('sd-slippage');
      if (slipEl) slipEl.textContent = v + '%';
    }
  });

  // Fee tier selector
  document.getElementById('swap-fee-tier-select')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    document
      .querySelectorAll('#swap-fee-tier-select button')
      .forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.swapFeeTier = parseInt(btn.dataset.fee);
    updateRouteViz();
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(getQuote, 300);
  });

  // Execute swap
  const btnSwap = document.getElementById('btn-swap');
  btnSwap.addEventListener('click', async () => {
    if (btnSwap.dataset.busy === '1') return;
    if (!state.signer || !state.swapQuoteData || !cfg()?.hasSwap) return;
    const c = cfg();
    const ethers = window.ethers;
    const { tokenIn, tokenOut, amountIn, minOut, fromSym, toSym, amtStr } = state.swapQuoteData;
    btnSwap.dataset.busy = '1';
    btnSwap.disabled = true;
    try {
      const isFromETH = fromSym === 'ETH';
      if (!isFromETH) {
        showProgress('swap-progress', ['Approve', 'Swap'], 0);
        const tk = new ethers.Contract(tokenIn, ERC20_ABI, state.signer);
        const allow = await tk.allowance(state.userAddress, c.swapRouter);
        if (allow < amountIn) {
          const atx = await tk.approve(c.swapRouter, amountIn);
          await atx.wait();
        }
        showProgress('swap-progress', ['Approve', 'Swap'], 1);
      } else {
        showProgress('swap-progress', ['Swap'], 0);
      }
      const router = new ethers.Contract(c.swapRouter, SWAP_ROUTER_ABI, state.signer);
      const deadlineMin = parseInt(document.getElementById('swap-deadline')?.value) || 30;
      const deadline = Math.floor(Date.now() / 1000) + deadlineMin * 60;
      const tx = await router.exactInputSingle(
        {
          tokenIn,
          tokenOut,
          fee: state.swapFeeTier || 3000,
          recipient: state.userAddress,
          deadline,
          amountIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0,
        },
        isFromETH ? { value: amountIn } : {},
      );
      toast(`${amtStr} ${fromSym} \u2192 ${toSym}`, 'success', c.explorer + tx.hash);
      logHistory('swap', `${amtStr} ${fromSym} \u2192 ${toSym}`, tx.hash);
      await tx.wait();
      hideProgress('swap-progress');
      state.swapQuoteData = null;
      document.getElementById('btn-swap').disabled = true;
      document.getElementById('swap-amount').value = '';
      document.getElementById('swap-receive').value = '';
      document.getElementById('swap-details').style.display = 'none';
      loadAll();
    } catch (e) {
      hideProgress('swap-progress');
      setResult('swap-result', e.message?.slice(0, 80), 'error');
      toast(e.message?.slice(0, 60), 'error');
    } finally {
      btnSwap.dataset.busy = '0';
    }
  });
}
