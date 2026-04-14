'use strict';

// ── SOVA Wallet: Multi-provider tx-history ────────────────────────────────
//
// Резолвер источников истории транзакций. Приоритет:
//
//   1. Alchemy (fast path)        — если user-provided RPC ведёт на alchemy.com
//                                    `alchemy_getAssetTransfers` возвращает
//                                    all categories в одном запросе.
//
//   2. Blockscout (public, no key) — для eth-mainnet и eth-sepolia.
//                                    Etherscan-compatible API, два запроса:
//                                    txlist (native) + tokentx (ERC-20).
//                                    Rate limit ≈ по IP, но достаточный для
//                                    одного пользователя.
//
//   3. Etherscan V2 (unified key) — если пользователь ввёл Etherscan API ключ.
//                                    Работает для всех сетей, включая BSC,
//                                    через `?chainid={n}` параметр. Это
//                                    единственный способ получить историю
//                                    на BSC без коммерческого провайдера.
//
//   4. null (BSC без ключа)       — показываем UI «добавьте Etherscan API key»
//
// Все провайдеры нормализуются в единый формат `Transfer`:
//   {
//     hash:     '0x…',
//     from:     '0x…',
//     to:       '0x…',
//     value:    '1.234',     // human-readable decimal string
//     asset:    'ETH',       // native symbol or ERC-20 symbol
//     blockNum: '0xabcd',    // hex, для sort + sync checkpoint
//     category: 'external' | 'erc20',
//     metadata: { blockTimestamp: 'ISO 8601' } | null,
//   }

const BLOCKSCOUT_ENDPOINTS = Object.freeze({
  'eth-mainnet': 'https://eth.blockscout.com/api',
  'eth-sepolia': 'https://eth-sepolia.blockscout.com/api',
  // BSC: публичного Blockscout инстанса нет — используем Etherscan V2
});

// Etherscan V2: один URL, сети различаются параметром chainid
const ETHERSCAN_V2_ENDPOINT = 'https://api.etherscan.io/v2/api';
const ETHERSCAN_V2_CHAIN_IDS = Object.freeze({
  'eth-mainnet': 1,
  'eth-sepolia': 11155111,
  bsc: 56,
});

const NATIVE_ASSET_BY_NETWORK = Object.freeze({
  'eth-mainnet': 'ETH',
  'eth-sepolia': 'ETH',
  bsc: 'BNB',
});

// Moralis: один ключ для всех сетей. Дефолтный ключ встроен в network-config.js.
const MORALIS_API_BASE = 'https://deep-index.moralis.io/api/v2.2';
const MORALIS_CHAIN_IDS = Object.freeze({
  'eth-mainnet': '0x1',
  'eth-sepolia': '0xaa36a7',
  bsc: '0x38',
});

// Blockscout / Etherscan pagination (мы грузим максимум N → кешируем → paginate локально)
const REST_DEFAULT_OFFSET = 200;

// ── URL helpers ──────────────────────────────────────────────────────────

function isAlchemyUrl(url) {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith('.alchemy.com');
  } catch {
    return false;
  }
}

function isBlockscoutSupported(networkKey) {
  return Boolean(BLOCKSCOUT_ENDPOINTS[networkKey]);
}

function getNativeAssetForNetwork(networkKey) {
  return NATIVE_ASSET_BY_NETWORK[networkKey] || 'ETH';
}

// ── Normalization ────────────────────────────────────────────────────────

// Безопасное преобразование hex/decimal block number в hex-строку
function _toHexBlockNum(value) {
  if (value == null) return '0x0';
  const str = String(value);
  if (str.startsWith('0x') || str.startsWith('0X')) return str.toLowerCase();
  try {
    return '0x' + BigInt(str).toString(16);
  } catch {
    return '0x0';
  }
}

function _weiToEtherString(weiString) {
  try {
    if (typeof ethers === 'undefined' || !ethers.formatEther) return '0';
    return ethers.formatEther(String(weiString || '0'));
  } catch {
    return '0';
  }
}

function _rawToHumanString(rawString, decimals) {
  try {
    if (typeof ethers === 'undefined' || !ethers.formatUnits) return '0';
    const d = Number.isFinite(Number(decimals)) ? Number(decimals) : 18;
    return ethers.formatUnits(String(rawString || '0'), d);
  } catch {
    return '0';
  }
}

function _isoTimestampFromSeconds(secondsString) {
  const n = Number(secondsString);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return { blockTimestamp: new Date(n * 1000).toISOString() };
  } catch {
    return null;
  }
}

