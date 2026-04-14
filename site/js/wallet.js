// ══════════════════════════════════════════════════════════════════════
// wallet.js — EIP-6963 wallet detection + picker
// ══════════════════════════════════════════════════════════════════════
import { state } from './state.js';
import { attachEvents, detachEvents, onConnected } from './events.js';

export function detectProvider() {
  return state.selectedProvider;
}

export function renderPicker() {
  const el = document.getElementById('wallet-list');
  el.innerHTML = '';
  for (const [key, entry] of state.detectedWallets) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wallet-item' + (key === state.selectedWalletKey ? ' selected' : '');
    if (entry.info.icon) {
      const i = document.createElement('img');
      i.src = entry.info.icon;
      b.appendChild(i);
    }
    const n = document.createElement('span');
    n.textContent = entry.info.name;
    b.appendChild(n);
    b.addEventListener('click', () => selectWallet(key));
    el.appendChild(b);
  }
}

export function selectWallet(key) {
  const entry = state.detectedWallets.get(key);
  if (!entry) return;
  if (state.selectedProvider && state.selectedProvider !== entry.provider) detachEvents();
  state.selectedProvider = entry.provider;
  state.selectedWalletKey = key;
  localStorage.setItem('sova-bank-wallet', key);
  attachEvents();
  renderPicker();
  restoreSession();
}

export async function restoreSession() {
  const p = detectProvider();
  if (!p) return;
  try {
    const a = await p.request({ method: 'eth_accounts' });
    if (a?.length) await onConnected(a);
  } catch {
    /* skip */
  }
}

export function initWalletDetection() {
  window.addEventListener('eip6963:announceProvider', (e) => {
    const d = e.detail;
    if (!d?.provider || !d?.info) return;
    const key = d.info.uuid || d.info.rdns || d.info.name;
    if (!key || state.detectedWallets.has(key)) return;
    state.detectedWallets.set(key, { info: d.info, provider: d.provider });
    renderPicker();
    const saved = localStorage.getItem('sova-bank-wallet');
    if (saved === key && !state.selectedProvider) selectWallet(key);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  setTimeout(() => {
    if (window.ethereum && !state.detectedWallets.size) {
      state.detectedWallets.set('legacy', {
        info: {
          uuid: 'legacy',
          name: window.ethereum.isMetaMask ? 'MetaMask' : 'Wallet',
          icon: '',
        },
        provider: window.ethereum,
      });
      renderPicker();
    }
  }, 400);
}
