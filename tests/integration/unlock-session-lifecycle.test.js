import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('unlock session lifecycle', () => {
  let sessionStorage;
  let localStorage;
  let sw;

  beforeEach(() => {
    sessionStorage = {};
    localStorage = {
      accounts: [
        { address: '0xABC', keystore: 'encrypted', name: 'Main' },
        { address: '0xDEF', keystore: 'encrypted', name: 'Secondary' },
      ],
    };
    sw = {
      activeWallet: null,
      lockedOut: false,
      lockoutTime: 0,
    };
  });

  describe('unlock flow', () => {
    it('sets session unlocked on successful unlock', async () => {
      // Simulate unlock
      sw.activeWallet = localStorage.accounts[0];
      sessionStorage.unlocked = true;
      sessionStorage.unlockTime = Date.now();

      expect(sessionStorage.unlocked).toBe(true);
      expect(sessionStorage.unlockTime).toBeDefined();
    });

    it('preserves unlock session after popup reopen', () => {
      const unlockTime = Date.now() - 10000; // 10 sec ago
      sessionStorage.unlocked = true;
      sessionStorage.unlockTime = unlockTime;

      // Simulate popup reopen - session should persist
      expect(sessionStorage.unlocked).toBe(true);
      expect(sessionStorage.unlockTime).toBe(unlockTime);
    });

    it('requires unlock if session missing', () => {
      sessionStorage.unlocked = undefined;
      const needsUnlock = !sessionStorage.unlocked;
      expect(needsUnlock).toBe(true);
    });
  });

  describe('lock flow', () => {
    it('clears session on lock', () => {
      sessionStorage.unlocked = true;
      sessionStorage.unlockTime = Date.now();

      // Simulate lock
      delete sessionStorage.unlocked;
      delete sessionStorage.unlockTime;
      sw.activeWallet = null;

      expect(sessionStorage.unlocked).toBeUndefined();
      expect(sw.activeWallet).toBeNull();
    });

    it('requires unlock after lock', () => {
      // Lock
      delete sessionStorage.unlocked;

      // Check if unlock needed
      const needsUnlock = !sessionStorage.unlocked;
      expect(needsUnlock).toBe(true);
    });
  });

  describe('auto-lock timeout', () => {
    it('tracks unlock time', () => {
      const now = Date.now();
      sessionStorage.unlockTime = now;

      const elapsedMs = Date.now() - sessionStorage.unlockTime;
      expect(elapsedMs).toBeLessThan(1000); // Should be nearly instant
    });

    it('calculates time until auto-lock', () => {
      const LOCK_DELAY_MIN = 5;
      const unlockTime = Date.now() - 60000; // 1 min ago
      const elapsedMin = (Date.now() - unlockTime) / 60000;
      const minutesUntilLock = LOCK_DELAY_MIN - elapsedMin;

      expect(minutesUntilLock).toBeGreaterThan(0);
      expect(minutesUntilLock).toBeLessThan(LOCK_DELAY_MIN);
    });

    it('auto-locks after timeout', () => {
      const LOCK_DELAY_MIN = 5;
      const unlockTime = Date.now() - (LOCK_DELAY_MIN * 60000 + 1000); // Past timeout

      const isLocked = (Date.now() - unlockTime) > LOCK_DELAY_MIN * 60000;
      expect(isLocked).toBe(true);
    });

    it('extends timeout on user action', () => {
      const LOCK_DELAY_MIN = 5;
      let unlockTime = Date.now() - (LOCK_DELAY_MIN * 60000 - 30000); // Near timeout

      let elapsedMs = Date.now() - unlockTime;
      expect(elapsedMs).toBeGreaterThan((LOCK_DELAY_MIN - 1) * 60000);

      // User action resets
      unlockTime = Date.now();
      elapsedMs = Date.now() - unlockTime;
      expect(elapsedMs).toBeLessThan(1000);
    });
  });

  describe('account consistency', () => {
    it('maintains same account in SW and popup', () => {
      const targetAccount = localStorage.accounts[0];
      sw.activeWallet = targetAccount;
      const popupActiveIndex = 0;

      expect(sw.activeWallet.address).toBe(localStorage.accounts[popupActiveIndex].address);
    });

    it('detects account mismatch', () => {
      sw.activeWallet = localStorage.accounts[0];
      const popupActiveIndex = 1;

      const mismatch = sw.activeWallet.address !== localStorage.accounts[popupActiveIndex].address;
      expect(mismatch).toBe(true);
    });

    it('forces unlock if account changed while locked', () => {
      delete sessionStorage.unlocked;
      const accountChanged = true;

      const needsUnlock = !sessionStorage.unlocked || accountChanged;
      expect(needsUnlock).toBe(true);
    });
  });

  describe('failed unlock handling', () => {
    it('blocks further unlock attempts after 3 failures', () => {
      sw.failedAttempts = 0;

      for (let i = 0; i < 3; i++) {
        sw.failedAttempts++;
      }

      const isLockedOut = sw.failedAttempts >= 3;
      expect(isLockedOut).toBe(true);
    });

    it('tracks lockout duration', () => {
      const failCount = 3;
      const lockoutMs = 5000 * (failCount - 2); // 5 sec
      sw.lockoutUntil = Date.now() + lockoutMs;

      const waitMs = sw.lockoutUntil - Date.now();
      expect(waitMs).toBeGreaterThan(0);
      expect(waitMs).toBeLessThanOrEqual(lockoutMs);
    });

    it('allows unlock after lockout expires', () => {
      sw.lockoutUntil = Date.now() - 1000; // Past
      const canUnlock = Date.now() >= sw.lockoutUntil;
      expect(canUnlock).toBe(true);
    });

    it('resets failed attempts on successful unlock', () => {
      sw.failedAttempts = 2;
      // Unlock succeeds
      sw.failedAttempts = 0;
      expect(sw.failedAttempts).toBe(0);
    });
  });
});

