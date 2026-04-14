'use strict';

// ── SOVA Wallet — Transaction rendering ────────────────────────────────
// DOM rendering for transaction list, pagination controls, empty state,
// and display-formatting helpers.

// ── PopupState / WalletCore references ─────────────────────────────────
function _getPopupState() {
  return (
    globalThis.WolfPopupSharedState || {
      provider: null,
      activeAccountIndex: 0,
      selectedChain: 'ethereum',
      selectedNetwork: 'eth-sepolia',
      rpcByNetwork: {},
    }
  );
}

function _getWalletCore() {
  return globalThis.WolfWalletCore && typeof globalThis.WolfWalletCore === 'object'
    ? globalThis.WolfWalletCore
    : {};
}

function _getCache() {
  return globalThis.WolfPopupTxCache || {};
}

// ── Clipboard helper ───────────────────────────────────────────────────
const _Clipboard = globalThis.WolfPopupClipboard;
const copyText = _Clipboard
  ? _Clipboard.copyText.bind(_Clipboard)
  : async (text) => {
      await navigator.clipboard.writeText(text);
      return true;
    };

// ── Display formatting helpers ─────────────────────────────────────────

function formatTxAmount(value) {
  if (typeof globalThis.formatAmount === 'function') return globalThis.formatAmount(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  let s;
  if (abs >= 1000) s = value.toFixed(2);
  else if (abs >= 1) s = value.toFixed(4);
  else if (abs >= 0.000001) s = value.toFixed(6);
  else return '< 0.000001';
  return s.replace(/\.?0+$/, '');
}

function shortAddr(addr) {
  if (typeof globalThis.shortAddr === 'function') return globalThis.shortAddr(addr);
  return addr ? `${addr.slice(0, 6)}\u2026${addr.slice(-4)}` : '';
}

/**
 * Return the block-explorer base URL for transaction links.
 * @param {string} [networkKey]
 * @returns {string}
 */
function getTxExplorerBaseUrl(networkKey) {
  const PopupState = _getPopupState();
  const nk = networkKey !== undefined ? networkKey : PopupState.selectedNetwork;
  const WalletCore = _getWalletCore();
  if (typeof WalletCore.getTxExplorerBaseUrl === 'function') {
    return WalletCore.getTxExplorerBaseUrl(nk);
  }
  if (nk === 'eth-mainnet') return 'https://etherscan.io/tx/';
  if (nk === 'eth-sepolia') return 'https://sepolia.etherscan.io/tx/';
  if (nk === 'bsc') return 'https://bscscan.com/tx/';
  return 'https://etherscan.io/tx/';
}

// ── Spinner indicator ──────────────────────────────────────────────────

/**
 * Show or hide the transaction-refresh spinner indicator.
 * @param {boolean} active
 */
function setTxRefreshIndicator(active) {
  const el = document.getElementById('tx-refresh-indicator');
  if (!el) return;
  el.classList.toggle('active', !!active);
}

// ── Pagination UI ──────────────────────────────────────────────────────

/**
 * Update the prev/next pagination controls and page info text.
 * @param {string} scopeKey
 * @param {number} totalTxs
 * @param {number} currentPage
 * @param {number} totalPages
 */
function updateTxPaginationUI(scopeKey, totalTxs, currentPage, totalPages) {
  const container = document.getElementById('tx-pagination');
  const prevBtn = document.getElementById('tx-page-prev');
  const nextBtn = document.getElementById('tx-page-next');
  const info = document.getElementById('tx-page-info');
  if (!container || !prevBtn || !nextBtn || !info) return;

  if (!totalTxs) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
  info.textContent = `\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 ${currentPage} / ${totalPages} \u2022 ${totalTxs} tx`;
  container.dataset.scopeKey = scopeKey;
}

// ── Empty state / inline messages ──────────────────────────────────────

function renderInlineMessage(el, msg) {
  const existing = el.querySelector('.empty');
  if (existing) {
    existing.textContent = msg;
    existing.style.whiteSpace = 'pre-line';
  } else {
    el.textContent = '';
    const p = document.createElement('p');
    p.className = 'empty';
    p.style.whiteSpace = 'pre-line';
    p.textContent = msg;
    el.appendChild(p);
  }
}

function renderEmptyState(el) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent =
    '\u0422\u0440\u0430\u043d\u0437\u0430\u043a\u0446\u0438\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442';
  el.appendChild(p);
}

// ── Copy tx hash ───────────────────────────────────────────────────────

/**
 * Copy a transaction hash to the clipboard and briefly change the
 * button text to "copied".
 * @param {string} hash
 * @param {HTMLElement} [buttonEl]
 * @returns {Promise<void>}
 */
async function copyTxHash(hash, buttonEl) {
  if (!hash) return;
  const prevText = buttonEl?.textContent || 'copy';
  await copyText(hash);
  if (!buttonEl) return;
  buttonEl.textContent = 'copied';
  setTimeout(() => {
    buttonEl.textContent = prevText;
  }, 1000);
}

// ── Single transaction row ─────────────────────────────────────────────

/**
 * Create a DOM element for a single transaction row.
 * @param {object} tx
 * @param {string} address — wallet address (used for in/out detection)
 * @param {string} networkKey
 * @returns {HTMLElement}
 */
