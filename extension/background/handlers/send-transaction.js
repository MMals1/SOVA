'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// handlers/send-transaction.js — eth_sendTransaction (tx building & signing)
// Depends on: sw-security.js, sw-wallet.js, sw-rpc.js, sw-dapp.js (approval lifecycle)
// ═══════════════════════════════════════════════════════════════════════════

// ── eth_sendTransaction ───────────────────────────────────────────────────
async function handleEthSendTransaction(origin, params) {
  if (!params.length || !params[0] || typeof params[0] !== 'object') {
    const e = new Error('eth_sendTransaction requires a transaction object');
    e.code = 4100;
    throw e;
  }
  const txInput = params[0];
  const fromRaw = txInput.from;
  if (!ethers.isAddress(fromRaw)) {
    const e = new Error('Invalid from address');
    e.code = 4100;
    throw e;
  }
  await ensureConnectedOriginHasAddress(origin, fromRaw);

  const needsUnlock = !getWalletForAddress(fromRaw);
  let targetAccountIndex = null;
  if (needsUnlock) {
    const { accounts = [] } = await chrome.storage.local.get(['accounts']);
    targetAccountIndex = accounts.findIndex(
      (a) => a.address.toLowerCase() === fromRaw.toLowerCase(),
    );
    if (targetAccountIndex === -1) {
      const e = new Error('From address not found in wallet');
      e.code = 4100;
      throw e;
    }
  }

  const { rpcUrl, chainId } = await getActiveNetworkParams();
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);

  // Normalize tx request
  const txRequest = {};
  if (txInput.to) {
    if (!ethers.isAddress(txInput.to)) {
      const e = new Error('Invalid to address');
      e.code = 4100;
      throw e;
    }
    txRequest.to = txInput.to;
  }
  if (txInput.value != null) {
    txRequest.value = toBigIntHex(txInput.value);
  }
  if (txInput.data != null && txInput.data !== '0x') {
    txRequest.data = txInput.data;
  } else if (txInput.input != null && txInput.input !== '0x') {
    txRequest.data = txInput.input;
  }
  txRequest.chainId = chainId;

  // Gas estimate — работает без приватного ключа (provider достаточно)
  let gasEstimate;
  try {
    gasEstimate = await provider.estimateGas({ ...txRequest, from: fromRaw });
  } catch (err) {
    const e = new Error(`Gas estimation failed: ${err.message}`);
    e.code = -32603;
    throw e;
  }
  const gasLimit = txInput.gas ? toBigIntHex(txInput.gas) : (gasEstimate * 120n) / 100n;
  txRequest.gasLimit = gasLimit;

  // Fee data
  let feeData;
  try {
    feeData = await provider.getFeeData();
  } catch {
    feeData = null;
  }

  // Preview — возможно RPC ошибка, но мы продолжаем с estimate'ом
  const previewGas = feeData ? feeData.maxFeePerGas || feeData.gasPrice || 0n : 0n;
  const previewFeeWei = gasLimit * previewGas;

  // Show approval (с unlock-экраном если wallet locked)
  const approved = await requestApproval({
    origin,
    method: 'eth_sendTransaction',
    params: [
      {
        from: fromRaw,
        to: txRequest.to || null,
        value: txRequest.value ? '0x' + txRequest.value.toString(16) : '0x0',
        data: txRequest.data || '0x',
        gasLimit: '0x' + gasLimit.toString(16),
        gasEstimate: '0x' + gasEstimate.toString(16),
        feeWei: '0x' + previewFeeWei.toString(16),
        chainId,
      },
    ],
    needsUnlock,
    targetAccountIndex,
    targetAddress: fromRaw,
  });
  if (!approved || approved.rejected) {
    const e = new Error('User rejected the request');
    e.code = 4001;
    throw e;
  }

  // После approval — fetch wallet (должен быть уже unlocked после inline password prompt)
  const activeWallet = getWalletForAddress(fromRaw);
  if (!activeWallet) {
    const e = new Error('Wallet still locked after approval');
    e.code = -32603;
    throw e;
  }
  const connected = activeWallet.connect(provider);

  // 6.4: Managed nonce prevents tx replay on rapid dApp sends
  txRequest.nonce = await getNextNonce(provider, fromRaw, chainId);

  let tx;
  try {
    tx = await connected.sendTransaction(txRequest);
  } catch (err) {
    resetNonce(fromRaw, chainId);
    throw err;
  }

  appendAuditLog({
    type: 'dapp-send',
    origin,
    from: fromRaw,
    to: txRequest.to || null,
    hash: tx.hash,
  });

  return tx.hash;
}
