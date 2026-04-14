/// <reference path="sw-globals.d.ts" />
'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// sw-wallet.ts — Wallet state, ERC20 ABI, network params, wallet lookup
// Depends on: sw-security.ts (for _swLog)
// ═══════════════════════════════════════════════════════════════════════════

const ERC20_ABI: string[] = ['function transfer(address to, uint256 value) returns (bool)'];

// ── Единственное место в приложении где живёт расшифрованный ключ ─────────────
const _walletsByAddress = new Map<string, EthersWallet>();
let _activeWalletAddress: string | null = null;

// MED-17: LRU cap для _walletsByAddress.
const MAX_UNLOCKED_WALLETS = 20;

function rememberUnlockedWallet(walletKey: string, wallet: EthersWallet): void {
  if (_walletsByAddress.size >= MAX_UNLOCKED_WALLETS && !_walletsByAddress.has(walletKey)) {
    // Удалить самый старый кроме активного
    for (const k of _walletsByAddress.keys()) {
      if (k !== _activeWalletAddress) {
        _walletsByAddress.delete(k);
        break;
      }
    }
  }
  _walletsByAddress.set(walletKey, wallet);
}

function getActiveWallet(): EthersWallet | null {
  if (!_activeWalletAddress) return null;
  return _walletsByAddress.get(_activeWalletAddress) || null;
}

function clearUnlockedWallets(): void {
  _walletsByAddress.clear();
  _activeWalletAddress = null;
}

// ── Wallet lookup ─────────────────────────────────────────────────────────
function getWalletForAddress(address: string): EthersWallet | null {
  if (!address) return null;
  const key = String(address).toLowerCase();
  return _walletsByAddress.get(key) || null;
}

interface NetworkParams {
  rpcUrl: string;
  chainId: number;
}

async function getActiveNetworkParams(): Promise<NetworkParams> {
  const { selectedNetwork, rpcByNetwork, rpcUrl } = (await chrome.storage.local.get([
    'selectedNetwork',
    'rpcByNetwork',
    'rpcUrl',
  ])) as { selectedNetwork?: string; rpcByNetwork?: Record<string, string>; rpcUrl?: string };

  const networkKey =
    selectedNetwork && NETWORKS[selectedNetwork] ? selectedNetwork : DEFAULT_NETWORK_KEY;
  const fallbackMap =
    rpcByNetwork && typeof rpcByNetwork === 'object'
      ? rpcByNetwork
      : ({} as Record<string, string>);
  const legacyRpcUrl = networkKey === 'bsc' ? null : rpcUrl;
  const activeRpcUrl =
    fallbackMap[networkKey] || legacyRpcUrl || NETWORKS[networkKey].defaultRpcUrl;
  const chainId = NETWORKS[networkKey].chainId;

  return { rpcUrl: activeRpcUrl as string, chainId };
}

async function ensureConnectedOriginHasAddress(
  origin: string,
  address: string,
): Promise<ConnectedOriginRecord> {
  const { connectedOrigins = {} } = (await chrome.storage.local.get(['connectedOrigins'])) as {
    connectedOrigins?: Record<string, ConnectedOriginRecord>;
  };
  const record = connectedOrigins[origin];
  if (!record || !Array.isArray(record.addresses)) {
    const e = new Error('Origin not connected. Call eth_requestAccounts first.') as Error & {
      code: number;
    };
    e.code = 4100;
    throw e;
  }
  const match = record.addresses.some((a) => a.toLowerCase() === String(address).toLowerCase());
  if (!match) {
    const e = new Error('Address is not permitted for this origin') as Error & { code: number };
    e.code = 4100;
    throw e;
  }
  record.lastUsedAt = Date.now();
  connectedOrigins[origin] = record;
  await chrome.storage.local.set({ connectedOrigins });
  return record;
}

// ── Utility ───────────────────────────────────────────────────────────────
function toBigIntHex(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') {
    if (value.startsWith('0x')) return BigInt(value);
    if (/^\d+$/.test(value)) return BigInt(value);
  }
  // LOW-4: truncate — value может быть огромной строкой (dApp-controlled input)
  const preview = String(value).slice(0, 64);
  throw new Error(`Cannot convert to bigint: ${preview}${String(value).length > 64 ? '…' : ''}`);
}

// ── 6.4: Nonce management ─────────────────────────────────────────────────
// Tracks nonces per address+chainId to prevent tx replay on rapid sends.
// Falls back to provider.getTransactionCount if cache is stale (>30s).

interface NonceEntry {
  nonce: number;
  updatedAt: number;
}

const _nonceCache = new Map<string, NonceEntry>();
const NONCE_STALE_MS = 30_000; // Re-fetch from chain after 30s of inactivity

function _nonceKey(address: string, chainId: number): string {
  return `${String(address).toLowerCase()}:${chainId}`;
}

async function getNextNonce(
  provider: { getTransactionCount: (addr: string, block: string) => Promise<number> },
  address: string,
  chainId: number,
): Promise<number> {
  const key = _nonceKey(address, chainId);
  const cached = _nonceCache.get(key);
  const now = Date.now();

  if (cached && now - cached.updatedAt < NONCE_STALE_MS) {
    // Use cached nonce (incremented from last send)
    const next = cached.nonce;
    _nonceCache.set(key, { nonce: next + 1, updatedAt: now });
    return next;
  }

  // Fetch fresh nonce from chain (pending count includes mempool)
  const onChain = await provider.getTransactionCount(address, 'pending');
  _nonceCache.set(key, { nonce: onChain + 1, updatedAt: now });
  return onChain;
}

function resetNonce(address: string, chainId: number): void {
  _nonceCache.delete(_nonceKey(address, chainId));
}

function resetAllNonces(): void {
  _nonceCache.clear();
}
