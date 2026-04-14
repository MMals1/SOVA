'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// handlers/sign-typed-data.js — eth_signTypedData_v4 (EIP-712 signing)
// Depends on: sw-security.js, sw-wallet.js, sw-dapp.js (approval lifecycle)
// ═══════════════════════════════════════════════════════════════════════════

// ── eth_signTypedData_v4 ──────────────────────────────────────────────────
async function handleSignTypedDataV4(origin, params) {
  if (params.length < 2) {
    const e = new Error('eth_signTypedData_v4 requires [address, typedData]');
    e.code = 4100;
    throw e;
  }
  const address = params[0];
  const typedDataRaw = params[1];
  if (!ethers.isAddress(address)) {
    const e = new Error('Invalid address');
    e.code = 4100;
    throw e;
  }
  let typedData;
  try {
    typedData = typeof typedDataRaw === 'string' ? JSON.parse(typedDataRaw) : typedDataRaw;
  } catch {
    const e = new Error('Invalid typed data JSON');
    e.code = 4100;
    throw e;
  }
  if (
    !typedData ||
    !typedData.types ||
    !typedData.domain ||
    !typedData.primaryType ||
    !typedData.message
  ) {
    const e = new Error('Malformed EIP-712 payload');
    e.code = 4100;
    throw e;
  }

  await ensureConnectedOriginHasAddress(origin, address);

  // P2-4: HARD BLOCK при chainId mismatch (раньше был только warning).
  // Атакующий dApp может попросить подпись для другой сети, которую потом
  // replay'ит против user'а. Защита: не показываем approval вообще,
  // возвращаем error 4901 (Chain not configured) — стандартный EIP-1193 код.
  const { chainId: currentChainId } = await getActiveNetworkParams();
  const domainChainIdRaw = typedData.domain.chainId;
  if (domainChainIdRaw != null) {
    let domainChainId;
    if (typeof domainChainIdRaw === 'number') {
      domainChainId = domainChainIdRaw;
    } else if (typeof domainChainIdRaw === 'string') {
      domainChainId = domainChainIdRaw.startsWith('0x')
        ? parseInt(domainChainIdRaw, 16)
        : parseInt(domainChainIdRaw, 10);
    } else if (typeof domainChainIdRaw === 'bigint') {
      domainChainId = Number(domainChainIdRaw);
    } else {
      domainChainId = NaN;
    }
    if (!Number.isFinite(domainChainId)) {
      const e = new Error(`Invalid domain.chainId in typed data: ${domainChainIdRaw}`);
      e.code = 4100;
      throw e;
    }
    if (domainChainId !== Number(currentChainId)) {
      const e = new Error(
        `Chain ID mismatch: typed data requires chainId ${domainChainId}, ` +
          `but wallet is on ${currentChainId}. Switch network in SOVA wallet first.`,
      );
      e.code = 4901; // EIP-1193: Chain not configured
      throw e;
    }
  }

  const needsUnlock = !getWalletForAddress(address);
  let targetAccountIndex = null;
  if (needsUnlock) {
    const { accounts = [] } = await chrome.storage.local.get(['accounts']);
    targetAccountIndex = accounts.findIndex(
      (a) => a.address.toLowerCase() === address.toLowerCase(),
    );
    if (targetAccountIndex === -1) {
      const e = new Error('Address not found in wallet');
      e.code = 4100;
      throw e;
    }
  }

  const approved = await requestApproval({
    origin,
    method: 'eth_signTypedData_v4',
    params: [
      {
        address,
        typedData,
        currentChainId,
      },
    ],
    needsUnlock,
    targetAccountIndex,
    targetAddress: address,
  });
  if (!approved || approved.rejected) {
    const e = new Error('User rejected the request');
    e.code = 4001;
    throw e;
  }

  const activeWallet = getWalletForAddress(address);
  if (!activeWallet) {
    const e = new Error('Wallet still locked after approval');
    e.code = -32603;
    throw e;
  }

  // ethers v6: wallet.signTypedData(domain, types, value)
  // EIP712Domain тип исключается из types (ethers сам его добавляет)
  const types = { ...typedData.types };
  delete types.EIP712Domain;
  const signature = await activeWallet.signTypedData(typedData.domain, types, typedData.message);

  appendAuditLog({ type: 'dapp-sign', origin, method: 'eth_signTypedData_v4', address });
  return signature;
}
