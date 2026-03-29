'use strict';

// Ethers.js нужен SW для расшифровки keystore и подписи транзакций
importScripts('../libs/ethers.umd.min.js');

const RPC_URL        = 'https://eth-sepolia.g.alchemy.com/v2/lrmoWsP5qrMt8_aezkh4p';
const CHAIN_ID       = 11155111;
const LOCK_ALARM     = 'auto-lock';
const LOCK_DELAY_MIN = 5;

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
];

// ── Единственное место в приложении где живёт расшифрованный ключ ─────────────
// Popup.js доступа к этой переменной не имеет — она изолирована в SW контексте.
// Если Chrome убивает SW в фоне — _wallet сбрасывается, пользователь должен
// разблокировать снова (стандартное поведение, как у MetaMask).
let _wallet = null;

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
      const { accounts } = await chrome.storage.local.get(['accounts']);
      if (!accounts?.[msg.accountIndex]?.keystore) {
        throw new Error('Аккаунт не найден');
      }
      // fromEncryptedJson бросает ошибку если пароль неверный — catch в popup покажет "Неверный пароль"
      _wallet = await ethers.Wallet.fromEncryptedJson(
        accounts[msg.accountIndex].keystore,
        msg.password
      );
      await chrome.storage.session.set({ unlocked: true, unlockTime: Date.now() });
      chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
      return {};
    }

    // Блокируем — обнуляем ключ из памяти
    case 'lock': {
      _wallet = null;
      await chrome.storage.session.clear();
      chrome.alarms.clear(LOCK_ALARM);
      return {};
    }

    // Отправка ETH — подписываем здесь, в popup приватный ключ не попадает
    case 'send-eth': {
      if (!_wallet) throw new Error('locked');
      const { rpcUrl } = await chrome.storage.local.get(['rpcUrl']);
      const provider  = new ethers.JsonRpcProvider(rpcUrl || RPC_URL);
      const connected = _wallet.connect(provider);
      const tx = await connected.sendTransaction({
        to:       msg.to,
        value:    ethers.parseEther(msg.amount),
        gasLimit: 21000n,
        chainId:  CHAIN_ID,
      });
      return { hash: tx.hash };
    }

    // Отправка ERC-20 — то же самое
    case 'send-erc20': {
      if (!_wallet) throw new Error('locked');
      const { rpcUrl } = await chrome.storage.local.get(['rpcUrl']);
      const provider  = new ethers.JsonRpcProvider(rpcUrl || RPC_URL);
      const connected = _wallet.connect(provider);
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
      const { accounts = [] } = await chrome.storage.local.get(['accounts']);
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

    default:
      throw new Error(`Неизвестный тип сообщения: ${msg.type}`);
  }
}

// ── Автоблокировка ────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === LOCK_ALARM) {
    _wallet = null;                    // ключ уничтожен
    chrome.storage.session.clear();    // popup увидит что сессия сброшена
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(LOCK_ALARM, { delayInMinutes: LOCK_DELAY_MIN });
});
