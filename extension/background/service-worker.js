'use strict';

// Ethers.js нужен SW для расшифровки keystore и подписи транзакций
importScripts('../libs/ethers.umd.min.js');
importScripts('../network-config.js');

const RPC_DEFAULTS = (globalThis.WOLF_WALLET_RPC_DEFAULTS && typeof globalThis.WOLF_WALLET_RPC_DEFAULTS === 'object')
  ? globalThis.WOLF_WALLET_RPC_DEFAULTS
  : {};

function getDefaultRpcUrl(networkKey, fallback) {
  return RPC_DEFAULTS[networkKey] || fallback;
}

const NETWORKS = {
  'eth-mainnet': {
    chainId: 1,
    defaultRpcUrl: getDefaultRpcUrl('eth-mainnet', 'https://ethereum-rpc.publicnode.com'),
  },
  'eth-sepolia': {
    chainId: 11155111,
    defaultRpcUrl: getDefaultRpcUrl('eth-sepolia', 'https://ethereum-sepolia-rpc.publicnode.com'),
  },
};
const DEFAULT_NETWORK_KEY = 'eth-sepolia';
const LOCK_ALARM     = 'auto-lock';
const LOCK_DELAY_MIN = 5;

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
];

// ── Единственное место в приложении где живёт расшифрованный ключ ─────────────
// Popup.js доступа к этой переменной не имеет — она изолирована в SW контексте.
// Если Chrome убивает SW в фоне — _wallet сбрасывается, пользователь должен
// разблокировать снова (стандартное поведение, как у MetaMask).
const _walletsByAddress = new Map();
let _activeWalletAddress = null;
let _failedAttempts = 0;
let _lockoutUntil   = 0;

function getActiveWallet() {
  if (!_activeWalletAddress) return null;
  return _walletsByAddress.get(_activeWalletAddress) || null;
}

function clearUnlockedWallets() {
  _walletsByAddress.clear();
  _activeWalletAddress = null;
}

// ── Обработка сообщений от popup ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(result => sendResponse({ ok: true,  ...result }))
    .catch(err   => sendResponse({ ok: false, error: err.message }));
  return true; // держим канал открытым для async ответа
});

