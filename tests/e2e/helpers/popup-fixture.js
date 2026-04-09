const path = require('path');

function createStorageArea(initialState = {}) {
  const state = { ...initialState };

  function readByKeys(keys) {
    if (keys == null) return { ...state };

    if (Array.isArray(keys)) {
      const out = {};
      for (const key of keys) {
        out[key] = state[key];
      }
      return out;
    }

    if (typeof keys === 'string') {
      return { [keys]: state[keys] };
    }

    if (typeof keys === 'object') {
      const out = {};
      for (const [key, fallback] of Object.entries(keys)) {
        out[key] = state[key] === undefined ? fallback : state[key];
      }
      return out;
    }

    return {};
  }

  return {
    get(keys, callback) {
      const out = readByKeys(keys);
      if (typeof callback === 'function') {
        callback(out);
        return;
      }
      return Promise.resolve(out);
    },
    set(next, callback) {
      Object.assign(state, next || {});
      if (typeof callback === 'function') {
        callback();
        return;
      }
      return Promise.resolve();
    },
    remove(keys, callback) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) {
        delete state[key];
      }
      if (typeof callback === 'function') {
        callback();
        return;
      }
      return Promise.resolve();
    },
    clear(callback) {
      for (const key of Object.keys(state)) {
        delete state[key];
      }
      if (typeof callback === 'function') {
        callback();
        return;
      }
      return Promise.resolve();
    },
  };
}

