// ══════════════════════════════════════════════════════════════════════
// events.js — Provider event binding, connect/disconnect handlers
// ══════════════════════════════════════════════════════════════════════
import { state, cfg } from './state.js';
import { detectProvider } from './wallet.js';
import {
  setConnected,
  showAccountUI,
  clearUI,
  updateFeatureVisibility,
  syncNetPicker,
  logHistory,
} from './ui.js';
import { loadAll } from './balance.js';

export function attachEvents() {
  const p = detectProvider();
  if (!p?.on || (state.boundListeners && state.boundListeners.p === p)) return;
  if (state.boundListeners) detachEvents();
  const oc = (i) => {
    if (i?.chainId) updateChain(i.chainId);
  };
  const od = () => {
    state.userAddress = null;
    setConnected(false);
    clearUI();
  };
  const oa = (a) => {
    if (a?.length) onConnected(a);
    else od();
  };
  const occ = async (h) => {
    updateChain(h);
    if (state.userAddress && detectProvider()) {
      state.ethProvider = new window.ethers.BrowserProvider(detectProvider());
      state.signer = await state.ethProvider.getSigner(state.userAddress);
      loadAll();
    }
  };
  p.on('connect', oc);
  p.on('disconnect', od);
  p.on('accountsChanged', oa);
  p.on('chainChanged', occ);
  state.boundListeners = { p, oc, od, oa, occ };
}

export function detachEvents() {
  if (!state.boundListeners) return;
  const { p, oc, od, oa, occ } = state.boundListeners;
  try {
    p.off('connect', oc);
    p.off('disconnect', od);
    p.off('accountsChanged', oa);
    p.off('chainChanged', occ);
  } catch {
    /* skip */
  }
  state.boundListeners = null;
}

export async function onConnected(accs) {
  state.userAddress = accs[0];
  const p = detectProvider();
  state.ethProvider = new window.ethers.BrowserProvider(p);
  state.signer = await state.ethProvider.getSigner(state.userAddress);
  const hex = await p.request({ method: 'eth_chainId' });
  updateChain(hex);
  setConnected(true);
  showAccountUI();
  loadAll();
}

export function updateChain(hex) {
  state.chainId = parseInt(hex, 16);
  syncNetPicker();
  updateFeatureVisibility();
}

export function setupConnectHandlers() {
  // Connect
  document.getElementById('btn-connect').addEventListener('click', async () => {
    const p = detectProvider();
    if (!p) return;
    try {
      const a = await p.request({ method: 'eth_requestAccounts' });
      if (a?.length) await onConnected(a);
    } catch (e) {
      logHistory('error', e.message);
    }
  });

  // Disconnect
  document.getElementById('btn-disconnect').addEventListener('click', async () => {
    const p = detectProvider();
    if (!p) return;
    detachEvents();
    state.userAddress = null;
    state.ethProvider = null;
    state.signer = null;
    setConnected(false);
    clearUI();
    try {
      await p.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
    } catch {
      /* skip */
    }
    attachEvents();
  });

  // Switch account
  document.getElementById('account-badge').addEventListener('click', async () => {
    const p = detectProvider();
    if (!p) return;
    detachEvents();
    state.userAddress = null;
    state.ethProvider = null;
    state.signer = null;
    setConnected(false);
    clearUI();
    try {
      await p.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
    } catch {
      /* skip */
    }
    try {
      const a = await p.request({ method: 'eth_requestAccounts' });
      attachEvents();
      if (a?.length) await onConnected(a);
    } catch (e) {
      attachEvents();
      logHistory('error', `Switch: ${e.message}`);
    }
  });

  // Network picker toggle
  (
    document.getElementById('net-picker-trigger') || document.getElementById('net-trigger')
  ).addEventListener('click', () => {
    document.getElementById('net-picker').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#net-picker'))
      document.getElementById('net-picker').classList.remove('open');
  });

  // Network picker selection
  (
    document.getElementById('net-picker-menu') || document.getElementById('net-menu')
  ).addEventListener('click', async (e) => {
    const opt = e.target.closest('.net-picker-opt, .net-opt');
    if (!opt) return;
    const targetHex = opt.dataset.chain;
    document.getElementById('net-picker').classList.remove('open');
    if (targetHex === '0x' + (state.chainId || 0).toString(16)) return;
    const p = detectProvider();
    if (!p) return;
    try {
      await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetHex }] });
      // Верифицируем что сеть реально переключилась, не доверяя визуалу
      const actualChainHex = await p.request({ method: 'eth_chainId' });
      updateChain(actualChainHex);
      if (state.userAddress) {
        state.ethProvider = new window.ethers.BrowserProvider(p);
        state.signer = await state.ethProvider.getSigner(state.userAddress);
        loadAll();
      }
    } catch (err) {
      // Revert visual к реальной сети
      if (state.userAddress) {
        try {
          const realChain = await p.request({ method: 'eth_chainId' });
          updateChain(realChain);
        } catch {
          /* skip */
        }
      }
      syncNetPicker();
      logHistory('error', `Network: ${err.message}`);
    }
  });
}
