'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// handlers/personal-sign.js — personal_sign (EIP-191 message signing)
// Depends on: sw-security.js, sw-wallet.js, sw-dapp.js (approval lifecycle)
// ═══════════════════════════════════════════════════════════════════════════

// ── personal_sign ─────────────────────────────────────────────────────────
// LOW-3: Принимаем оба порядка параметров:
//   [message, address]  — стандарт EIP-191 / EIP-1193
//   [address, message]  — MetaMask legacy convention
// Это намеренное решение для максимальной совместимости с dApp'ами.
// Определяем порядок по тому, какой из двух параметров является валидным адресом.
async function handlePersonalSign(origin, params) {
  let data, address;
  if (params.length < 2) {
    const e = new Error('personal_sign requires [message, address]');
    e.code = 4100;
    throw e;
  }
  if (ethers.isAddress(params[0])) {
    address = params[0];
    data = params[1];
  } else if (ethers.isAddress(params[1])) {
    data = params[0];
    address = params[1];
  } else {
    const e = new Error('personal_sign: no valid address in params');
    e.code = 4100;
    throw e;
  }

  await ensureConnectedOriginHasAddress(origin, address);

  // Проверяем есть ли нужный кошелёк в памяти SW.
  // Если нет — approval-экран покажет поле ввода пароля.
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

  // Декодируем сообщение для отображения
  let displayMessage = data;
  try {
    if (typeof data === 'string' && data.startsWith('0x')) {
      const bytes = ethers.getBytes(data);
      displayMessage = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  } catch {
    /* keep raw */
  }

  const approved = await requestApproval({
    origin,
    method: 'personal_sign',
    params: [{ message: displayMessage, rawMessage: data, address }],
    needsUnlock,
    targetAccountIndex,
    targetAddress: address,
  });
  if (!approved || approved.rejected) {
    const e = new Error('User rejected the request');
    e.code = 4001;
    throw e;
  }

  // После approval — кошелёк должен быть разблокирован
  const activeWallet = getWalletForAddress(address);
  if (!activeWallet) {
    const e = new Error('Wallet still locked after approval');
    e.code = -32603;
    throw e;
  }

  const signature = await activeWallet.signMessage(
    typeof data === 'string' && data.startsWith('0x') ? ethers.getBytes(data) : data,
  );

  appendAuditLog({ type: 'dapp-sign', origin, method: 'personal_sign', address });
  return signature;
}