async function openPopupWithMocks(page, fixture = {}) {
  const localState = fixture.local || {};
  const sessionState = fixture.session || {};
  const correctPassword = fixture.correctPassword || 'Passw0rd!';
  const worker = fixture.worker || {};
  const rpc = fixture.rpc || {};

  await page.addInitScript(({ localStateArg, sessionStateArg, correctPasswordArg, workerArg, rpcArg }) => {
    const __metrics = {
      storage: {
        local: { get: 0, set: 0, remove: 0, clear: 0 },
        session: { get: 0, set: 0, remove: 0, clear: 0 },
      },
      rpc: {
        totalCalls: 0,
        methods: {},
      },
    };

    function trackStorage(areaName, op) {
      if (!__metrics.storage[areaName]) return;
      __metrics.storage[areaName][op] += 1;
    }

    function trackRpcMethod(method) {
      __metrics.rpc.totalCalls += 1;
      __metrics.rpc.methods[method] = (__metrics.rpc.methods[method] || 0) + 1;
    }

    function makeStorageArea(initial) {
      const area = {
        _state: { ...initial },
        _name: 'local',
        get(keys, callback) {
          trackStorage(area._name, 'get');
          let out;
          if (keys == null) out = { ...area._state };
          else if (Array.isArray(keys)) {
            out = {};
            for (const key of keys) out[key] = area._state[key];
          } else if (typeof keys === 'string') {
            out = { [keys]: area._state[keys] };
          } else if (typeof keys === 'object') {
            out = {};
            for (const key of Object.keys(keys)) {
              out[key] = area._state[key] === undefined ? keys[key] : area._state[key];
            }
          } else {
            out = {};
          }

          if (typeof callback === 'function') {
            callback(out);
            return;
          }
          return Promise.resolve(out);
        },
        set(next, callback) {
          trackStorage(area._name, 'set');
          Object.assign(area._state, next || {});
          if (typeof callback === 'function') {
            callback();
            return;
          }
          return Promise.resolve();
        },
        remove(keys, callback) {
          trackStorage(area._name, 'remove');
          const list = Array.isArray(keys) ? keys : [keys];
          for (const key of list) delete area._state[key];
          if (typeof callback === 'function') {
            callback();
            return;
          }
          return Promise.resolve();
        },
        clear(callback) {
          trackStorage(area._name, 'clear');
          for (const key of Object.keys(area._state)) delete area._state[key];
          if (typeof callback === 'function') {
            callback();
            return;
          }
          return Promise.resolve();
        },
      };
      return area;
    }

    const localArea = makeStorageArea(localStateArg || {});
    const sessionArea = makeStorageArea(sessionStateArg || {});
    localArea._name = 'local';
    sessionArea._name = 'session';

    const accountsState = Array.isArray(localArea._state.accounts) ? localArea._state.accounts : [];
    const preUnlockedIndexes = Array.isArray(workerArg.unlockedAccountIndexes)
      ? workerArg.unlockedAccountIndexes
      : [];
    const preUnlockedAddresses = new Set(
      preUnlockedIndexes
        .map((index) => accountsState[index]?.address)
        .filter(Boolean)
        .map((address) => String(address).toLowerCase())
    );
    const preActiveAccount = Number.isInteger(workerArg.activeAccountIndex)
      ? accountsState[workerArg.activeAccountIndex]
      : null;

    const workerState = {
      unlockedAddresses: preUnlockedAddresses,
      activeAddress: preActiveAccount ? String(preActiveAccount.address).toLowerCase() : null,
    };

    function rpcResult(id, result) {
      return { jsonrpc: '2.0', id: id ?? 1, result };
    }

    function rpcError(id, message) {
      return {
        jsonrpc: '2.0',
        id: id ?? 1,
        error: { code: -32000, message },
      };
    }

    function getActiveChainIdHex() {
      const selected = localArea._state.selectedNetwork || 'eth-sepolia';
      if (selected === 'eth-mainnet') return '0x1';
      if (selected === 'bsc') return '0x38';
      return '0xaa36a7';
    }

    function handleRpcRequest(request) {
      const method = request && request.method;
      const id = request && request.id;
      if (!method) return rpcResult(id, null);
      trackRpcMethod(method);

      if (method === 'alchemy_getAssetTransfers') {
        const params = request && Array.isArray(request.params) ? request.params[0] : {};
        const isFrom = !!params?.fromAddress;
        const isTo = !!params?.toAddress;
        const fromTransfers = Array.isArray(rpcArg.transfersFrom) ? rpcArg.transfersFrom : [];
        const toTransfers = Array.isArray(rpcArg.transfersTo) ? rpcArg.transfersTo : [];
        if (isFrom) return rpcResult(id, { transfers: fromTransfers });
        if (isTo) return rpcResult(id, { transfers: toTransfers });
        return rpcResult(id, { transfers: [] });
      }

      if (method === 'eth_chainId') {
        return rpcResult(id, getActiveChainIdHex());
      }

      if (method === 'eth_getBalance') {
        const balanceHex = rpcArg.balanceHex || '0xde0b6b3a7640000';
        return rpcResult(id, balanceHex);
      }

      if (method === 'eth_estimateGas') {
        if (rpcArg.mode === 'insufficient-funds') {
          return rpcError(id, 'insufficient funds for gas * price + value');
        }
        return rpcResult(id, '0x5208');
      }

      if (method === 'eth_gasPrice') {
        return rpcResult(id, '0x3b9aca00');
      }

      if (method === 'eth_maxPriorityFeePerGas') {
        return rpcResult(id, '0x59682f00');
      }

      if (method === 'eth_getBlockByNumber') {
        return rpcResult(id, {
          baseFeePerGas: '0x3b9aca00',
        });
      }

      return rpcResult(id, null);
    }

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      try {
        if (rpcArg.mode === 'http-error') {
          trackRpcMethod('http-error');
          return new Response('upstream error', { status: 503 });
        }
        const payload = init && init.body ? JSON.parse(String(init.body)) : null;
        if (!payload) return originalFetch(url, init);

        const responseJson = Array.isArray(payload)
          ? payload.map((item) => handleRpcRequest(item))
          : handleRpcRequest(payload);

        return new Response(JSON.stringify(responseJson), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        return originalFetch(url, init);
      }
    };

    const runtime = {
      sendMessage(msg, callback) {
        Promise.resolve().then(async () => {
          const { accounts = [] } = await localArea.get(['accounts']);

          if (!msg || !msg.type) {
            callback({ ok: false, error: 'Unknown message' });
            return;
          }

          if (msg.type === 'unlock') {
            if (msg.password !== correctPasswordArg) {
              callback({ ok: false, error: 'Неверный пароль' });
              return;
            }
            const account = accounts[msg.accountIndex];
            if (!account) {
              callback({ ok: false, error: 'Аккаунт не найден' });
              return;
            }
            const key = String(account.address).toLowerCase();
            workerState.unlockedAddresses.add(key);
            workerState.activeAddress = key;
            await sessionArea.set({ unlocked: true, unlockTime: Date.now() });
            callback({ ok: true });
            return;
          }

          if (msg.type === 'get-wallet-address') {
            callback({ ok: true, address: workerState.activeAddress });
            return;
          }

          if (msg.type === 'activate-account') {
            const account = accounts[msg.accountIndex];
            const key = account ? String(account.address).toLowerCase() : null;
            if (key && workerState.unlockedAddresses.has(key)) {
              workerState.activeAddress = key;
              await sessionArea.set({ unlocked: true, unlockTime: Date.now() });
              callback({ ok: true, activated: true, address: account.address });
              return;
            }
            callback({ ok: true, activated: false, address: account?.address || null });
            return;
          }

          if (msg.type === 'lock') {
            workerState.unlockedAddresses.clear();
            workerState.activeAddress = null;
            await sessionArea.clear();
            callback({ ok: true });
            return;
          }

          if (msg.type === 'reset-lock-timer') {
            callback({ ok: true });
            return;
          }

          if (msg.type === 'send-eth') {
            if (!workerState.activeAddress) {
              callback({ ok: false, error: 'locked' });
              return;
            }
            if (workerArg.sendEthError) {
              callback({ ok: false, error: workerArg.sendEthError });
              return;
            }
            callback({ ok: true, hash: workerArg.sendEthHash || `0x${'a'.repeat(64)}` });
            return;
          }

          if (msg.type === 'send-erc20') {
            if (!workerState.activeAddress) {
              callback({ ok: false, error: 'locked' });
              return;
            }
            if (workerArg.sendErc20Error) {
              callback({ ok: false, error: workerArg.sendErc20Error });
              return;
            }
            callback({ ok: true, hash: workerArg.sendErc20Hash || `0x${'b'.repeat(64)}` });
            return;
          }

          if (msg.type === 'add-sub-account') {
            const nextIndex = accounts.length;
            const resultAddress = workerArg.subAccountAddress || `0x${'d'.repeat(39)}${(nextIndex + 1).toString(16)}`;
            const resultKeystore = workerArg.subAccountKeystore || `mock-sub-keystore-${nextIndex + 1}`;
            callback({
              ok: true,
              index: nextIndex,
              address: resultAddress,
              keystore: resultKeystore,
            });
            return;
          }

          callback({ ok: false, error: `Unknown message type: ${msg.type}` });
        });

        return true;
      },
      onMessage: {
        addListener() {},
      },
      onInstalled: {
        addListener() {},
      },
    };

    window.chrome = {
      runtime,
      alarms: {
        create() {},
        clear() {},
        onAlarm: { addListener() {} },
      },
      storage: {
        local: localArea,
        session: sessionArea,
      },
    };

    window.__testHooks = {
      dropWorkerWallet() {
        workerState.unlockedAddresses.clear();
        workerState.activeAddress = null;
      },
      getMetrics() {
        return JSON.parse(JSON.stringify(__metrics));
      },
      resetMetrics() {
        __metrics.storage.local = { get: 0, set: 0, remove: 0, clear: 0 };
        __metrics.storage.session = { get: 0, set: 0, remove: 0, clear: 0 };
        __metrics.rpc.totalCalls = 0;
        __metrics.rpc.methods = {};
      },
    };
  }, {
    localStateArg: localState,
    sessionStateArg: sessionState,
    correctPasswordArg: correctPassword,
    workerArg: worker,
    rpcArg: rpc,
  });

  const popupPath = path.resolve(__dirname, '../../../extension/popup/popup.html');
  await page.goto(`file://${popupPath}`);
}

async function getActiveScreenId(page) {
  return page.evaluate(() => {
    const node = document.querySelector('.screen.active');
    return node ? node.id : null;
  });
}

module.exports = {
  createStorageArea,
  getActiveScreenId,
  openPopupWithMocks,
};
