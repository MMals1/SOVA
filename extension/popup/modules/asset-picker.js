'use strict';

import { WolfPopupSharedState } from './popup-state.js';
import { WolfPopupNetworkState } from './network-state.js';
import { WolfPopupTokenState } from './token-state.js';

const PopupState = globalThis.WolfPopupSharedState || {
  provider: null,
  activeAccountIndex: 0,
  selectedChain: 'ethereum',
  selectedNetwork: 'eth-sepolia',
  rpcByNetwork: {},
};

function _getNativeAssetSymbol() {
  const ns = globalThis.WolfPopupNetworkState;
  if (ns) return ns.getNativeAssetSymbol();
  return PopupState.selectedNetwork === 'bsc' ? 'BNB' : 'ETH';
}

async function _getTokensForSelectedNetwork() {
  const ts = globalThis.WolfPopupTokenState;
  return ts ? ts.getTokensForSelectedNetwork() : [];
}

// ── Asset picker helpers ──────────────────────────────────────────
let _assetOptions = []; // [{value, label, type}]

function buildAssetPicker(options) {
  _assetOptions = options;
  const hidden = document.getElementById('send-asset');
  const label = document.getElementById('send-asset-label');
  const menu = document.getElementById('send-asset-menu');
  const picker = document.getElementById('send-asset-picker');
  menu.textContent = '';

  options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'asset-option' + (i === 0 ? ' active' : '');
    btn.dataset.value = opt.value;
    btn.dataset.index = i;
    const check = document.createElement('span');
    check.className = 'asset-option-check';
    check.textContent = i === 0 ? '✓' : '';
    const lbl = document.createElement('span');
    lbl.textContent = opt.label;
    const typ = document.createElement('span');
    typ.className = 'asset-option-type';
    typ.textContent = opt.type;
    btn.append(check, lbl, typ);
    btn.addEventListener('click', () => selectAsset(i));
    menu.appendChild(btn);
  });

  if (options.length) {
    hidden.value = options[0].value;
    label.textContent = options[0].label;
  }

  // Toggle open/close
  const trigger = document.getElementById('send-asset-trigger');
  const newTrigger = trigger.cloneNode(true);
  trigger.parentNode.replaceChild(newTrigger, trigger);
  newTrigger.addEventListener('click', () => picker.classList.toggle('open'));

  // Close on outside click
  document.addEventListener('click', _closeAssetPickerOutside);
}

function _closeAssetPickerOutside(e) {
  const picker = document.getElementById('send-asset-picker');
  if (picker && !picker.contains(e.target)) {
    picker.classList.remove('open');
  }
}

function selectAsset(index) {
  const opt = _assetOptions[index];
  if (!opt) return;
  const hidden = document.getElementById('send-asset');
  const label = document.getElementById('send-asset-label');
  const menu = document.getElementById('send-asset-menu');
  const picker = document.getElementById('send-asset-picker');

  hidden.value = opt.value;
  hidden.selectedIndex = index;
  label.textContent = opt.label;

  menu.querySelectorAll('.asset-option').forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
    btn.querySelector('.asset-option-check').textContent = i === index ? '✓' : '';
  });
  picker.classList.remove('open');
}

/**
 * Build the asset picker options list from the native asset
 * and all ERC-20 tokens for the currently selected network.
 * @returns {Promise<Array<{value: string, label: string, type: string}>>}
 */
async function buildOptionsForNetwork() {
  const tokens = await _getTokensForSelectedNetwork();
  const nativeSymbol = _getNativeAssetSymbol();

  const options = [{ value: 'ETH', label: `${nativeSymbol} (Native)`, type: 'Native' }];
  tokens.forEach((t) => {
    options.push({ value: t.address, label: `${t.symbol} (ERC-20)`, type: 'ERC-20' });
  });

  return options;
}

/**
 * Reset asset selection to the first option (native asset).
 */
function resetToFirst() {
  if (_assetOptions.length) selectAsset(0);
}

/**
 * Get the current list of asset options.
 * @returns {Array<{value: string, label: string, type: string}>}
 */
function getAssetOptions() {
  return _assetOptions;
}

export const WolfPopupAssetPicker = {
  buildAssetPicker,
  selectAsset,
  buildOptionsForNetwork,
  resetToFirst,
  getAssetOptions,
};
globalThis.WolfPopupAssetPicker = WolfPopupAssetPicker;
