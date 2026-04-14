'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// handlers/eth-request-accounts.js — eth_requestAccounts (connect flow)
// Depends on: sw-security.js, sw-wallet.js, sw-dapp.js (approval lifecycle)
// ═══════════════════════════════════════════════════════════════════════════

// ── eth_requestAccounts ───────────────────────────────────────────────────
async function handleEthRequestAccounts(origin) {
  // Если уже подключён — возвращаем сразу (но с проверкой unlock-состояния)
  const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
  if (
    connectedOrigins[origin] &&
    Array.isArray(connectedOrigins[origin].addresses) &&
    connectedOrigins[origin].addresses.length > 0
  ) {
    const addresses = connectedOrigins[origin].addresses;

    // Если SW был убит / auto-lock сработал → _walletsByAddress пуст.
    // Нужно открыть approval-окно чтобы user ввёл пароль.
    if (!_activeWalletAddress) {
      const { accounts = [] } = await chrome.storage.local.get(['accounts']);
      // Находим индекс первого granted адреса в storage.accounts
      const firstGrantedLower = addresses[0].toLowerCase();
      const targetIndex = accounts.findIndex((a) => a.address.toLowerCase() === firstGrantedLower);
      if (targetIndex === -1) {
        const e = new Error('Granted address not found in wallet');
        e.code = 4100;
        throw e;
      }
      const approved = await requestApproval({
        origin,
        method: 'eth_requestAccounts',
        params: [{ requiresUnlock: true }],
        needsUnlock: true,
        targetAccountIndex: targetIndex,
        targetAddress: addresses[0],
      });
      if (!approved || approved.rejected) {
        const e = new Error('User rejected the request');
        e.code = 4001;
        throw e;
      }
      // После unlock — возвращаем granted addresses
    }

    connectedOrigins[origin].lastUsedAt = Date.now();
    await chrome.storage.local.set({ connectedOrigins });
    return addresses;
  }

  // Проверяем что у пользователя вообще есть wallet
  const { accounts = [] } = await chrome.storage.local.get(['accounts']);
  if (!accounts.length) {
    const e = new Error('No accounts in wallet. Create one in SOVA first.');
    e.code = 4100;
    throw e;
  }

  // Открываем popup approval
  const approved = await requestApproval({
    origin,
    method: 'eth_requestAccounts',
    params: [],
  });

  if (!approved || approved.rejected) {
    const e = new Error('User rejected the request');
    e.code = 4001;
    throw e;
  }

  const selectedAddresses =
    Array.isArray(approved.addresses) && approved.addresses.length > 0
      ? approved.addresses
      : [accounts[0].address];

  // ── Активируем выбранный аккаунт в SW, если он отличается от текущего ──
  // Без этого: eth_accounts вернёт [] (активный не совпадает с granted),
  // ethers.getSigner() получит "invalid account" и dApp зависнет.
  const selectedLower = selectedAddresses[0].toLowerCase();
  if (_activeWalletAddress && selectedLower !== _activeWalletAddress.toLowerCase()) {
    const selIdx = accounts.findIndex((a) => a.address.toLowerCase() === selectedLower);
    if (selIdx !== -1 && _walletsByAddress.has(selectedLower)) {
      _activeWalletAddress = selectedLower;
      _swLog('[handleEthRequestAccounts] switched active wallet →', selectedLower);
    }
  }

  // Получаем текущий chainId
  const { chainId } = await getActiveNetworkParams();

  let updated = { ...connectedOrigins };
  updated[origin] = {
    addresses: selectedAddresses,
    chainId,
    connectedAt: Date.now(),
    lastUsedAt: Date.now(),
    permissions: ['eth_accounts'],
  };
  // MED-7: LRU + TTL enforcement — не даём storage бесконтрольно расти
  updated = enforceConnectedOriginsLimits(updated);
  await chrome.storage.local.set({ connectedOrigins: updated });

  // Log в audit
  appendAuditLog({
    type: 'dapp-connect',
    origin,
    addresses: selectedAddresses,
  });

  // Broadcast connect event в этот origin
  broadcastToOrigin(origin, BroadcastEvent.CONNECT, { chainId: '0x' + chainId.toString(16) }).catch(
    () => {},
  );
  broadcastToOrigin(origin, BroadcastEvent.ACCOUNTS_CHANGED, selectedAddresses).catch(() => {});

  return selectedAddresses;
}
