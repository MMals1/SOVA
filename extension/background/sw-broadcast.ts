/// <reference path="sw-globals.d.ts" />
'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// sw-broadcast.ts — Broadcast events to dApps via content scripts
// Depends on: sw-security.ts (_swLog), sw-wallet.ts (_activeWalletAddress)
// ═══════════════════════════════════════════════════════════════════════════

async function broadcastToOrigin(origin: string, event: string, data: unknown): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.url) continue;
      try {
        const tabOrigin = new URL(tab.url).origin;
        if (tabOrigin !== origin) continue;
        chrome.tabs.sendMessage(tab.id!, { type: MessageType.DAPP_EVENT, event, data }, () => {
          if (chrome.runtime.lastError) {
            /* tab might not have content script */
          }
        });
      } catch {
        /* invalid URL */
      }
    }
  } catch (err) {
    _swLog('[SOVA SW] broadcastToOrigin failed', (err as Error)?.message);
  }
}

async function broadcastToAllConnected(event: string, data: unknown): Promise<void> {
  const { connectedOrigins = {} } = (await chrome.storage.local.get(['connectedOrigins'])) as {
    connectedOrigins?: Record<string, ConnectedOriginRecord>;
  };
  for (const origin of Object.keys(connectedOrigins)) {
    broadcastToOrigin(origin, event, data).catch(() => {});
  }
}

async function broadcastChainChanged(chainIdHex: string): Promise<void> {
  return broadcastToAllConnected(BroadcastEvent.CHAIN_CHANGED, chainIdHex);
}

async function broadcastAccountsChanged(explicitAddresses?: string[]): Promise<void> {
  const { connectedOrigins = {} } = (await chrome.storage.local.get(['connectedOrigins'])) as {
    connectedOrigins?: Record<string, ConnectedOriginRecord>;
  };
  for (const [origin, record] of Object.entries(connectedOrigins)) {
    let addrs: string[];
    if (explicitAddresses !== undefined) {
      // Явная перезапись (например из lock → [] для всех origin'ов)
      addrs = explicitAddresses;
    } else if (!_activeWalletAddress) {
      // Кошелёк залочен — dApp видит disconnect
      addrs = [];
    } else {
      // Возвращаем активный аккаунт, если он в granted списке для этого origin'а
      const activeLower = _activeWalletAddress.toLowerCase();
      const matched = (record.addresses || []).find((a) => a.toLowerCase() === activeLower);
      addrs = matched ? [matched] : [];
    }
    broadcastToOrigin(origin, BroadcastEvent.ACCOUNTS_CHANGED, addrs).catch(() => {});
  }
}
