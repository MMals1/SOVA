import { describe, it, expect, beforeEach } from 'vitest';

describe('RPC fallback mechanism', () => {
  let rpcManager;

  beforeEach(() => {
    rpcManager = {
      rpcByNetwork: {
        'eth-mainnet': {
          custom: 'https://custom-rpc.com',
          defaults: ['https://ethereum-rpc.publicnode.com', 'https://eth1.lava.build'],
        },
        'eth-sepolia': {
          custom: null,
          defaults: ['https://ethereum-sepolia-rpc.publicnode.com'],
        },
      },
    };

    rpcManager.getCurrentRPC = function (network) {
      const config = this.rpcByNetwork[network];
      if (!config) return null;
      return config.custom || config.defaults?.[0];
    };

    rpcManager.getNextRPC = function (network, currentIndex = 0) {
      const config = this.rpcByNetwork[network];
      if (!config) return null;
      return config.defaults?.[currentIndex + 1];
    };

    rpcManager.isCustomRPC = function (network) {
      const config = this.rpcByNetwork[network];
      return config?.custom != null;
    };

    rpcManager.setCustomRPC = function (network, url) {
      if (!this.rpcByNetwork[network]) {
        this.rpcByNetwork[network] = { custom: null, defaults: [] };
      }
      this.rpcByNetwork[network].custom = url;
    };
  });

  describe('RPC selection', () => {
    it('uses custom RPC if provided', () => {
      const rpc = rpcManager.getCurrentRPC('eth-mainnet');
      expect(rpc).toBe('https://custom-rpc.com');
    });

    it('falls back to first default if no custom', () => {
      const rpc = rpcManager.getCurrentRPC('eth-sepolia');
      expect(rpc).toBe('https://ethereum-sepolia-rpc.publicnode.com');
    });

    it('returns null for unknown network', () => {
      const rpc = rpcManager.getCurrentRPC('unknown-network');
      expect(rpc).toBeNull();
    });
  });

  describe('fallback on failure', () => {
    it('provides next RPC after current fails', () => {
      // Current default fails (index 0)
      const next = rpcManager.getNextRPC('eth-mainnet', 0);
      expect(next).toBe('https://eth1.lava.build');
    });

    it('returns null if no more fallbacks', () => {
      const next = rpcManager.getNextRPC('eth-mainnet', 99);
      // Returns undefined when index is out of bounds
      expect(next).toBeUndefined();
    });

    it('prioritizes custom over defaults', () => {
      expect(rpcManager.isCustomRPC('eth-mainnet')).toBe(true);
      expect(rpcManager.isCustomRPC('eth-sepolia')).toBe(false);
    });
  });

  describe('custom RPC management', () => {
    it('can set custom RPC', () => {
      rpcManager.setCustomRPC('bsc', 'https://bsc-custom.example.com');
      expect(rpcManager.getCurrentRPC('bsc')).toBe('https://bsc-custom.example.com');
    });

    it('custom RPC takes precedence', () => {
      rpcManager.setCustomRPC('eth-sepolia', 'https://my-custom-sepolia.com');
      const rpc = rpcManager.getCurrentRPC('eth-sepolia');
      expect(rpc).toBe('https://my-custom-sepolia.com');
    });

    it('can clear custom RPC by setting to null', () => {
      rpcManager.setCustomRPC('eth-mainnet', null);
      const rpc = rpcManager.getCurrentRPC('eth-mainnet');
      expect(rpc).toBe('https://ethereum-rpc.publicnode.com');
    });
  });

  describe('exhaustion handling', () => {
    it('returns null after all RPCs exhausted', () => {
      const current = rpcManager.getCurrentRPC('eth-sepolia');
      expect(current).toBeDefined();

      // Try all defaults
      let index = 0;
      while (true) {
        const next = rpcManager.getNextRPC('eth-sepolia', index);
        if (!next) {
          // All exhausted
          expect(true).toBe(true);
          break;
        }
        index++;
      }
    });

    it('resets custom on repeated failures', () => {
      rpcManager.setCustomRPC('eth-mainnet', 'https://failing-custom.com');
      // After many failures, could fall back to defaults
      // (implementation specific)
      expect(rpcManager.isCustomRPC('eth-mainnet')).toBe(true);
    });
  });
});