// Alchemy `alchemy_getAssetTransfers` already returns value as number (human-readable)
// and a hex blockNum — мы только чистим nullable поля.
function normalizeAlchemyTransfer(raw) {
  if (!raw || !raw.hash) return null;
  return {
    hash: raw.hash,
    from: raw.from || '',
    to: raw.to || '',
    value: raw.value != null ? String(raw.value) : '0',
    asset: raw.asset || 'ETH',
    blockNum: _toHexBlockNum(raw.blockNum),
    category: raw.category === 'erc20' ? 'erc20' : 'external',
    metadata:
      raw.metadata && raw.metadata.blockTimestamp
        ? { blockTimestamp: raw.metadata.blockTimestamp }
        : null,
  };
}

// Blockscout / Etherscan V2 txlist (native transfers)
// Failed tx (isError === '1') → value = 0 чтобы не вводить пользователя в заблуждение
function normalizeNativeTxlistRow(raw, nativeSymbol) {
  if (!raw || !raw.hash) return null;
  const failed = raw.isError === '1' || raw.txreceipt_status === '0';
  return {
    hash: raw.hash,
    from: raw.from || '',
    to: raw.to || '',
    value: failed ? '0' : _weiToEtherString(raw.value),
    asset: nativeSymbol,
    blockNum: _toHexBlockNum(raw.blockNumber),
    category: 'external',
    metadata: _isoTimestampFromSeconds(raw.timeStamp),
  };
}

// Blockscout / Etherscan V2 tokentx (ERC-20 transfers)
function normalizeTokenTxlistRow(raw) {
  if (!raw || !raw.hash) return null;
  const decimals = parseInt(raw.tokenDecimal || '18', 10);
  return {
    hash: raw.hash,
    from: raw.from || '',
    to: raw.to || '',
    value: _rawToHumanString(raw.value, decimals),
    asset: raw.tokenSymbol || 'TOKEN',
    blockNum: _toHexBlockNum(raw.blockNumber),
    category: 'erc20',
    metadata: _isoTimestampFromSeconds(raw.timeStamp),
  };
}

// ── Fetch helpers ────────────────────────────────────────────────────────

async function _fetchJsonWithRetry(url, init) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastErr || new Error('fetch failed');
}

// Etherscan-compatible API (Blockscout и Etherscan V2 используют одинаковый формат).
// Возвращает массив raw rows или выбрасывает. status '0' + message 'No transactions found' → [].
async function _fetchEtherscanLike(url) {
  const json = await _fetchJsonWithRetry(url, { method: 'GET' });
  // status: '1' → OK, '0' → empty or error
  if (json.status === '0') {
    const msg = String(json.message || '').toLowerCase();
    if (msg.includes('no transactions') || msg.includes('no records')) return [];
    // Rate limit / invalid key → throw для fallback (если будет реализован)
    if (msg.includes('rate limit') || msg.includes('invalid api key')) {
      throw new Error(`Etherscan-like API error: ${json.message}`);
    }
    return [];
  }
  return Array.isArray(json.result) ? json.result : [];
}

// ── Alchemy provider ─────────────────────────────────────────────────────

