// ══════════════════════════════════════════════════════════════════════
// aave.js — AAVE deposit/withdraw handlers
// ══════════════════════════════════════════════════════════════════════
import { state, cfg } from './state.js';
import { DECIMALS, ERC20_ABI, POOL_ABI, WETH_GATEWAY_ABI } from './config.js';
import { t } from './i18n.js';
import { setResult, toast, logHistory, showProgress, hideProgress, fmt } from './ui.js';
import { loadAll, updateDepositApyBadge } from './balance.js';

// ── Show current allowance for ERC-20 deposits ──
export async function updateAllowanceInfo() {
  const info = document.getElementById('deposit-allowance-info');
  if (!info) return;
  if (!state.userAddress || !state.ethProvider) {
    info.style.display = 'none';
    return;
  }
  const c = cfg();
  if (!c || !c.hasAave) {
    info.style.display = 'none';
    return;
  }
  // ETH doesn't need approve
  if (state.depositToken === 'ETH') {
    info.style.display = 'none';
    return;
  }
  const ethers = window.ethers;
  const addr = c.tokens[state.depositToken];
  if (!addr) {
    info.style.display = 'none';
    return;
  }
  try {
    const tk = new ethers.Contract(addr, ERC20_ABI, state.ethProvider);
    const allow = await tk.allowance(state.userAddress, c.pool);
    const dec = DECIMALS[state.depositToken] || 18;
    const allowFmt = parseFloat(ethers.formatUnits(allow, dec));
    info.style.display = 'block';
    if (allowFmt === 0) {
      info.innerHTML = `Allowance: <span style="color:var(--warn);">0 ${state.depositToken}</span> \u2014 approve required`;
    } else if (allowFmt > 1e12) {
      info.innerHTML = `Allowance: <span style="color:var(--ok);">unlimited</span>`;
    } else {
      info.innerHTML = `Allowance: <span style="color:var(--ok);">${fmt(allowFmt)} ${state.depositToken}</span>`;
    }
  } catch {
    info.style.display = 'none';
  }
}

