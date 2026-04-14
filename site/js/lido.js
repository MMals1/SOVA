// ══════════════════════════════════════════════════════════════════════
// lido.js — Lido stake, wrap/unwrap, withdrawal request/claim
// ══════════════════════════════════════════════════════════════════════
import { state, cfg } from './state.js';
import { LIDO_ABI, WSTETH_ABI, WITHDRAWAL_QUEUE_ABI } from './config.js';
import { t } from './i18n.js';
import { setResult, toast, logHistory, showProgress, hideProgress, fmt } from './ui.js';
import { loadAll } from './balance.js';

// ── Withdrawal ID storage ──
function getLidoWithdrawalIds() {
  try {
    return JSON.parse(localStorage.getItem('sova-lido-wd-' + state.userAddress) || '[]');
  } catch {
    return [];
  }
}
function saveLidoWithdrawalIds(ids) {
  localStorage.setItem('sova-lido-wd-' + state.userAddress, JSON.stringify(ids));
}

// ── APR ──
export async function loadLidoApr() {
  try {
    const res = await fetch('https://eth-api.lido.fi/v1/protocol/steth/apr/sma');
    const json = await res.json();
    state.lidoApr = json?.data?.smaApr ?? null;
    const badge = document.getElementById('lido-apr-badge');
    const apyEl = document.getElementById('apy-lido');
    if (state.lidoApr != null && state.lidoApr > 0) {
      if (badge) badge.textContent = `APR ${state.lidoApr.toFixed(2)}%`;
      if (apyEl) apyEl.textContent = `APR ${state.lidoApr.toFixed(2)}%`;
    }
  } catch {
    /* skip */
  }
}

// ── Load Withdrawal Requests ──
export async function loadWithdrawalRequests() {
  if (!state.userAddress || !state.ethProvider) return;
  const c = cfg();
  if (!c?.hasLido || !c.lido?.withdrawalQueue) return;
  const ethers = window.ethers;
  const container = document.getElementById('lido-withdrawal-list');
  const claimBtn = document.getElementById('btn-lido-claim');
  const storedIds = getLidoWithdrawalIds();
  if (!storedIds.length) {
    container.innerHTML = '';
    if (claimBtn) claimBtn.style.display = 'none';
    return;
  }

  try {
    const queue = new ethers.Contract(
      c.lido.withdrawalQueue,
      WITHDRAWAL_QUEUE_ABI,
      state.ethProvider,
    );
    const numericIds = storedIds.filter(
      (s) => typeof s === 'number' || (typeof s === 'string' && !isNaN(s)),
    );
    container.innerHTML = '';
    let hasClaimable = false;

    for (const entry of storedIds) {
      const div = document.createElement('div');
      div.className = 'lido-withdrawal-item';
      if (typeof entry === 'object' && entry.hash) {
        div.innerHTML = `<span class="wd-amount">${entry.amount} stETH</span><span class="wd-status pending">Pending</span>`;
      }
      container.appendChild(div);
    }

    if (numericIds.length > 0) {
      const statuses = await queue.getWithdrawalStatus(numericIds.map(Number));
      container.innerHTML = '';
      statuses.forEach((s, i) => {
        const div = document.createElement('div');
        div.className = 'lido-withdrawal-item';
        const amtEth = parseFloat(ethers.formatEther(s.amountOfStETH)).toFixed(4);
        let statusClass = 'pending',
          statusText = 'Pending';
        if (s.isClaimed) {
          statusClass = 'claimed';
          statusText = 'Claimed';
        } else if (s.isFinalized) {
          statusClass = 'claimable';
          statusText = 'Claimable';
          hasClaimable = true;
        }
        div.innerHTML = `<span class="wd-amount">${amtEth} stETH</span><span class="wd-status ${statusClass}">${statusText}</span>`;
        container.appendChild(div);
      });
    }

    if (claimBtn) claimBtn.style.display = hasClaimable ? 'block' : 'none';
  } catch {
    container.innerHTML =
      '<div style="font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">Could not load withdrawal status</div>';
  }
}