async function fetchAlchemyTransfers(rpcUrl, address, direction, opts = {}) {
  if (!isAlchemyUrl(rpcUrl)) {
    return { result: { transfers: [] } };
  }
  const body = {
    id: 1,
    jsonrpc: '2.0',
    method: 'alchemy_getAssetTransfers',
    params: [
      {
        fromBlock: opts.fromBlock || '0x0',
        toBlock: opts.toBlock || 'latest',
        category: ['external', 'erc20'],
        withMetadata: false,
        excludeZeroValue: true,
        maxCount: opts.maxCount || '0x14',
        [direction === 'from' ? 'fromAddress' : 'toAddress']: address,
      },
    ],
  };
  const json = await _fetchJsonWithRetry(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return json;
}

async function fetchAlchemyAllTransfers(rpcUrl, address, opts = {}) {
  const [sentRes, recvRes] = await Promise.all([
    fetchAlchemyTransfers(rpcUrl, address, 'from', opts),
    fetchAlchemyTransfers(rpcUrl, address, 'to', opts),
  ]);
  if (sentRes.error) throw new Error(sentRes.error.message || 'Alchemy error (from)');
  if (recvRes.error) throw new Error(recvRes.error.message || 'Alchemy error (to)');

  const sent = (sentRes.result?.transfers || []).map(normalizeAlchemyTransfer).filter(Boolean);
  const recv = (recvRes.result?.transfers || []).map(normalizeAlchemyTransfer).filter(Boolean);
  return [...sent, ...recv];
}

// ── Blockscout provider ──────────────────────────────────────────────────

async function fetchBlockscoutTransfers(networkKey, address, opts = {}) {
  const baseUrl = BLOCKSCOUT_ENDPOINTS[networkKey];
  if (!baseUrl) {
    throw new Error(`Blockscout: network ${networkKey} not supported`);
  }
  const offset = opts.offset || REST_DEFAULT_OFFSET;
  const nativeSymbol = getNativeAssetForNetwork(networkKey);

  const nativeUrl =
    `${baseUrl}?module=account&action=txlist&address=${encodeURIComponent(address)}` +
    `&sort=desc&page=1&offset=${offset}`;
  const tokenUrl =
    `${baseUrl}?module=account&action=tokentx&address=${encodeURIComponent(address)}` +
    `&sort=desc&page=1&offset=${offset}`;

  const [nativeRows, tokenRows] = await Promise.all([
    _fetchEtherscanLike(nativeUrl).catch((e) => {
      console.warn('[Blockscout txlist]', e.message);
      return [];
    }),
    _fetchEtherscanLike(tokenUrl).catch((e) => {
      console.warn('[Blockscout tokentx]', e.message);
      return [];
    }),
  ]);

  const native = nativeRows.map((r) => normalizeNativeTxlistRow(r, nativeSymbol)).filter(Boolean);
  const tokens = tokenRows.map(normalizeTokenTxlistRow).filter(Boolean);
  return [...native, ...tokens];
}

// ── Etherscan V2 provider ────────────────────────────────────────────────

async function fetchEtherscanV2Transfers(networkKey, address, apiKey, opts = {}) {
  const chainId = ETHERSCAN_V2_CHAIN_IDS[networkKey];
  if (!chainId) {
    throw new Error(`Etherscan V2: network ${networkKey} not supported`);
  }
  if (!apiKey) {
    throw new Error('Etherscan V2: API key required');
  }
  const offset = opts.offset || REST_DEFAULT_OFFSET;
  const nativeSymbol = getNativeAssetForNetwork(networkKey);

  const common =
    `?chainid=${chainId}` +
    `&address=${encodeURIComponent(address)}` +
    `&startblock=0&endblock=99999999` +
    `&page=1&offset=${offset}&sort=desc` +
    `&apikey=${encodeURIComponent(apiKey)}`;

  const nativeUrl = `${ETHERSCAN_V2_ENDPOINT}${common}&module=account&action=txlist`;
  const tokenUrl = `${ETHERSCAN_V2_ENDPOINT}${common}&module=account&action=tokentx`;

  const [nativeRows, tokenRows] = await Promise.all([
    _fetchEtherscanLike(nativeUrl).catch((e) => {
      console.warn('[Etherscan txlist]', e.message);
      return [];
    }),
    _fetchEtherscanLike(tokenUrl).catch((e) => {
      console.warn('[Etherscan tokentx]', e.message);
      return [];
    }),
  ]);

  const native = nativeRows.map((r) => normalizeNativeTxlistRow(r, nativeSymbol)).filter(Boolean);
  const tokens = tokenRows.map(normalizeTokenTxlistRow).filter(Boolean);
  return [...native, ...tokens];
}

// ── Moralis provider ──────────────────────────────────────────────────────

function normalizeMoralisTx(raw, nativeSymbol) {
  if (!raw || !raw.hash) return null;
  const failed = raw.receipt_status === '0';
  return {
    hash: raw.hash,
    from: raw.from_address || '',
    to: raw.to_address || '',
    value: failed ? '0' : _weiToEtherString(raw.value),
    asset: nativeSymbol,
    blockNum: raw.block_number ? _toHexBlockNum(raw.block_number) : '0x0',
    category: 'external',
    metadata: raw.block_timestamp ? { blockTimestamp: raw.block_timestamp } : null,
  };
}

function normalizeMoralisErc20(raw) {
  if (!raw || !raw.transaction_hash) return null;
  const decimals = parseInt(raw.token_decimals || '18', 10);
  return {
    hash: raw.transaction_hash,
    from: raw.from_address || '',
    to: raw.to_address || '',
    value: _rawToHumanString(raw.value, decimals),
    asset: raw.token_symbol || 'TOKEN',
    blockNum: raw.block_number ? _toHexBlockNum(raw.block_number) : '0x0',
    category: 'erc20',
    metadata: raw.block_timestamp ? { blockTimestamp: raw.block_timestamp } : null,
  };
}

async function fetchMoralisTransfers(networkKey, address, apiKey, opts = {}) {
  const chainHex = MORALIS_CHAIN_IDS[networkKey];
  if (!chainHex) throw new Error(`Moralis: network ${networkKey} not supported`);
  if (!apiKey) throw new Error('Moralis: API key required');

  const limit = opts.limit || 100;
  const nativeSymbol = getNativeAssetForNetwork(networkKey);
  const headers = { 'X-API-Key': apiKey };

  const nativeUrl = `${MORALIS_API_BASE}/${encodeURIComponent(address)}?chain=${chainHex}&limit=${limit}`;
  const tokenUrl = `${MORALIS_API_BASE}/${encodeURIComponent(address)}/erc20/transfers?chain=${chainHex}&limit=${limit}`;

  const [nativeRes, tokenRes] = await Promise.all([
    _fetchJsonWithRetry(nativeUrl, { method: 'GET', headers }).catch((e) => {
      console.warn('[Moralis txlist]', e.message);
      return { result: [] };
    }),
    _fetchJsonWithRetry(tokenUrl, { method: 'GET', headers }).catch((e) => {
      console.warn('[Moralis tokentx]', e.message);
      return { result: [] };
    }),
  ]);

  const native = (nativeRes.result || [])
    .map((r) => normalizeMoralisTx(r, nativeSymbol))
    .filter(Boolean);
  const tokens = (tokenRes.result || []).map(normalizeMoralisErc20).filter(Boolean);
  return [...native, ...tokens];
}

// ── Resolver ─────────────────────────────────────────────────────────────

// Возвращает:
//   {
//     type: 'alchemy' | 'blockscout' | 'etherscan',
//     label: 'Alchemy (fast)' | 'Blockscout (public)' | 'Etherscan V2',
//     fetchAll: async (address, opts) => Transfer[],
//   }
// либо null если для этой сети нет доступного провайдера без ключа.
function _getMoralisKey() {
  // Приоритет: user-provided > встроенный дефолтный
  const cfg = globalThis.WOLF_WALLET_RPC_DEFAULTS;
  return cfg?.moralisApiKey || '';
}

function resolveProvider({ networkKey, rpcUrl, etherscanKey }) {
  // 1. Alchemy fast path (user explicitly set Alchemy RPC)
  if (isAlchemyUrl(rpcUrl)) {
    return {
      type: 'alchemy',
      label: 'Alchemy',
      fetchAll: (address, opts) => fetchAlchemyAllTransfers(rpcUrl, address, opts),
    };
  }

  // 2. Moralis — дефолт для ВСЕХ сетей. Встроенный ключ работает
  //    для ETH, Sepolia, BSC и 20+ других сетей. Один ключ = всё.
  const moralisKey = _getMoralisKey();
  if (moralisKey && MORALIS_CHAIN_IDS[networkKey]) {
    return {
      type: 'moralis',
      label: 'Moralis',
      fetchAll: (address, opts) => fetchMoralisTransfers(networkKey, address, moralisKey, opts),
    };
  }

  // 3. Etherscan V2 (user-provided key, fallback)
  if (etherscanKey && ETHERSCAN_V2_CHAIN_IDS[networkKey]) {
    return {
      type: 'etherscan',
      label: 'Etherscan V2',
      fetchAll: (address, opts) =>
        fetchEtherscanV2Transfers(networkKey, address, etherscanKey, opts),
    };
  }

  // 4. Blockscout (ETH/Sepolia only, no key needed)
  if (isBlockscoutSupported(networkKey)) {
    return {
      type: 'blockscout',
      label: 'Blockscout',
      fetchAll: (address, opts) => fetchBlockscoutTransfers(networkKey, address, opts),
    };
  }

  return null;
}

function getNoProviderReason(networkKey) {
  return 'История недоступна. Проверьте подключение к интернету.';
}

// ── Export ───────────────────────────────────────────────────────────────

export const WolfPopupTxHistoryProviders = {
  // Resolver
  resolveProvider,
  getNoProviderReason,

  // Individual providers
  fetchAlchemyTransfers,
  fetchAlchemyAllTransfers,
  fetchBlockscoutTransfers,
  fetchEtherscanV2Transfers,
  fetchMoralisTransfers,

  // Normalization helpers
  normalizeAlchemyTransfer,
  normalizeNativeTxlistRow,
  normalizeTokenTxlistRow,
  normalizeMoralisTx,
  normalizeMoralisErc20,

  // URL helpers
  isAlchemyUrl,
  isBlockscoutSupported,
  getNativeAssetForNetwork,

  // Constants
  BLOCKSCOUT_ENDPOINTS,
  ETHERSCAN_V2_ENDPOINT,
  ETHERSCAN_V2_CHAIN_IDS,
  MORALIS_API_BASE,
  MORALIS_CHAIN_IDS,
};
globalThis.WolfPopupTxHistoryProviders = WolfPopupTxHistoryProviders;
