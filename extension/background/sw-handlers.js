'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// sw-handlers.js — Main message router (handleMessage) + handleDappRequest
// Depends on: all previous sw-*.js modules
// ═══════════════════════════════════════════════════════════════════════════

// ── Обработка сообщений от popup ─────────────────────────────────────────────
async function handleMessage(msg, sender) {
  // ── Sender validation: гарантируем что сообщение пришло из правильного контекста ──
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    throw new Error('Invalid message format');
  }
  if (POPUP_ONLY_MESSAGE_TYPES.has(msg.type)) {
    if (!isFromExtensionContext(sender)) {
      const e = new Error(`Permission denied: '${msg.type}' must come from extension popup`);
      e.code = 4100;
      throw e;
    }
  } else if (CONTENT_SCRIPT_MESSAGE_TYPES.has(msg.type)) {
    if (!isFromOurContentScript(sender)) {
      // dapp-request — особый случай: возвращаем RPC-style envelope с ошибкой
      return rpcError(
        msg.payload?.id,
        -32603,
        'Permission denied: dapp-request must come from content script',
      );
    }
  } else {
    throw new Error(`Unknown message type: ${msg.type}`);
  }

  switch (msg.type) {
    // ── Popup ↔ SW (существующие) ───────────────────────────────────────────

    // Расшифровываем keystore и сохраняем wallet в памяти SW
    case MessageType.UNLOCK: {
      if (msg.accountIndex == null || typeof msg.accountIndex !== 'number')
        throw new Error('Invalid account index');
      if (!msg.password || typeof msg.password !== 'string') throw new Error('Invalid password');
      // Проверяем persistent lockout state (не in-memory!)
      const lockoutState = await getLockoutState();
      if (Date.now() < lockoutState.lockoutUntil) {
        const waitSec = Math.ceil((lockoutState.lockoutUntil - Date.now()) / 1000);
        throw new Error(`Подождите ${waitSec} сек`);
      }
      const { accounts } = await chrome.storage.local.get(['accounts']);
      if (!accounts?.[msg.accountIndex]?.keystore) {
        throw new Error('Аккаунт не найден');
      }
      try {
        const unlockedWallet = await ethers.Wallet.fromEncryptedJson(
          accounts[msg.accountIndex].keystore,
          msg.password,
        );
        const walletKey = String(unlockedWallet.address).toLowerCase();
        rememberUnlockedWallet(walletKey, unlockedWallet); // MED-17 LRU cap
        _activeWalletAddress = walletKey;
      } catch {
        await recordFailedAttempt();
        throw new Error('Неверный пароль');
      }
      await resetLockoutState();
      await chrome.storage.session.set({ unlocked: true, unlockTime: Date.now() });
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: await getLockDelayMin() });

      // ── Расшифровать ВСЕ остальные аккаунты в фоне (тем же паролем) ──
      // Без этого: при переключении аккаунта через dApp _walletsByAddress
      // не содержит wallet для нового аккаунта → getSigner() → "invalid account".
      // Background decrypt не блокирует unlock-ответ, ~1-2 сек на аккаунт.
      const _pwd = msg.password;
      (async () => {
        for (let i = 0; i < accounts.length; i++) {
          if (i === msg.accountIndex) continue;
          if (!accounts[i]?.keystore) continue;
          const addr = accounts[i]?.address?.toLowerCase();
          if (addr && _walletsByAddress.has(addr)) continue;
          try {
            const w = await ethers.Wallet.fromEncryptedJson(accounts[i].keystore, _pwd);
            rememberUnlockedWallet(String(w.address).toLowerCase(), w);
            _swLog('[unlock] background-decrypted account', i);
          } catch {
            /* другой пароль или повреждён — пропускаем */
          }
        }
      })();

      // Broadcast accountsChanged всем подключённым origin'ам — теперь есть активный адрес
      broadcastAccountsChanged().catch(() => {});
      return {};
    }

    // Блокируем — обнуляем ключ из памяти
    case MessageType.LOCK: {
      clearUnlockedWallets();
      await chrome.storage.session.clear();
      chrome.alarms.clear(LOCK_ALARM);
      // Broadcast: все dApp'ы теряют доступ к аккаунту
      broadcastAccountsChanged([]).catch(() => {});
      return {};
    }

    case MessageType.ACTIVATE_ACCOUNT: {
      if (msg.accountIndex == null || typeof msg.accountIndex !== 'number')
        throw new Error('Invalid account index');
      const { accounts } = await chrome.storage.local.get(['accounts']);
      const targetAddress = accounts?.[msg.accountIndex]?.address;
      if (!targetAddress) throw new Error('Аккаунт не найден');

      const walletKey = String(targetAddress).toLowerCase();
      if (!_walletsByAddress.has(walletKey)) {
        return { activated: false, address: targetAddress };
      }

      _activeWalletAddress = walletKey;
      await chrome.storage.session.set({ unlocked: true, unlockTime: Date.now() });
      chrome.alarms.clear(LOCK_ALARM);
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: await getLockDelayMin() });
      broadcastAccountsChanged().catch(() => {});
      return { activated: true, address: targetAddress };
    }

    // Отправка ETH — подписываем здесь, в popup приватный ключ не попадает
    case MessageType.SEND_ETH: {
      const activeWallet = getActiveWallet();
      if (!activeWallet) throw new Error('locked');
      if (!ethers.isAddress(msg.to)) throw new Error('Invalid address');
      if (!msg.amount || isNaN(parseFloat(msg.amount)) || parseFloat(msg.amount) <= 0)
        throw new Error('Invalid amount');
      const { rpcUrl, chainId } = await getActiveNetworkParams();
      const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
      const connected = activeWallet.connect(provider);

      const txRequest = {
        to: msg.to,
        value: ethers.parseEther(msg.amount),
        chainId,
      };
      // estimateGas определяет нужный лимит автоматически
      // +20% запас на случай изменения state между оценкой и отправкой
      const estimated = await provider.estimateGas(txRequest);
      txRequest.gasLimit = (estimated * 120n) / 100n;

      // 6.4: Managed nonce prevents tx replay on rapid sends
      txRequest.nonce = await getNextNonce(provider, connected.address, chainId);

      try {
        const tx = await connected.sendTransaction(txRequest);
        return { hash: tx.hash };
      } catch (err) {
        // Reset nonce cache on failure so next send re-fetches from chain
        resetNonce(connected.address, chainId);
        throw err;
      }
    }

    // Отправка ERC-20 — то же самое
    case MessageType.SEND_ERC20: {
      const activeWallet = getActiveWallet();
      if (!activeWallet) throw new Error('locked');
      if (!ethers.isAddress(msg.to)) throw new Error('Invalid address');
      if (!ethers.isAddress(msg.tokenAddress)) throw new Error('Invalid token address');
      if (!msg.amount || isNaN(parseFloat(msg.amount)) || parseFloat(msg.amount) <= 0)
        throw new Error('Invalid amount');
      if (msg.decimals == null || msg.decimals < 0 || msg.decimals > 18)
        throw new Error('Invalid decimals');
      const { rpcUrl, chainId } = await getActiveNetworkParams();
      const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
      const connected = activeWallet.connect(provider);
      const contract = new ethers.Contract(msg.tokenAddress, ERC20_ABI, connected);

      // 6.4: Managed nonce prevents tx replay on rapid sends
      const nonce = await getNextNonce(provider, connected.address, chainId);

      try {
        const tx = await contract.transfer(msg.to, ethers.parseUnits(msg.amount, msg.decimals), {
          nonce,
        });
        return { hash: tx.hash };
      } catch (err) {
        resetNonce(connected.address, chainId);
        throw err;
      }
    }

    // Создание субаккаунта — пароль используется только для derive+encrypt,
    // _wallet основного аккаунта НЕ меняется
    case MessageType.ADD_SUB_ACCOUNT: {
      if (!msg.password || typeof msg.password !== 'string') throw new Error('Invalid password');
      const { accounts = [] } = await chrome.storage.local.get(['accounts']);
      if (!accounts.length || !accounts[0].keystore) throw new Error('No accounts found');
      let main = await ethers.Wallet.fromEncryptedJson(accounts[0].keystore, msg.password);
      if (!main.mnemonic?.phrase) {
        main = null;
        throw new Error('Кошелёк без мнемоники — субаккаунты недоступны');
      }
      const nextIdx = accounts.length;
      // MED-6: временно сохраняем phrase в локальной переменной, затем
      // обнуляем ссылку на main.mnemonic чтобы GC собрал её раньше.
      const phrase = main.mnemonic.phrase;
      const newWallet = ethers.HDNodeWallet.fromPhrase(phrase, null, `m/44'/60'/0'/0/${nextIdx}`);
      const keystore = await newWallet.encrypt(msg.password);
      // Явно очищаем ссылки на sensitive data (помогает GC)
      main.mnemonic = null;
      main = null;
      return { address: newWallet.address, keystore, index: nextIdx };
    }

    // 1.1: Верификация пароля без разблокировки (re-auth перед mainnet send)
    case MessageType.VERIFY_PASSWORD: {
      if (!msg.password || typeof msg.password !== 'string') throw new Error('Invalid password');
      if (msg.accountIndex == null || typeof msg.accountIndex !== 'number')
        throw new Error('Invalid account index');
      const lockoutVP = await getLockoutState();
      if (Date.now() < lockoutVP.lockoutUntil) {
        const waitSec = Math.ceil((lockoutVP.lockoutUntil - Date.now()) / 1000);
        throw new Error(`Подождите ${waitSec} сек`);
      }
      const { accounts: accsVP } = await chrome.storage.local.get(['accounts']);
      if (!accsVP?.[msg.accountIndex]?.keystore) throw new Error('Аккаунт не найден');
      try {
        await ethers.Wallet.fromEncryptedJson(accsVP[msg.accountIndex].keystore, msg.password);
      } catch {
        await recordFailedAttempt();
        throw new Error('Неверный пароль');
      }
      await resetLockoutState();
      return {};
    }

    // Продление таймера автоблокировки при активности пользователя
    case MessageType.RESET_LOCK_TIMER: {
      if (!getActiveWallet()) return {};
      chrome.alarms.clear(LOCK_ALARM);
      const _lockMin = await getLockDelayMin();
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: _lockMin });
      return {};
    }

    case MessageType.GET_WALLET_ADDRESS: {
      return { address: getActiveWallet()?.address || null };
    }

    // Проверяет, расшифрован ли wallet для конкретного адреса в памяти SW.
    // Используется approval popup'ом чтобы показать inline-пароль если нужно.
    case MessageType.CHECK_WALLET_UNLOCKED: {
      if (!msg.address) return { unlocked: false };
      return { unlocked: _walletsByAddress.has(String(msg.address).toLowerCase()) };
    }

    // Broadcast chainChanged когда popup меняет сеть
    case MessageType.NETWORK_CHANGED: {
      const chainIdHex = typeof msg.chainIdHex === 'string' ? msg.chainIdHex : null;
      if (chainIdHex) {
        broadcastChainChanged(chainIdHex).catch(() => {});
      }
      return {};
    }

    // ── Popup → SW: approval response ──────────────────────────────────────
    case MessageType.DAPP_APPROVAL_RESPONSE: {
      return handleApprovalResponse(msg);
    }

    // Popup читает список pending approvals (для рендера approval-screen).
    // SECURITY (P1-5): мы НЕ восстанавливаем pending request'ы из persistent
    // storage после рестарта SW. Если SW был убит, _pendingApprovals Map пуст
    // → возвращаем expired. Это защищает от:
    //  1. Stale approval replay attack (user одобряет старый запрос)
    //  2. Утечки sensitive params (typed data, addresses, amounts) через storage
    case MessageType.DAPP_GET_PENDING: {
      if (msg.id) {
        const entry = _pendingApprovals.get(msg.id);
        if (!entry) {
          // SW рестартовал — pending request lost. Resolve в popup как expired.
          return { request: null, reason: 'expired' };
        }
        return {
          request: {
            id: msg.id,
            origin: entry.origin,
            method: entry.method,
            params: entry.params,
            createdAt: entry.createdAt,
            expiresAt: entry.expiresAt,
            needsUnlock: entry.needsUnlock,
            targetAccountIndex: entry.targetAccountIndex,
            targetAddress: entry.targetAddress,
          },
        };
      }
      const list = [];
      for (const [id, entry] of _pendingApprovals.entries()) {
        list.push({
          id,
          origin: entry.origin,
          method: entry.method,
          params: entry.params,
          createdAt: entry.createdAt,
          expiresAt: entry.expiresAt,
          needsUnlock: entry.needsUnlock,
          targetAccountIndex: entry.targetAccountIndex,
          targetAddress: entry.targetAddress,
        });
      }
      return { pending: list };
    }

    // Popup → SW: disconnect origin (через Connected Sites экран)
    case MessageType.DAPP_DISCONNECT_ORIGIN: {
      const origin = String(msg.origin || '').trim();
      if (!origin) throw new Error('origin required');
      const { connectedOrigins = {} } = await chrome.storage.local.get(['connectedOrigins']);
      if (connectedOrigins[origin]) {
        delete connectedOrigins[origin];
        await chrome.storage.local.set({ connectedOrigins });
        // Broadcast disconnect в этот конкретный origin
        broadcastToOrigin(origin, BroadcastEvent.DISCONNECT, null).catch(() => {});
        broadcastToOrigin(origin, BroadcastEvent.ACCOUNTS_CHANGED, []).catch(() => {});
      }
      return { ok: true };
    }

    // ── dApp → Content Script → SW ─────────────────────────────────────────
    case MessageType.DAPP_REQUEST: {
      return handleDappRequest(msg, sender);
    }

    default:
      throw new Error(`Неизвестный тип сообщения: ${msg.type}`);
  }
}

// ── dApp request entrypoint ───────────────────────────────────────────────
async function handleDappRequest(msg, sender) {
  const payload = msg.payload || {};
  const id = payload.id;
  const method = payload.method;
  const params = Array.isArray(payload.params) ? payload.params : [];

  // Проверка origin sender'а — защита от спуфинга.
  let origin = String(msg.origin || '').trim();
  try {
    if (sender && sender.tab && sender.tab.url) {
      const senderOrigin = new URL(sender.tab.url).origin;
      if (origin && senderOrigin !== origin) {
        return rpcError(id, -32603, 'Origin mismatch');
      }
      origin = senderOrigin;
    } else if (sender && sender.origin) {
      origin = sender.origin;
    }
  } catch {
    /* fallthrough */
  }

  if (!origin || !/^https?:\/\//.test(origin)) {
    return rpcError(id, -32603, 'Invalid origin');
  }

  try {
    const result = await dispatchDappMethod(origin, method, params);
    return rpcResult(id, result);
  } catch (err) {
    const code = err && typeof err.code === 'number' ? err.code : 4100;
    const message = (err && err.message) || 'Unknown error';
    return rpcError(id, code, message);
  }
}
