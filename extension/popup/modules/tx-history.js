(function () {
  'use strict';

  const PopupState = globalThis.WolfPopupSharedState || {
    provider: null, activeAccountIndex: 0, selectedChain: 'ethereum',
    selectedNetwork: 'eth-sepolia', rpcByNetwork: {},
  };
  const WalletCore = (globalThis.WolfWalletCore && typeof globalThis.WolfWalletCore === 'object')
    ? globalThis.WolfWalletCore : {};

  const _Storage = globalThis.WolfPopupStorage;
  const getLocal = _Storage
    ? _Storage.getLocal.bind(_Storage)
    : (keys) => new Promise((r) => chrome.storage.local.get(keys, r));
  const setLocal = _Storage
    ? _Storage.setLocal.bind(_Storage)
    : (data) => new Promise((r) => chrome.storage.local.set(data, r));

  async function _getAccounts() {
    if (typeof globalThis.getAccountsCached === 'function') {
      return globalThis.getAccountsCached();
    }
    const { accounts = [] } = await getLocal(['accounts']);
    return Array.isArray(accounts) ? accounts : [];
  }

  const _Clipboard = globalThis.WolfPopupClipboard;
  const copyText = _Clipboard
    ? _Clipboard.copyText.bind(_Clipboard)
    : async (text) => { await navigator.clipboard.writeText(text); return true; };

  const TX_SYNC_STATE_KEY = 'txSyncState';
  const TX_HISTORY_CACHE_KEY = 'txHistoryCache';
  const TX_HISTORY_LIMIT = 1000;
  const TX_PAGE_SIZE = 10;
  const TX_INITIAL_MAX_COUNT = '0x3e8';
  const TX_INCREMENTAL_MAX_COUNT = '0x64';

  const _txLoadPromises = new Map();
  const _txPaginationState = new Map();
  const _txRenderedState = new Map();

  function _getNetworks() {
    return globalThis.WolfPopupNetworkState?.NETWORKS || {};
  }

  function _formatAmount(value) {
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

  function _shortAddr(addr) {
    if (typeof globalThis.shortAddr === 'function') return globalThis.shortAddr(addr);
    return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
  }

  function _getRpcUrlForNetwork(networkKey, map) {
    const ns = globalThis.WolfPopupNetworkState;
    if (ns) return ns.getRpcUrlForNetwork(networkKey, map);
    return null;
  }

  function getTxScopeKey(address, networkKey) {
    const nk = (networkKey !== undefined) ? networkKey : PopupState.selectedNetwork;
    if (typeof WalletCore.getTxScopeKey === 'function') {
      return WalletCore.getTxScopeKey(address, nk);
    }
    return `${nk}:${String(address).toLowerCase()}`;
  }

  function getTxExplorerBaseUrl(networkKey) {
    const nk = (networkKey !== undefined) ? networkKey : PopupState.selectedNetwork;
    if (typeof WalletCore.getTxExplorerBaseUrl === 'function') {
      return WalletCore.getTxExplorerBaseUrl(nk);
    }
    if (nk === 'eth-mainnet') return 'https://etherscan.io/tx/';
    if (nk === 'eth-sepolia') return 'https://sepolia.etherscan.io/tx/';
    if (nk === 'bsc') return 'https://bscscan.com/tx/';
    return 'https://etherscan.io/tx/';
  }

  function setTxRefreshIndicator(active) {
    const el = document.getElementById('tx-refresh-indicator');
    if (!el) return;
    el.classList.toggle('active', !!active);
  }

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
    info.textContent = `Страница ${currentPage} / ${totalPages} • ${totalTxs} tx`;
    container.dataset.scopeKey = scopeKey;
  }

  function renderTransactions(el, address, txs, networkKey) {
    const nk = (networkKey !== undefined) ? networkKey : PopupState.selectedNetwork;
    el.textContent = '';
    const scopeKey = getTxScopeKey(address, nk);
    const allTxs = Array.isArray(txs) ? txs : [];
    _txRenderedState.set(scopeKey, { address, networkKey: nk, txs: allTxs });

    const totalPages = typeof WalletCore.getTotalPages === 'function'
      ? WalletCore.getTotalPages(allTxs.length, TX_PAGE_SIZE)
      : Math.max(1, Math.ceil(allTxs.length / TX_PAGE_SIZE));
    const requestedPage = _txPaginationState.get(scopeKey) || 1;
    const currentPage = typeof WalletCore.clampPage === 'function'
      ? WalletCore.clampPage(requestedPage, totalPages)
      : Math.min(totalPages, Math.max(1, requestedPage));
    _txPaginationState.set(scopeKey, currentPage);

    updateTxPaginationUI(scopeKey, allTxs.length, currentPage, totalPages);

    if (!allTxs.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Транзакций пока нет';
      el.appendChild(p);
      return;
    }

    const pageTxs = typeof WalletCore.paginateItems === 'function'
      ? WalletCore.paginateItems(allTxs, currentPage, TX_PAGE_SIZE).items
      : allTxs.slice((currentPage - 1) * TX_PAGE_SIZE, currentPage * TX_PAGE_SIZE);

    pageTxs.forEach(tx => {
      const isOut = tx.from?.toLowerCase() === address.toLowerCase();
      const peerLabel = isOut ? 'to' : 'from';
      const peerAddress = isOut ? tx.to : tx.from;
      const safePeer = peerAddress || 'unknown';
      const amount = tx.value != null ? _formatAmount(parseFloat(tx.value)) : '?';
      const asset = tx.asset || 'ETH';
      const txHash = tx.hash || '';

      const txEl = document.createElement('div');
      txEl.className = 'tx';

      const leftEl = document.createElement('div');
      leftEl.className = 'tx-left';

      const dirEl = document.createElement('span');
      dirEl.className = `tx-dir ${isOut ? 'out' : 'in'}`;
      dirEl.textContent = `${isOut ? '↗ out' : '↙ in'}`;

      const peerEl = document.createElement('div');
      peerEl.className = 'tx-peer';
      peerEl.title = `${peerLabel}: ${safePeer}`;
      peerEl.textContent = `${peerLabel}: ${_shortAddr(safePeer)}`;

      const hashRowEl = document.createElement('div');
      hashRowEl.className = 'tx-hash-row';

      const linkEl = document.createElement('a');
      linkEl.className = 'tx-link';
      linkEl.href = `${getTxExplorerBaseUrl(nk)}${encodeURIComponent(txHash)}`;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.title = txHash;
      linkEl.textContent = txHash ? `${txHash.slice(0, 6)}…${txHash.slice(-4)}` : 'hash: n/a';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'tx-copy';
      copyBtn.textContent = 'copy';
      copyBtn.title = 'Скопировать хэш';
      copyBtn.disabled = !txHash;
      copyBtn.addEventListener('click', () => copyTxHash(txHash, copyBtn));

      leftEl.appendChild(dirEl);
      leftEl.appendChild(peerEl);
      hashRowEl.appendChild(linkEl);
      hashRowEl.appendChild(copyBtn);
      leftEl.appendChild(hashRowEl);

      const amountEl = document.createElement('span');
      amountEl.className = `tx-amount ${isOut ? 'out' : 'inc'}`;
      amountEl.textContent = `${isOut ? '−' : '+'}${amount} ${asset}`;

      txEl.appendChild(leftEl);
      txEl.appendChild(amountEl);
      el.appendChild(txEl);
    });
  }

  // Legacy URL check — оставлен для backward compat в экспортах модуля.
  // Внутри loadTransactions используется resolveProvider() из tx-history-providers.js.
  function _isAlchemyUrl(url) {
    const P = globalThis.WolfPopupTxHistoryProviders;
    if (P && typeof P.isAlchemyUrl === 'function') return P.isAlchemyUrl(url);
    try { return new URL(url).hostname.endsWith('.alchemy.com'); }
    catch { return false; }
  }

  // Thin wrapper для обратной совместимости (тесты, внешний код).
  // Делегирует в tx-history-providers.js.
  async function fetchAlchemyTransfers(address, direction, opts = {}) {
    const P = globalThis.WolfPopupTxHistoryProviders;
    if (!P || typeof P.fetchAlchemyTransfers !== 'function') {
      return { result: { transfers: [] } };
    }
    const NETWORKS = _getNetworks();
    const networkKey = NETWORKS[PopupState.selectedNetwork]
      ? PopupState.selectedNetwork
      : Object.keys(NETWORKS)[0];
    const activeUrl = _getRpcUrlForNetwork(networkKey, PopupState.rpcByNetwork || {});
    return P.fetchAlchemyTransfers(activeUrl, address, direction, opts);
  }

  // ── UI helpers для empty-state сообщений ────────────────────────────────
  function _renderInlineMessage(el, msg) {
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

  async function _getEtherscanKey() {
    try {
      const { etherscanApiKey } = await getLocal(['etherscanApiKey']);
      return typeof etherscanApiKey === 'string' ? etherscanApiKey.trim() : '';
    } catch { return ''; }
  }

  async function loadTransactions(address) {
    const scopeKey = getTxScopeKey(address);
    if (_txLoadPromises.has(scopeKey)) {
      return _txLoadPromises.get(scopeKey);
    }

    const run = (async () => {
      const el = document.getElementById('tx-list');
      setTxRefreshIndicator(true);

      // Резолвим источник истории в порядке:
      //   Alchemy (fast) → Etherscan V2 (user key) → Blockscout (public) → null
      const NETWORKS = _getNetworks();
      const nk = NETWORKS[PopupState.selectedNetwork]
        ? PopupState.selectedNetwork
        : Object.keys(NETWORKS)[0];
      const rpcUrl = _getRpcUrlForNetwork(nk, PopupState.rpcByNetwork || {});
      const etherscanKey = await _getEtherscanKey();

      const Providers = globalThis.WolfPopupTxHistoryProviders;
      if (!Providers || typeof Providers.resolveProvider !== 'function') {
        setTxRefreshIndicator(false);
        _renderInlineMessage(el, 'Модуль истории не загружен');
        return;
      }

      const provider = Providers.resolveProvider({
        networkKey: nk,
        rpcUrl,
        etherscanKey,
      });

      if (!provider) {
        setTxRefreshIndicator(false);
        _renderInlineMessage(el, Providers.getNoProviderReason(nk));
        return;
      }

      try {
        const { [TX_SYNC_STATE_KEY]: syncState = {}, [TX_HISTORY_CACHE_KEY]: txCache = {} } =
          await getLocal([TX_SYNC_STATE_KEY, TX_HISTORY_CACHE_KEY]);

        const accountSync = syncState?.[scopeKey] || {};
        const cachedTxs = Array.isArray(txCache?.[scopeKey]) ? txCache[scopeKey] : [];

        // Checkpoint применим только для Alchemy (там есть fromBlock параметр).
        // Blockscout/Etherscan V2 всегда отдают последние N, поэтому checkpoint
        // только для кэша (избежать лишних re-render'ов).
        const hasCheckpoint = Number.isInteger(accountSync.lastProcessedBlock)
          && accountSync.lastProcessedBlock >= 0;
        const fromBlockHex = hasCheckpoint
          ? `0x${(accountSync.lastProcessedBlock + 1).toString(16)}`
          : '0x0';

        if (cachedTxs.length) {
          renderTransactions(el, address, cachedTxs, PopupState.selectedNetwork);
        } else {
          // popup.html содержит initial <p class="empty">Загрузка…</p>.
          // Мы всегда обновляем текст в existing .empty либо создаём новый.
          _renderInlineMessage(el, 'Загрузка…');
          const p = el.querySelector('.empty');
          if (p) p.style.whiteSpace = '';
        }

        // Fetch свежие transfers через выбранный провайдер
        const fetchOpts = provider.type === 'alchemy'
          ? {
            fromBlock: fromBlockHex,
            maxCount: hasCheckpoint ? TX_INCREMENTAL_MAX_COUNT : TX_INITIAL_MAX_COUNT,
          }
          : { offset: 200 }; // Blockscout/Etherscan всегда последние 200

        let fresh = await provider.fetchAll(address, fetchOpts);

        // Для Alchemy: если checkpoint вернул 0 результатов — retry с fromBlock=0x0
        // (на случай если SW убил стейт и мы потеряли cache но checkpoint сохранился).
        if (provider.type === 'alchemy' && hasCheckpoint && !cachedTxs.length && fresh.length === 0) {
          fresh = await provider.fetchAll(address, { fromBlock: '0x0', maxCount: TX_INITIAL_MAX_COUNT });
        }

        // Dedupe fresh (Alchemy делает 2 запроса, может быть дубль)
        const freshSeen = new Set();
        fresh = fresh
          .filter(tx => {
            if (!tx || !tx.hash) return false;
            if (freshSeen.has(tx.hash)) return false;
            freshSeen.add(tx.hash);
            return true;
          })
          .sort((a, b) => (parseInt(b.blockNum, 16) || 0) - (parseInt(a.blockNum, 16) || 0));

        // Merge с кэшем
        const mergedSeen = new Set();
        const baseForMerge = (provider.type === 'alchemy' && hasCheckpoint && fresh.length === 0 && cachedTxs.length > 0)
          ? cachedTxs
          : [...fresh, ...cachedTxs];
        const merged = baseForMerge
          .filter(tx => {
            if (mergedSeen.has(tx.hash)) return false;
            mergedSeen.add(tx.hash);
            return true;
          })
          .sort((a, b) => (parseInt(b.blockNum, 16) || 0) - (parseInt(a.blockNum, 16) || 0))
          .slice(0, TX_HISTORY_LIMIT);

        renderTransactions(el, address, merged, PopupState.selectedNetwork);

        const maxMergedBlock = merged.reduce(
          (acc, tx) => Math.max(acc, parseInt(tx.blockNum, 16) || -1),
          -1
        );
        const nextCheckpoint = Math.max(
          hasCheckpoint ? accountSync.lastProcessedBlock : -1,
          maxMergedBlock,
        );

        const nextSyncState = { ...syncState };
        nextSyncState[scopeKey] = {
          lastProcessedBlock: nextCheckpoint,
          updatedAt: new Date().toISOString(),
          provider: provider.type,
        };

        const nextCache = { ...txCache };
        nextCache[scopeKey] = merged;

        await setLocal({
          [TX_SYNC_STATE_KEY]: nextSyncState,
          [TX_HISTORY_CACHE_KEY]: nextCache,
        });

      } catch (e) {
        console.error('[loadTransactions]', e);
        const hasRenderedTx = el.querySelector('.tx');
        if (!hasRenderedTx) {
          _renderInlineMessage(el, `Не удалось загрузить транзакции (${provider.label})`);
        }
      } finally {
        setTxRefreshIndicator(false);
      }
    })();

    _txLoadPromises.set(scopeKey, run);
    try {
      await run;
    } finally {
      _txLoadPromises.delete(scopeKey);
    }
  }

  async function changeTxPage(delta) {
    if (!delta) return;

    const accounts = await _getAccounts();
    const address = accounts[PopupState.activeAccountIndex]?.address;
    if (!address) return;

    const scopeKey = getTxScopeKey(address);
    const rendered = _txRenderedState.get(scopeKey);
    if (!rendered || !Array.isArray(rendered.txs) || rendered.txs.length === 0) return;

    const totalPages = Math.max(1, Math.ceil(rendered.txs.length / TX_PAGE_SIZE));
    const currentPage = _txPaginationState.get(scopeKey) || 1;
    const nextPage = Math.min(totalPages, Math.max(1, currentPage + delta));
    if (nextPage === currentPage) return;

    _txPaginationState.set(scopeKey, nextPage);
    const el = document.getElementById('tx-list');
    if (!el) return;
    renderTransactions(el, rendered.address, rendered.txs, rendered.networkKey);
  }

  async function copyTxHash(hash, buttonEl) {
    if (!hash) return;
    const prevText = buttonEl?.textContent || 'copy';
    await copyText(hash);
    if (!buttonEl) return;
    buttonEl.textContent = 'copied';
    setTimeout(() => { buttonEl.textContent = prevText; }, 1000);
  }

  globalThis.WolfPopupTxHistory = {
    TX_PAGE_SIZE,
    getTxScopeKey, getTxExplorerBaseUrl, loadTransactions, renderTransactions,
    updateTxPaginationUI, changeTxPage, fetchAlchemyTransfers, setTxRefreshIndicator, copyTxHash,
  };
})();
