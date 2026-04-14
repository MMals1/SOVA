'use strict';

// ── popup-utils.js — Pure utility functions used by popup wiring ────────
// Delegates to WalletCore when available, provides fallback implementations.

const WalletCore = globalThis.WolfWalletCore || {};

export function formatAmount(value) {
  if (typeof WalletCore.formatAmount === 'function') return WalletCore.formatAmount(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  let s;
  if (abs >= 1000) s = value.toFixed(2);
  else if (abs >= 1) s = value.toFixed(4);
  else if (abs >= 0.000001) s = value.toFixed(6);
  else return '< 0.000001';
  return s.replace(/\.?0+$/, '');
}

export function shortAddr(addr) {
  if (typeof WalletCore.shortAddr === 'function') return WalletCore.shortAddr(addr);
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

export function getTxScopeKey(address, networkKey = 'eth-sepolia') {
  return typeof WalletCore.getTxScopeKey === 'function'
    ? WalletCore.getTxScopeKey(address, networkKey)
    : `${networkKey}:${String(address).toLowerCase()}`;
}

export function getTxExplorerBaseUrl(networkKey = 'eth-sepolia') {
  return typeof WalletCore.getTxExplorerBaseUrl === 'function'
    ? WalletCore.getTxExplorerBaseUrl(networkKey)
    : networkKey === 'eth-sepolia'
      ? 'https://sepolia.etherscan.io/tx/'
      : networkKey === 'bsc'
        ? 'https://bscscan.com/tx/'
        : 'https://etherscan.io/tx/';
}

export function getTokenLogoUrls(tokenAddress, networkKey = 'eth-sepolia') {
  if (!tokenAddress) return [];
  if (!String(networkKey).startsWith('eth-') && networkKey !== 'bsc') return [];
  try {
    const checksum = ethers.getAddress(tokenAddress);
    if (typeof WalletCore.getTokenLogoUrls === 'function')
      return WalletCore.getTokenLogoUrls(checksum, networkKey);
    const lower = checksum.toLowerCase();
    const chain = networkKey === 'bsc' ? 'smartchain' : 'ethereum';
    return [
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${checksum}/logo.png`,
      `https://tokens.1inch.io/${lower}.png`,
    ];
  } catch {
    return [];
  }
}

// ── Provider cache ──────────────────────────────────────────────────────
const _providerCache = new Map();

export function getOrCreatePopupProvider(rpcUrl) {
  const key = String(rpcUrl || '').trim();
  if (!key) return new ethers.JsonRpcProvider(rpcUrl);
  const cached = _providerCache.get(key);
  if (cached) return cached;
  if (_providerCache.size >= 6) {
    _providerCache.delete(_providerCache.keys().next().value);
  }
  const created = new ethers.JsonRpcProvider(key);
  _providerCache.set(key, created);
  return created;
}

// ── Public API ──────────────────────────────────────────────────────────
export const WolfPopupUtils = {
  formatAmount,
  shortAddr,
  getTxScopeKey,
  getTxExplorerBaseUrl,
  getTokenLogoUrls,
  getOrCreatePopupProvider,
};

globalThis.WolfPopupUtils = WolfPopupUtils;
globalThis.getOrCreatePopupProvider = getOrCreatePopupProvider;
globalThis.formatAmount = formatAmount;
globalThis.shortAddr = shortAddr;
globalThis.getTxScopeKey = getTxScopeKey;
globalThis.getTxExplorerBaseUrl = getTxExplorerBaseUrl;
globalThis.getTokenLogoUrls = getTokenLogoUrls;