function renderTransactionRow(tx, address, networkKey) {
  const isOut = tx.from?.toLowerCase() === address.toLowerCase();
  const peerLabel = isOut ? 'to' : 'from';
  const peerAddress = isOut ? tx.to : tx.from;
  const safePeer = peerAddress || 'unknown';
  const amount = tx.value != null ? formatTxAmount(parseFloat(tx.value)) : '?';
  const asset = tx.asset || 'ETH';
  const txHash = tx.hash || '';

  const txEl = document.createElement('div');
  txEl.className = 'tx';

  const leftEl = document.createElement('div');
  leftEl.className = 'tx-left';

  const dirEl = document.createElement('span');
  dirEl.className = `tx-dir ${isOut ? 'out' : 'in'}`;
  dirEl.textContent = `${isOut ? '\u2197 out' : '\u2199 in'}`;

  const peerEl = document.createElement('div');
  peerEl.className = 'tx-peer';
  peerEl.title = `${peerLabel}: ${safePeer}`;
  peerEl.textContent = `${peerLabel}: ${shortAddr(safePeer)}`;

  const hashRowEl = document.createElement('div');
  hashRowEl.className = 'tx-hash-row';

  const linkEl = document.createElement('a');
  linkEl.className = 'tx-link';
  linkEl.href = `${getTxExplorerBaseUrl(networkKey)}${encodeURIComponent(txHash)}`;
  linkEl.target = '_blank';
  linkEl.rel = 'noopener noreferrer';
  linkEl.title = txHash;
  linkEl.textContent = txHash ? `${txHash.slice(0, 6)}\u2026${txHash.slice(-4)}` : 'hash: n/a';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'tx-copy';
  copyBtn.textContent = 'copy';
  copyBtn.title =
    '\u0421\u043a\u043e\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0445\u044d\u0448';
  copyBtn.disabled = !txHash;
  copyBtn.addEventListener('click', () => copyTxHash(txHash, copyBtn));

  leftEl.appendChild(dirEl);
  leftEl.appendChild(peerEl);
  hashRowEl.appendChild(linkEl);
  hashRowEl.appendChild(copyBtn);
  leftEl.appendChild(hashRowEl);

  const amountEl = document.createElement('span');
  amountEl.className = `tx-amount ${isOut ? 'out' : 'inc'}`;
  amountEl.textContent = `${isOut ? '\u2212' : '+'}${amount} ${asset}`;

  txEl.appendChild(leftEl);
  txEl.appendChild(amountEl);
  return txEl;
}

// ── Full transaction list ──────────────────────────────────────────────

/**
 * Render a list of transactions into the given DOM container with
 * pagination support.
 * @param {HTMLElement} el — target container element
 * @param {string} address — wallet address (used for in/out detection)
 * @param {Array<object>} txs — full transaction list (all pages)
 * @param {string} [networkKey]
 */
function renderTransactionList(el, address, txs, networkKey) {
  const PopupState = _getPopupState();
  const WalletCore = _getWalletCore();
  const Cache = _getCache();
  const TX_PAGE_SIZE = Cache.TX_PAGE_SIZE || 10;

  const nk = networkKey !== undefined ? networkKey : PopupState.selectedNetwork;
  el.textContent = '';

  const getTxScopeKey =
    Cache.getTxScopeKey || ((addr, net) => `${net}:${String(addr).toLowerCase()}`);
  const scopeKey = getTxScopeKey(address, nk);
  const allTxs = Array.isArray(txs) ? txs : [];

  if (typeof Cache.setRenderedState === 'function') {
    Cache.setRenderedState(scopeKey, { address, networkKey: nk, txs: allTxs });
  }

  const totalPages =
    typeof WalletCore.getTotalPages === 'function'
      ? WalletCore.getTotalPages(allTxs.length, TX_PAGE_SIZE)
      : Math.max(1, Math.ceil(allTxs.length / TX_PAGE_SIZE));

  const requestedPage = typeof Cache.getPageState === 'function' ? Cache.getPageState(scopeKey) : 1;
  const currentPage =
    typeof WalletCore.clampPage === 'function'
      ? WalletCore.clampPage(requestedPage, totalPages)
      : Math.min(totalPages, Math.max(1, requestedPage));

  if (typeof Cache.setPageState === 'function') {
    Cache.setPageState(scopeKey, currentPage);
  }

  updateTxPaginationUI(scopeKey, allTxs.length, currentPage, totalPages);

  if (!allTxs.length) {
    renderEmptyState(el);
    return;
  }

  const pageTxs =
    typeof WalletCore.paginateItems === 'function'
      ? WalletCore.paginateItems(allTxs, currentPage, TX_PAGE_SIZE).items
      : allTxs.slice((currentPage - 1) * TX_PAGE_SIZE, currentPage * TX_PAGE_SIZE);

  pageTxs.forEach((tx) => {
    el.appendChild(renderTransactionRow(tx, address, nk));
  });
}

// ── Export ──────────────────────────────────────────────────────────────

export const WolfPopupTxRender = {
  formatTxAmount,
  shortAddr,
  getTxExplorerBaseUrl,
  setTxRefreshIndicator,
  updateTxPaginationUI,
  renderInlineMessage,
  renderEmptyState,
  renderTransactionRow,
  renderTransactionList,
  copyTxHash,
};
globalThis.WolfPopupTxRender = WolfPopupTxRender;