export function setupAaveHandlers() {
  // Token pickers
  setupPicker('deposit-token-select', (tk) => {
    state.depositToken = tk;
    updateDepositApyBadge();
    updateAllowanceInfo();
  });
  setupPicker('withdraw-token-select', (tk) => {
    state.withdrawToken = tk;
  });
  // Initial allowance check + refresh on every interaction
  updateAllowanceInfo();

  // MAX buttons
  document.getElementById('deposit-max-btn').addEventListener('click', async () => {
    if (!state.userAddress || !state.ethProvider) return;
    const c = cfg();
    if (!c) return;
    if (state.depositToken === 'ETH') {
      document.getElementById('deposit-amount').value = Math.max(
        0,
        state.balances.ETH - 0.005,
      ).toFixed(6);
    } else {
      document.getElementById('deposit-amount').value = fmt(state.balances[state.depositToken]);
    }
  });
  document.getElementById('withdraw-max-btn').addEventListener('click', () => {
    document.getElementById('withdraw-amount').value = 'MAX';
  });

  // Deposit
  const btnDeposit = document.getElementById('btn-deposit');
  btnDeposit.addEventListener('click', async () => {
    if (btnDeposit.disabled) return;
    if (!state.signer || !state.userAddress) return;
    const c = cfg();
    if (!c || !c.hasAave) return;
    const ethers = window.ethers;
    const amtStr = document.getElementById('deposit-amount').value.trim();
    const errEl = document.getElementById('deposit-error');
    errEl.textContent = '';
    if (!amtStr || parseFloat(amtStr) <= 0) {
      errEl.textContent = t('errEnterAmount');
      return;
    }
    const amtNum = parseFloat(amtStr);
    if (state.depositToken === 'ETH' && amtNum > state.balances.ETH) {
      errEl.textContent = t('errInsufficient');
      document.getElementById('deposit-amount').classList.add('error');
      return;
    }
    if (state.depositToken !== 'ETH' && amtNum > state.balances[state.depositToken]) {
      errEl.textContent = t('errInsufficient');
      document.getElementById('deposit-amount').classList.add('error');
      return;
    }
    document.getElementById('deposit-amount').classList.remove('error');

    btnDeposit.disabled = true;
    try {
      if (state.depositToken === 'ETH') {
        showProgress('deposit-progress', ['Deposit ETH'], 0);
        const gw = new ethers.Contract(c.wethGateway, WETH_GATEWAY_ABI, state.signer);
        const tx = await gw.depositETH(c.pool, state.userAddress, 0, {
          value: ethers.parseEther(amtStr),
        });
        toast(`${amtStr} ETH \u2192 AAVE`, 'success', c.explorer + tx.hash);
        logHistory('deposit', `${amtStr} ETH \u2192 AAVE`, tx.hash);
        await tx.wait();
      } else {
        const addr = c.tokens[state.depositToken];
        const dec = DECIMALS[state.depositToken];
        const amt = ethers.parseUnits(amtStr, dec);
        const tk = new ethers.Contract(addr, ERC20_ABI, state.signer);
        // Step 1: Check allowance BEFORE showing progress to decide step count
        const allow = await tk.allowance(state.userAddress, c.pool);
        const needApprove = allow < amt;
        const steps = needApprove ? ['Approve', 'Deposit'] : ['Deposit'];
        if (needApprove) {
          showProgress('deposit-progress', steps, 0); // Approve active
          const atx = await tk.approve(c.pool, amt);
          await atx.wait();
          showProgress('deposit-progress', steps, 1); // Approve done, Deposit active
        } else {
          showProgress('deposit-progress', steps, 0); // Only Deposit, active
        }
        const pool = new ethers.Contract(c.pool, POOL_ABI, state.signer);
        const tx = await pool.supply(addr, amt, state.userAddress, 0);
        toast(`${amtStr} ${state.depositToken} \u2192 AAVE`, 'success', c.explorer + tx.hash);
        logHistory('deposit', `${amtStr} ${state.depositToken} \u2192 AAVE`, tx.hash);
        await tx.wait();
      }
      hideProgress('deposit-progress');
      setResult('deposit-result', '\u2713', 'success');
      loadAll();
      updateAllowanceInfo();
    } catch (e) {
      hideProgress('deposit-progress');
      setResult('deposit-result', e.message?.slice(0, 80), 'error');
      toast(e.message?.slice(0, 60), 'error');
    } finally {
      btnDeposit.disabled = false;
    }
  });

  // Withdraw
  const btnWithdraw = document.getElementById('btn-withdraw');
  btnWithdraw.addEventListener('click', async () => {
    if (btnWithdraw.disabled) return;
    if (!state.signer || !state.userAddress) return;
    const c = cfg();
    if (!c || !c.hasAave) return;
    const ethers = window.ethers;
    const amtStr = document.getElementById('withdraw-amount').value.trim();
    const isMax = amtStr.toUpperCase() === 'MAX';
    if (!isMax && (!amtStr || parseFloat(amtStr) <= 0)) {
      setResult('withdraw-result', t('errEnterAmount'), 'error');
      return;
    }
    const MAX_UINT = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    btnWithdraw.disabled = true;
    try {
      if (state.withdrawToken === 'ETH') {
        const aAddr = c.aTokens.ETH;
        const aTk = new ethers.Contract(aAddr, ERC20_ABI, state.signer);
        const amt = isMax ? BigInt(MAX_UINT) : ethers.parseEther(amtStr);
        showProgress('withdraw-progress', ['Approve aWETH', 'Withdraw'], 0);
        const atx = await aTk.approve(c.wethGateway, amt);
        await atx.wait();
        showProgress('withdraw-progress', ['Approve aWETH', 'Withdraw'], 1);
        const gw = new ethers.Contract(c.wethGateway, WETH_GATEWAY_ABI, state.signer);
        const tx = await gw.withdrawETH(c.pool, amt, state.userAddress);
        toast(`${isMax ? 'MAX' : amtStr} ETH \u2190 AAVE`, 'success', c.explorer + tx.hash);
        logHistory('withdraw', `${isMax ? 'MAX' : amtStr} ETH \u2190 AAVE`, tx.hash);
        await tx.wait();
      } else {
        const addr = c.tokens[state.withdrawToken];
        const dec = DECIMALS[state.withdrawToken];
        const amt = isMax ? BigInt(MAX_UINT) : ethers.parseUnits(amtStr, dec);
        showProgress('withdraw-progress', ['Withdraw'], 0);
        const pool = new ethers.Contract(c.pool, POOL_ABI, state.signer);
        const tx = await pool.withdraw(addr, amt, state.userAddress);
        toast(
          `${isMax ? 'MAX' : amtStr} ${state.withdrawToken} \u2190 AAVE`,
          'success',
          c.explorer + tx.hash,
        );
        logHistory(
          'withdraw',
          `${isMax ? 'MAX' : amtStr} ${state.withdrawToken} \u2190 AAVE`,
          tx.hash,
        );
        await tx.wait();
      }
      hideProgress('withdraw-progress');
      setResult('withdraw-result', '\u2713', 'success');
      loadAll();
    } catch (e) {
      hideProgress('withdraw-progress');
      setResult('withdraw-result', e.message?.slice(0, 80), 'error');
      toast(e.message?.slice(0, 60), 'error');
    } finally {
      btnWithdraw.disabled = false;
    }
  });
}

function setupPicker(id, cb) {
  document.getElementById(id).addEventListener('click', (e) => {
    const b = e.target.closest('.token-opt, .token-seg button');
    if (!b) return;
    document
      .getElementById(id)
      .querySelectorAll('.token-opt, .token-seg button')
      .forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    cb(b.dataset.token);
  });
}