async function handleMessage(msg) {
  switch (msg.type) {

    // Расшифровываем keystore и сохраняем wallet в памяти SW
    case 'unlock': {
      if (msg.accountIndex == null || typeof msg.accountIndex !== 'number')
        throw new Error('Invalid account index');
      if (!msg.password || typeof msg.password !== 'string')
        throw new Error('Invalid password');
      if (Date.now() < _lockoutUntil) {
        const waitSec = Math.ceil((_lockoutUntil - Date.now()) / 1000);
        throw new Error(`Подождите ${waitSec} сек`);
      }
      const { accounts } = await chrome.storage.local.get(['accounts']);
      if (!accounts?.[msg.accountIndex]?.keystore) {
        throw new Error('Аккаунт не найден');
      }
      try {
        const unlockedWallet = await ethers.Wallet.fromEncryptedJson(
          accounts[msg.accountIndex].keystore,
          msg.password
        );
        const walletKey = String(unlockedWallet.address).toLowerCase();
        _walletsByAddress.set(walletKey, unlockedWallet);
        _activeWalletAddress = walletKey;
      } catch {
        _failedAttempts++;
        if (_failedAttempts >= 3) {
          _lockoutUntil = Date.now() + Math.min(60000, 5000 * (_failedAttempts - 2));
        }
        throw new Error('Неверный пароль');
      }
      _failedAttempts = 0;
      await chrome.storage.session.set({ unlocked: true, unlockTime: Date.now() });
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
      return {};
    }

    // Блокируем — обнуляем ключ из памяти
    case 'lock': {
      clearUnlockedWallets();
      await chrome.storage.session.clear();
      chrome.alarms.clear(LOCK_ALARM);
      return {};
    }

    case 'activate-account': {
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
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
      return { activated: true, address: targetAddress };
    }

    // Отправка ETH — подписываем здесь, в popup приватный ключ не попадает
    case 'send-eth': {
      const activeWallet = getActiveWallet();
      if (!activeWallet) throw new Error('locked');
      if (!ethers.isAddress(msg.to)) throw new Error('Invalid address');
      if (!msg.amount || isNaN(parseFloat(msg.amount)) || parseFloat(msg.amount) <= 0)
        throw new Error('Invalid amount');
      const { rpcUrl, chainId } = await getActiveNetworkParams();
      const provider  = new ethers.JsonRpcProvider(rpcUrl);
      const connected = activeWallet.connect(provider);

      const txRequest = {
        to:      msg.to,
        value:   ethers.parseEther(msg.amount),
        chainId,
      };
      // estimateGas определяет нужный лимит автоматически
      // +20% запас на случай изменения state между оценкой и отправкой
      const estimated = await provider.estimateGas(txRequest);
      txRequest.gasLimit = estimated * 120n / 100n;

      const tx = await connected.sendTransaction(txRequest);
      return { hash: tx.hash };
    }

    // Отправка ERC-20 — то же самое
    case 'send-erc20': {
      const activeWallet = getActiveWallet();
      if (!activeWallet) throw new Error('locked');
      if (!ethers.isAddress(msg.to)) throw new Error('Invalid address');
      if (!ethers.isAddress(msg.tokenAddress)) throw new Error('Invalid token address');
      if (!msg.amount || isNaN(parseFloat(msg.amount)) || parseFloat(msg.amount) <= 0)
        throw new Error('Invalid amount');
      if (msg.decimals == null || msg.decimals < 0 || msg.decimals > 18)
        throw new Error('Invalid decimals');
      const { rpcUrl } = await getActiveNetworkParams();
      const provider  = new ethers.JsonRpcProvider(rpcUrl);
      const connected = activeWallet.connect(provider);
      const contract  = new ethers.Contract(msg.tokenAddress, ERC20_ABI, connected);
      const tx = await contract.transfer(
        msg.to,
        ethers.parseUnits(msg.amount, msg.decimals)
      );
      return { hash: tx.hash };
    }

    // Создание субаккаунта — пароль используется только для derive+encrypt,
    // _wallet основного аккаунта НЕ меняется
    case 'add-sub-account': {
      if (!msg.password || typeof msg.password !== 'string')
        throw new Error('Invalid password');
      const { accounts = [] } = await chrome.storage.local.get(['accounts']);
      if (!accounts.length || !accounts[0].keystore)
        throw new Error('No accounts found');
      const main = await ethers.Wallet.fromEncryptedJson(accounts[0].keystore, msg.password);
      if (!main.mnemonic?.phrase) {
        throw new Error('Кошелёк без мнемоники — субаккаунты недоступны');
      }
      const nextIdx   = accounts.length;
      const newWallet = ethers.HDNodeWallet.fromPhrase(
        main.mnemonic.phrase, null, `m/44'/60'/0'/0/${nextIdx}`
      );
      const keystore = await newWallet.encrypt(msg.password);
      return { address: newWallet.address, keystore, index: nextIdx };
    }

    // Продление таймера автоблокировки при активности пользователя
    case 'reset-lock-timer': {
      if (!getActiveWallet()) return {};
      chrome.alarms.clear(LOCK_ALARM);
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
      return {};
    }

    case 'get-wallet-address': {
      return { address: getActiveWallet()?.address || null };
    }

    default:
      throw new Error(`Неизвестный тип сообщения: ${msg.type}`);
  }
}

async function getActiveNetworkParams() {
  const { selectedNetwork, rpcByNetwork, rpcUrl } = await chrome.storage.local.get([
    'selectedNetwork',
    'rpcByNetwork',
    'rpcUrl',
  ]);

  const networkKey = NETWORKS[selectedNetwork] ? selectedNetwork : DEFAULT_NETWORK_KEY;
  const fallbackMap = (rpcByNetwork && typeof rpcByNetwork === 'object') ? rpcByNetwork : {};
  const activeRpcUrl = fallbackMap[networkKey] || rpcUrl || NETWORKS[networkKey].defaultRpcUrl;
  const chainId = NETWORKS[networkKey].chainId;

  return { rpcUrl: activeRpcUrl, chainId };
}

// ── Автоблокировка ────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === LOCK_ALARM) {
    clearUnlockedWallets();            // ключи уничтожены
    chrome.storage.session.clear();    // popup увидит что сессия сброшена
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
});