export function setupLidoHandlers() {
  const ethers = window.ethers;

  // Stake
  const btnStake = document.getElementById('btn-lido-stake');
  btnStake.addEventListener('click', async () => {
    if (btnStake.disabled) return;
    if (!state.signer || !state.userAddress) return;
    const c = cfg();
    if (!c?.hasLido || !c.lido) return;
    const amtStr = document.getElementById('lido-stake-amount').value.trim();
    if (!amtStr || parseFloat(amtStr) <= 0) {
      setResult('lido-stake-result', t('errEnterAmount'), 'error');
      return;
    }
    if (parseFloat(amtStr) > state.balances.ETH) {
      setResult('lido-stake-result', t('errInsufficient'), 'error');
      return;
    }
    btnStake.disabled = true;
    try {
      showProgress('lido-stake-progress', ['Stake ETH'], 0);
      const lido = new ethers.Contract(c.lido.stETH, LIDO_ABI, state.signer);
      const tx = await lido.submit(ethers.ZeroAddress, { value: ethers.parseEther(amtStr) });
      toast(`${amtStr} ETH staked via Lido`, 'success', c.explorer + tx.hash);
      logHistory('stake', `${amtStr} ETH \u2192 stETH (Lido)`, tx.hash);
      await tx.wait();
      hideProgress('lido-stake-progress');
      setResult('lido-stake-result', '\u2713', 'success');
      document.getElementById('lido-stake-amount').value = '';
      loadAll();
    } catch (e) {
      hideProgress('lido-stake-progress');
      setResult('lido-stake-result', e.message?.slice(0, 80), 'error');
      toast(e.message?.slice(0, 60), 'error');
    } finally {
      btnStake.disabled = false;
    }
  });

  // Stake MAX
  (
    document.getElementById('lido-stake-max') || document.getElementById('lido-stake-max-btn')
  ).addEventListener('click', () => {
    document.getElementById('lido-stake-amount').value = Math.max(
      0,
      state.balances.ETH - 0.005,
    ).toFixed(6);
  });

  // Wrap toggle
  document.getElementById('wrap-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    document.querySelectorAll('#wrap-toggle button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.lidoWrapMode = btn.dataset.mode;
    document.getElementById('btn-lido-wrap').textContent =
      state.lidoWrapMode === 'wrap' ? t('btnWrap') : t('btnUnwrap');
  });

  // Wrap MAX
  document.getElementById('lido-wrap-max').addEventListener('click', () => {
    if (state.lidoWrapMode === 'wrap') {
      document.getElementById('lido-wrap-amount').value = fmt(state.balances.stETH);
    } else {
      document.getElementById('lido-wrap-amount').value = fmt(state.balances.wstETH);
    }
  });

  // Wrap / Unwrap
  const btnWrap = document.getElementById('btn-lido-wrap');
  btnWrap.addEventListener('click', async () => {
    if (btnWrap.disabled) return;
    if (!state.signer || !state.userAddress) return;
    const c = cfg();
    if (!c?.hasLido || !c.lido) return;
    const amtStr = document.getElementById('lido-wrap-amount').value.trim();
    if (!amtStr || parseFloat(amtStr) <= 0) {
      setResult('lido-wrap-result', t('errEnterAmount'), 'error');
      return;
    }

    btnWrap.disabled = true;
    try {
      if (state.lidoWrapMode === 'wrap') {
        const amt = ethers.parseEther(amtStr);
        showProgress('lido-wrap-progress', ['Approve stETH', 'Wrap'], 0);
        const stETH = new ethers.Contract(c.lido.stETH, LIDO_ABI, state.signer);
        const allow = await stETH.allowance(state.userAddress, c.lido.wstETH);
        if (allow < amt) {
          const atx = await stETH.approve(c.lido.wstETH, amt);
          await atx.wait();
        }
        showProgress('lido-wrap-progress', ['Approve stETH', 'Wrap'], 1);
        const wstETH = new ethers.Contract(c.lido.wstETH, WSTETH_ABI, state.signer);
        const tx = await wstETH.wrap(amt);
        toast(`${amtStr} stETH \u2192 wstETH`, 'success', c.explorer + tx.hash);
        logHistory('wrap', `${amtStr} stETH \u2192 wstETH`, tx.hash);
        await tx.wait();
      } else {
        const amt = ethers.parseEther(amtStr);
        showProgress('lido-wrap-progress', ['Unwrap'], 0);
        const wstETH = new ethers.Contract(c.lido.wstETH, WSTETH_ABI, state.signer);
        const tx = await wstETH.unwrap(amt);
        toast(`${amtStr} wstETH \u2192 stETH`, 'success', c.explorer + tx.hash);
        logHistory('wrap', `${amtStr} wstETH \u2192 stETH`, tx.hash);
        await tx.wait();
      }
      hideProgress('lido-wrap-progress');
      setResult('lido-wrap-result', '\u2713', 'success');
      document.getElementById('lido-wrap-amount').value = '';
      loadAll();
    } catch (e) {
      hideProgress('lido-wrap-progress');
      setResult('lido-wrap-result', e.message?.slice(0, 80), 'error');
      toast(e.message?.slice(0, 60), 'error');
    } finally {
      btnWrap.disabled = false;
    }
  });

  // Withdraw MAX
  document.getElementById('lido-withdraw-max').addEventListener('click', () => {
    document.getElementById('lido-withdraw-amount').value = fmt(state.balances.stETH);
  });

  // Request Withdrawal
  const btnRequestWd =
    document.getElementById('btn-lido-request-wd') ||
    document.getElementById('btn-lido-request-withdraw');
  btnRequestWd.addEventListener('click', async () => {
    if (btnRequestWd.disabled) return;
    if (!state.signer || !state.userAddress) return;
    const c = cfg();
    if (!c?.hasLido || !c.lido) return;
    const amtStr = document.getElementById('lido-withdraw-amount').value.trim();
    if (!amtStr || parseFloat(amtStr) <= 0) {
      setResult('lido-withdraw-result', t('errEnterAmount'), 'error');
      return;
    }
    if (parseFloat(amtStr) > state.balances.stETH) {
      setResult('lido-withdraw-result', t('errInsufficient'), 'error');
      return;
    }

    btnRequestWd.disabled = true;
    try {
      const amt = ethers.parseEther(amtStr);
      showProgress('lido-withdraw-progress', ['Approve stETH', 'Request'], 0);
      const stETH = new ethers.Contract(c.lido.stETH, LIDO_ABI, state.signer);
      const allow = await stETH.allowance(state.userAddress, c.lido.withdrawalQueue);
      if (allow < amt) {
        const atx = await stETH.approve(c.lido.withdrawalQueue, amt);
        await atx.wait();
      }
      showProgress('lido-withdraw-progress', ['Approve stETH', 'Request'], 1);
      const queue = new ethers.Contract(c.lido.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, state.signer);
      const tx = await queue.requestWithdrawals([amt], state.userAddress);
      const receipt = await tx.wait();
      const ids = getLidoWithdrawalIds();
      ids.push({ hash: tx.hash, amount: amtStr, time: Date.now() });
      saveLidoWithdrawalIds(ids);
      toast(`Withdrawal requested: ${amtStr} stETH`, 'success', c.explorer + tx.hash);
      logHistory('unstake', `Request withdrawal ${amtStr} stETH`, tx.hash);
      hideProgress('lido-withdraw-progress');
      setResult('lido-withdraw-result', '\u2713', 'success');
      document.getElementById('lido-withdraw-amount').value = '';
      loadWithdrawalRequests();
      loadAll();
    } catch (e) {
      hideProgress('lido-withdraw-progress');
      setResult('lido-withdraw-result', e.message?.slice(0, 80), 'error');
      toast(e.message?.slice(0, 60), 'error');
    } finally {
      btnRequestWd.disabled = false;
    }
  });

  // Claim Withdrawal
  document.getElementById('btn-lido-claim')?.addEventListener('click', async () => {
    if (!state.signer || !state.userAddress) return;
    const c = cfg();
    if (!c?.hasLido || !c.lido) return;
    const storedIds = getLidoWithdrawalIds();
    const numericIds = storedIds
      .filter((s) => typeof s === 'number' || (typeof s === 'string' && !isNaN(s)))
      .map(Number);
    if (!numericIds.length) {
      toast('No claimable requests found', 'error');
      return;
    }

    try {
      const queue = new ethers.Contract(c.lido.withdrawalQueue, WITHDRAWAL_QUEUE_ABI, state.signer);
      const lastCheckpoint = await queue.getLastCheckpointIndex();
      const hints = await queue.findCheckpointHints(numericIds, 1, lastCheckpoint);
      showProgress('lido-withdraw-progress', ['Claim'], 0);
      const tx = await queue.claimWithdrawals(numericIds, hints);
      toast('Withdrawal claimed', 'success', c.explorer + tx.hash);
      logHistory('unstake', 'Claimed Lido withdrawal', tx.hash);
      await tx.wait();
      hideProgress('lido-withdraw-progress');
      setResult('lido-withdraw-result', '\u2713 Claimed', 'success');
      const remaining = storedIds.filter(
        (s) => !(typeof s === 'number' || (typeof s === 'string' && !isNaN(s))),
      );
      saveLidoWithdrawalIds(remaining);
      loadWithdrawalRequests();
      loadAll();
    } catch (e) {
      hideProgress('lido-withdraw-progress');
      setResult('lido-withdraw-result', e.message?.slice(0, 80), 'error');
      toast(e.message?.slice(0, 60), 'error');
    }
  });
}
