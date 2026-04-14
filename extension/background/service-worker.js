'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// service-worker.js — Entry point for SOVA Wallet MV3 service worker
// Loads all modules via importScripts (shared global scope, order matters)
// ═══════════════════════════════════════════════════════════════════════════

// Ethers.js нужен SW для расшифровки keystore и подписи транзакций
importScripts('../libs/ethers.umd.min.js');
importScripts('../network-config.js');
importScripts('../shared/networks.js');
importScripts('../shared/message-types.js');

const RPC_DEFAULTS =
  globalThis.WOLF_WALLET_RPC_DEFAULTS && typeof globalThis.WOLF_WALLET_RPC_DEFAULTS === 'object'
    ? globalThis.WOLF_WALLET_RPC_DEFAULTS
    : {};

function getDefaultRpcUrl(networkKey, fallback) {
  return RPC_DEFAULTS[networkKey] || fallback;
}

const WalletNetworks =
  globalThis.WolfWalletNetworks && typeof globalThis.WolfWalletNetworks === 'object'
    ? globalThis.WolfWalletNetworks
    : null;

const NETWORKS =
  WalletNetworks && typeof WalletNetworks.getNetworkConfigs === 'function'
    ? WalletNetworks.getNetworkConfigs(RPC_DEFAULTS)
    : {
        'eth-mainnet': {
          chainId: 1,
          defaultRpcUrl: getDefaultRpcUrl('eth-mainnet', 'https://ethereum-rpc.publicnode.com'),
        },
        'eth-sepolia': {
          chainId: 11155111,
          defaultRpcUrl: getDefaultRpcUrl(
            'eth-sepolia',
            'https://ethereum-sepolia-rpc.publicnode.com',
          ),
        },
        bsc: {
          chainId: 56,
          defaultRpcUrl: getDefaultRpcUrl('bsc', 'https://bsc-rpc.publicnode.com'),
        },
      };
const DEFAULT_NETWORK_KEY = (WalletNetworks && WalletNetworks.DEFAULT_NETWORK_KEY) || 'eth-sepolia';

// Load SW modules (order matters — each depends on previous)
importScripts('sw-security.js'); // _swLog, lock constants, bruteforce, audit log
importScripts('sw-wallet.js'); // wallet state, ERC20_ABI, network params, lookup
importScripts('sw-rpc.js'); // rpcResult, rpcError, proxyRpc
importScripts('sw-dapp.js'); // sender validation, approval system, EIP-1193 dispatcher
importScripts('handlers/eth-request-accounts.js'); // handleEthRequestAccounts
importScripts('handlers/personal-sign.js'); // handlePersonalSign
importScripts('handlers/sign-typed-data.js'); // handleSignTypedDataV4
importScripts('handlers/send-transaction.js'); // handleEthSendTransaction
importScripts('sw-broadcast.js'); // broadcastToOrigin, broadcastAccountsChanged, etc.
importScripts('sw-handlers.js'); // handleMessage — main message router

// ── Message listener ──────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((result) =>
      sendResponse(
        result &&
          typeof result === 'object' &&
          ('id' in result || 'result' in result || 'error' in result)
          ? result
          : { ok: true, ...result },
      ),
    )
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // держим канал открытым для async ответа
});

// ── Автоблокировка + cleanup истёкших pending requests ────────────────────
const PENDING_CLEANUP_ALARM = 'cleanup-pending';
chrome.alarms.create(PENDING_CLEANUP_ALARM, { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === LOCK_ALARM) {
    clearUnlockedWallets(); // ключи уничтожены
    resetAllNonces(); // nonce cache invalidated
    chrome.storage.session.clear(); // popup увидит что сессия сброшена
    broadcastAccountsChanged([]).catch(() => {});
  } else if (alarm.name === PENDING_CLEANUP_ALARM) {
    // Cleanup истёкших pending dApp requests из session storage.
    // Защита от накопления stale entries при множественных SW restart'ах.
    try {
      const { pendingDappRequests = {} } = await chrome.storage.session.get([
        'pendingDappRequests',
      ]);
      const now = Date.now();
      const cleaned = {};
      for (const [id, req] of Object.entries(pendingDappRequests)) {
        if (req.expiresAt > now) cleaned[id] = req;
      }
      await chrome.storage.session.set({ pendingDappRequests: cleaned });
    } catch (e) {
      /* session storage may be unavailable */
    }
  }
});

// ── Install ───────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  // Очищаем остаточные alarm'ы — новый создастся при unlock
  chrome.alarms.clear(LOCK_ALARM);
  // Очищаем pending dApp requests — они уже истекли к моменту install/update
  chrome.storage.session.remove(['pendingDappRequests']).catch(() => {});
});

// ── Clear notification click ──────────────────────────────────────────────
if (chrome.notifications && chrome.notifications.onClicked) {
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith('sova-approval-')) {
      const id = notificationId.substring('sova-approval-'.length);
      openApprovalWindow(id).catch(() => {});
      chrome.notifications.clear(notificationId);
    }
  });
}
