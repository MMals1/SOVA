/**
 * dev-polyfill.js — только для локальной разработки через HTTP сервер.
 *
 * Заменяет chrome.storage.local   → localStorage
 *          chrome.storage.session → sessionStorage
 *          chrome.runtime         → mock с полной логикой SW
 *
 * В реальном расширении этот файл НЕ подключается.
 */

// ── Mock wallet — зеркало _wallet из service-worker.js ───────────────────────
// ethers.js уже загружен до этого файла (см. dev.html)
let _devWallet = null;

const DEV_RPC     = 'https://eth-sepolia.g.alchemy.com/v2/lrmoWsP5qrMt8_aezkh4p';
const DEV_CHAIN   = 11155111;
const ERC20_TRANS = ['function transfer(address to, uint256 value) returns (bool)'];

async function handleDevMessage(msg) {
  switch (msg.type) {

    case 'unlock': {
      // Читаем accounts из dev localStorage
      const raw      = localStorage.getItem('dev_local_accounts');
      const accounts = raw ? JSON.parse(raw) : [];
      if (!accounts[msg.accountIndex]?.keystore) throw new Error('Аккаунт не найден');
      _devWallet = await ethers.Wallet.fromEncryptedJson(
        accounts[msg.accountIndex].keystore, msg.password
      );
      sessionStorage.setItem('dev_session_unlocked',   JSON.stringify(true));
      sessionStorage.setItem('dev_session_unlockTime', JSON.stringify(Date.now()));
      return {};
    }

    case 'lock': {
      _devWallet = null;
      Object.keys(sessionStorage)
        .filter(k => k.startsWith('dev_session_'))
        .forEach(k => sessionStorage.removeItem(k));
      return {};
    }

    case 'send-eth': {
      if (!_devWallet) throw new Error('locked');
      const savedRpc  = localStorage.getItem('dev_local_rpcUrl');
      const activeRpc = savedRpc ? JSON.parse(savedRpc) : DEV_RPC;
      const provider  = new ethers.JsonRpcProvider(activeRpc);
      const connected = _devWallet.connect(provider);
      const tx = await connected.sendTransaction({
        to:       msg.to,
        value:    ethers.parseEther(msg.amount),
        gasLimit: 21000n,
        chainId:  DEV_CHAIN,
      });
      return { hash: tx.hash };
    }

    case 'send-erc20': {
      if (!_devWallet) throw new Error('locked');
      const savedRpc2 = localStorage.getItem('dev_local_rpcUrl');
      const activeRpc2 = savedRpc2 ? JSON.parse(savedRpc2) : DEV_RPC;
      const provider  = new ethers.JsonRpcProvider(activeRpc2);
      const connected = _devWallet.connect(provider);
      const contract  = new ethers.Contract(msg.tokenAddress, ERC20_TRANS, connected);
      const tx = await contract.transfer(
        msg.to, ethers.parseUnits(msg.amount, msg.decimals)
      );
      return { hash: tx.hash };
    }

    case 'add-sub-account': {
      const raw      = localStorage.getItem('dev_local_accounts');
      const accounts = raw ? JSON.parse(raw) : [];
      const main     = await ethers.Wallet.fromEncryptedJson(accounts[0].keystore, msg.password);
      if (!main.mnemonic?.phrase) throw new Error('Кошелёк без мнемоники — субаккаунты недоступны');
      const nextIdx   = accounts.length;
      const newWallet = ethers.HDNodeWallet.fromPhrase(
        main.mnemonic.phrase, null, `m/44'/60'/0'/0/${nextIdx}`
      );
      const keystore = await newWallet.encrypt(msg.password);
      return { address: newWallet.address, keystore, index: nextIdx };
    }

    default:
      throw new Error(`Неизвестный тип: ${msg.type}`);
  }
}

// ── chrome API mock ───────────────────────────────────────────────────────────
window.chrome = {
  storage: {
    local: {
      get(keys, cb) {
        const result = {};
        const list   = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
        list.forEach(k => {
          const raw = localStorage.getItem('dev_local_' + k);
          if (raw !== null) result[k] = JSON.parse(raw);
        });
        cb(result);
      },
      set(data, cb) {
        Object.entries(data).forEach(([k, v]) =>
          localStorage.setItem('dev_local_' + k, JSON.stringify(v))
        );
        if (cb) cb();
      },
      remove(keys, cb) {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach(k => localStorage.removeItem('dev_local_' + k));
        if (cb) cb();
      },
      clear(cb) {
        Object.keys(localStorage)
          .filter(k => k.startsWith('dev_local_'))
          .forEach(k => localStorage.removeItem(k));
        if (cb) cb();
      },
    },

    session: {
      get(keys, cb) {
        const result = {};
        const list   = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys));
        list.forEach(k => {
          const raw = sessionStorage.getItem('dev_session_' + k);
          if (raw !== null) result[k] = JSON.parse(raw);
        });
        cb(result);
      },
      set(data, cb) {
        Object.entries(data).forEach(([k, v]) =>
          sessionStorage.setItem('dev_session_' + k, JSON.stringify(v))
        );
        if (cb) cb();
      },
      clear(cb) {
        Object.keys(sessionStorage)
          .filter(k => k.startsWith('dev_session_'))
          .forEach(k => sessionStorage.removeItem(k));
        if (cb) cb();
      },
    },
  },

  runtime: {
    // Полная имитация SW: handleDevMessage зеркалит service-worker.js
    sendMessage(msg, callback) {
      handleDevMessage(msg)
        .then(result => callback({ ok: true,  ...result }))
        .catch(err   => callback({ ok: false, error: err.message }));
    },
    onMessage:   { addListener() {} },
    onInstalled: { addListener() {} },
  },

  alarms: {
    create() {},
    clear()  {},
    onAlarm: { addListener() {} },
  },
};

console.info('%c[DEV] Chrome API polyfill активен', 'color:#4ade80;font-weight:bold');