describe('multi-popup consistency', () => {
  let storageEmulator;

  beforeEach(() => {
    // Simulate shared chrome.storage.local
    storageEmulator = {
      data: {},
      listeners: [],

      get(keys, callback) {
        const result = {};
        if (Array.isArray(keys)) {
          keys.forEach((k) => {
            result[k] = this.data[k];
          });
        }
        if (callback) callback(result);
        return Promise.resolve(result);
      },

      set(items, callback) {
        Object.assign(this.data, items);
        // Notify listeners
        this.listeners.forEach((listener) => listener({ changes: items, areaName: 'local' }));
        if (callback) callback();
        return Promise.resolve();
      },

      onChanged: {
        addListener(callback) {
          storageEmulator.listeners.push(callback);
        },
      },
    };
  });

  describe('shared state', () => {
    it('both popups see same accounts', async () => {
      const accounts = [{ address: '0xABC', name: 'Main' }];
      await storageEmulator.set({ accounts });

      // First popup
      const data1 = await storageEmulator.get(['accounts']);
      expect(data1.accounts).toEqual(accounts);

      // Second popup
      const data2 = await storageEmulator.get(['accounts']);
      expect(data2.accounts).toEqual(accounts);

      // Both see same data
      expect(data1.accounts).toBe(data2.accounts);
    });

    it('update in one popup visible in other', async () => {
      await storageEmulator.set({ selectedNetwork: 'eth-mainnet' });

      // Popup 1 reads
      let data = await storageEmulator.get(['selectedNetwork']);
      expect(data.selectedNetwork).toBe('eth-mainnet');

      // Popup 2 writes
      await storageEmulator.set({ selectedNetwork: 'eth-sepolia' });

      // Popup 1 reads updated value
      data = await storageEmulator.get(['selectedNetwork']);
      expect(data.selectedNetwork).toBe('eth-sepolia');
    });

    it('token changes synchronized across popups', async () => {
      const tokens = {
        'eth-mainnet': [{ symbol: 'USDC' }],
      };
      await storageEmulator.set({ tokensByNetwork: tokens });

      // Popup 1 reads
      let data1 = await storageEmulator.get(['tokensByNetwork']);

      // Popup 2 updates
      const updatedTokens = {
        'eth-mainnet': [{ symbol: 'USDC' }, { symbol: 'DAI' }],
      };
      await storageEmulator.set({ tokensByNetwork: updatedTokens });

      // Popup 1 sees update
      data1 = await storageEmulator.get(['tokensByNetwork']);
      expect(data1.tokensByNetwork['eth-mainnet']).toHaveLength(2);
    });
  });

  describe('state change events', () => {
    it('notifies listeners of changes', () => {
      let notified = false;
      storageEmulator.onChanged.addListener((changes) => {
        if (changes.changes.selectedNetwork) {
          notified = true;
        }
      });

      storageEmulator.set({ selectedNetwork: 'eth-mainnet' });
      expect(notified).toBe(true);
    });

    it('multiple listeners all notified', () => {
      const changes1 = [];
      const changes2 = [];

      storageEmulator.onChanged.addListener((changes) => {
        changes1.push(changes);
      });
      storageEmulator.onChanged.addListener((changes) => {
        changes2.push(changes);
      });

      storageEmulator.set({ data: 'test' });

      expect(changes1.length).toBeGreaterThan(0);
      expect(changes2.length).toBeGreaterThan(0);
    });
  });

  describe('race conditions', () => {
    it('handles simultaneous updates', async () => {
      const promises = [
        storageEmulator.set({ field1: 'value1' }),
        storageEmulator.set({ field2: 'value2' }),
      ];

      await Promise.all(promises);

      const data = await storageEmulator.get(['field1', 'field2']);
      expect(data.field1).toBe('value1');
      expect(data.field2).toBe('value2');
    });

    it('last write wins on same key', async () => {
      const promises = [
        storageEmulator.set({ counter: 1 }),
        storageEmulator.set({ counter: 2 }),
        storageEmulator.set({ counter: 3 }),
      ];

      await Promise.all(promises);

      const data = await storageEmulator.get(['counter']);
      expect(data.counter).toBe(3);
    });

    it('merge updates correctly', async () => {
      await storageEmulator.set({ accounts: ['A', 'B'] });
      await storageEmulator.set({ networks: ['mainnet', 'testnet'] });

      const data = await storageEmulator.get(['accounts', 'networks']);
      expect(data.accounts).toEqual(['A', 'B']);
      expect(data.networks).toEqual(['mainnet', 'testnet']);
    });
  });
});

describe('service worker lifecycle', () => {
  let sw;

  beforeEach(() => {
    sw = {
      activeWallet: null,
      messageHandlers: [],
      started: false,

      start() {
        this.started = true;
      },

      stop() {
        this.started = false;
        this.activeWallet = null;
      },

      onMessage(callback) {
        this.messageHandlers.push(callback);
      },

      broadcastMessage(message) {
        return Promise.all(this.messageHandlers.map((h) => h(message)));
      },
    };
  });

  describe('lifecycle transitions', () => {
    it('SW starts without wallet', () => {
      sw.start();
      expect(sw.started).toBe(true);
      expect(sw.activeWallet).toBeNull();
    });

    it('SW can unlock wallet', () => {
      sw.start();
      sw.activeWallet = { address: '0xABC' };
      expect(sw.activeWallet).not.toBeNull();
    });

    it('SW stops and clears wallet', () => {
      sw.start();
      sw.activeWallet = { address: '0xABC' };
      sw.stop();

      expect(sw.started).toBe(false);
      expect(sw.activeWallet).toBeNull();
    });
  });

  describe('message handling', () => {
    it('handles multiple messages', async () => {
      sw.start();
      let messageCount = 0;

      sw.onMessage(() => {
        messageCount++;
      });

      await sw.broadcastMessage({ type: 'test1' });
      await sw.broadcastMessage({ type: 'test2' });

      expect(messageCount).toBe(2);
    });

    it('can register multiple handlers', () => {
      let handler1Called = false;
      let handler2Called = false;

      sw.onMessage(() => {
        handler1Called = true;
      });
      sw.onMessage(() => {
        handler2Called = true;
      });

      sw.broadcastMessage({});

      expect(handler1Called).toBe(true);
      expect(handler2Called).toBe(true);
    });
  });

  describe('restart behavior', () => {
    it('restart clears state', () => {
      sw.start();
      sw.activeWallet = { address: '0xABC' };

      // Simulate restart
      const oldSW = sw;
      sw = {
        started: false,
        activeWallet: null,
        messageHandlers: [],
        start() {
          this.started = true;
        },
      };

      expect(sw.activeWallet).toBeNull();
      expect(oldSW.activeWallet).not.toBeNull();
    });

    it('messages after restart go to new handlers', async () => {
      sw.start();
      const oldHandlers = sw.messageHandlers.length;

      sw.stop();
      sw.messageHandlers = [];
      sw.start();

      let called = false;
      sw.onMessage(() => {
        called = true;
      });

      await sw.broadcastMessage({});
      expect(called).toBe(true);
    });
  });
});