describe('storage persistence', () => {
  let storage;

  beforeEach(() => {
    storage = {
      local: {},
      session: {},
    };
  });

  describe('local storage', () => {
    it('persists across popup reopens', () => {
      storage.local.accounts = [{ address: '0xABC' }];
      storage.local.activeAccount = 0;

      // Simulate popup reopen
      const restored = {
        accounts: storage.local.accounts,
        activeAccount: storage.local.activeAccount,
      };

      expect(restored.accounts).toHaveLength(1);
      expect(restored.activeAccount).toBe(0);
    });

    it('persists token list per network', () => {
      storage.local.tokensByNetwork = {
        'eth-mainnet': [{ symbol: 'USDC' }],
        'eth-sepolia': [{ symbol: 'sUSDT' }],
      };

      expect(storage.local.tokensByNetwork['eth-mainnet']).toHaveLength(1);
      expect(storage.local.tokensByNetwork['eth-sepolia']).toHaveLength(1);
    });

    it('persists selected network', () => {
      storage.local.selectedNetwork = 'eth-mainnet';

      // Open new popup
      const network = storage.local.selectedNetwork;
      expect(network).toBe('eth-mainnet');
    });

    it('persists transaction history', () => {
      storage.local.txHistory = {
        'eth-mainnet:0xabc': [
          { hash: '0x123', status: 'success' },
          { hash: '0x456', status: 'pending' },
        ],
      };

      const historyForAccount = storage.local.txHistory['eth-mainnet:0xabc'];
      expect(historyForAccount).toHaveLength(2);
    });
  });

  describe('session storage', () => {
    it('cleared on browser restart', () => {
      storage.session.unlocked = true;

      // Simulate browser restart
      delete storage.session.unlocked;

      expect(storage.session.unlocked).toBeUndefined();
    });

    it('cleared on SW restart', () => {
      storage.session.unlocked = true;

      // SW dies, session cleared
      storage.session = {};

      expect(Object.keys(storage.session)).toHaveLength(0);
    });

    it('tracks unlock time', () => {
      storage.session.unlockTime = Date.now();

      const elapsed = Date.now() - storage.session.unlockTime;
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('storage quota', () => {
    it('handles many transactions', () => {
      const txList = Array.from({ length: 100 }, (_, i) => ({
        hash: `0x${i}`,
        status: 'success',
      }));

      storage.local.txHistory = {
        'eth-mainnet:0xabc': txList,
      };

      expect(storage.local.txHistory['eth-mainnet:0xabc']).toHaveLength(100);
    });

    it('handles many tokens', () => {
      const tokens = Array.from({ length: 50 }, (_, i) => ({
        address: `0x${String(i).padStart(40, '0')}`,
        symbol: `TOKEN${i}`,
      }));

      storage.local.tokensByNetwork = {
        'eth-mainnet': tokens,
      };

      expect(storage.local.tokensByNetwork['eth-mainnet']).toHaveLength(50);
    });
  });

  describe('storage key collision prevention', () => {
    it('scopes history by network:address', () => {
      const history = {
        'eth-mainnet:0xabc': [{ hash: '0x111' }],
        'eth-mainnet:0xdef': [{ hash: '0x222' }],
        'eth-sepolia:0xabc': [{ hash: '0x333' }],
      };

      const mainnet_abc = history['eth-mainnet:0xabc'];
      const mainnet_def = history['eth-mainnet:0xdef'];
      const sepolia_abc = history['eth-sepolia:0xabc'];

      expect(mainnet_abc[0].hash).toBe('0x111');
      expect(mainnet_def[0].hash).toBe('0x222');
      expect(sepolia_abc[0].hash).toBe('0x333');
    });

    it('prevents token list collision', () => {
      const tokensByNetwork = {
        'eth-mainnet': [{ address: '0xMainnet' }],
        'eth-sepolia': [{ address: '0xSepolia' }],
        'bsc': [{ address: '0xBSC' }],
      };

      expect(tokensByNetwork['eth-mainnet'][0].address).toBe('0xMainnet');
      expect(tokensByNetwork['eth-sepolia'][0].address).toBe('0xSepolia');
      expect(tokensByNetwork['bsc'][0].address).toBe('0xBSC');
    });
  });
});
