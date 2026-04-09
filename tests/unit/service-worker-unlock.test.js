// ── Service Worker unlock & lockout (persistent) ───────────────────────
// Тестирует NEW persistent lockout из Phase 1 (P1-3):
// - state хранится в chrome.storage.local['security:lockout'] (не in-memory)
// - экспоненциальный backoff: 5_000 * 2^(n-3) sec
// - cap: MAX_LOCKOUT_MS = 15 * 60 * 1000 (15 минут)
// - состояние ПЕРЕЖИВАЕТ рестарт service worker'а
//
// Раньше этот тест проверял стал in-memory версию с линейным backoff и cap 60s.
// Был переписан после P1-3 fix (AUDIT-REPORT CRIT-3).

import { describe, it, expect, beforeEach } from 'vitest';

// ── Mocked chrome.storage.local ────────────────────────────────────────
// Mirror of service-worker.js lockout logic using in-memory storage mock
// (чтобы симулировать рестарт SW путём обнуления in-memory map'ов, но
// СОХРАНЕНИЯ storage). Ключ такой же как в service-worker.js.

const LOCKOUT_KEY = 'security:lockout';
const MAX_LOCKOUT_MS = 15 * 60 * 1000;

let mockStorage;            // persistent — переживает SW restart
let walletsByAddress;       // in-memory — стирается при SW restart
let activeWalletAddress;    // in-memory — стирается при SW restart

function makeMockChromeStorage() {
  const store = {};
  return {
    _data: store,
    get(keys) {
      return new Promise(resolve => {
        const result = {};
        const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : []);
        for (const k of keyList) {
          if (k in store) result[k] = store[k];
        }
        resolve(result);
      });
    },
    set(data) {
      return new Promise(resolve => {
        Object.assign(store, data);
        resolve();
      });
    },
    remove(keys) {
      return new Promise(resolve => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) delete store[k];
        resolve();
      });
    },
  };
}

// ── Mirror of Phase 1 lockout helpers from service-worker.js ───────────

async function getLockoutState() {
  const { [LOCKOUT_KEY]: state = { failedAttempts: 0, lockoutUntil: 0 } } =
    await mockStorage.get([LOCKOUT_KEY]);
  return state;
}

async function recordFailedAttempt() {
  const state = await getLockoutState();
  const next = state.failedAttempts + 1;
  // Exponential backoff: 3 → 5s, 4 → 10s, 5 → 20s, ..., cap 15 мин
  const lockoutUntil = next >= 3
    ? Date.now() + Math.min(MAX_LOCKOUT_MS, 5_000 * Math.pow(2, next - 3))
    : 0;
  await mockStorage.set({
    [LOCKOUT_KEY]: { failedAttempts: next, lockoutUntil },
  });
}

async function resetLockoutState() {
  await mockStorage.remove([LOCKOUT_KEY]);
}

// ── Full unlock simulator with persistent lockout ──────────────────────

async function simulateUnlockAttempt(accountIndex, password, correctPassword, accounts) {
  // Check lockout from PERSISTENT storage (не из in-memory!)
  const lockoutState = await getLockoutState();
  if (Date.now() < lockoutState.lockoutUntil) {
    const waitSec = Math.ceil((lockoutState.lockoutUntil - Date.now()) / 1000);
    throw new Error(`Подождите ${waitSec} сек`);
  }

  // Validate inputs
  if (accountIndex == null || typeof accountIndex !== 'number') {
    throw new Error('Invalid account index');
  }
  if (!password || typeof password !== 'string') {
    throw new Error('Invalid password');
  }

  const account = accounts?.[accountIndex];
  if (!account?.keystore) {
    throw new Error('Аккаунт не найден');
  }

  if (password !== correctPassword) {
    await recordFailedAttempt();
    throw new Error('Неверный пароль');
  }

  // Success — reset lockout persistent
  await resetLockoutState();
  activeWalletAddress = account.address.toLowerCase();
  walletsByAddress.set(activeWalletAddress, { address: account.address });

  return { ok: true, address: account.address };
}

// Симуляция рестарта SW: очищаем in-memory state, но НЕ storage
function simulateSwRestart() {
  walletsByAddress = new Map();
  activeWalletAddress = null;
  // mockStorage persists (это как chrome.storage.local — переживает SW restart)
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('service worker persistent unlock & lockout (P1-3)', () => {
  beforeEach(() => {
    mockStorage = makeMockChromeStorage();
    walletsByAddress = new Map();
    activeWalletAddress = null;
  });

  describe('unlock success path', () => {
    it('unlocks with correct password', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];
      const result = await simulateUnlockAttempt(0, 'correct', 'correct', accounts);
      expect(result.ok).toBe(true);
      const state = await getLockoutState();
      expect(state.failedAttempts).toBe(0);
      expect(state.lockoutUntil).toBe(0);
    });

    it('resets failed attempts on successful unlock (persistent)', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];
      // 1 failure
      try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      let state = await getLockoutState();
      expect(state.failedAttempts).toBe(1);

      // successful unlock → reset
      await simulateUnlockAttempt(0, 'correct', 'correct', accounts);
      state = await getLockoutState();
      expect(state.failedAttempts).toBe(0);
      expect(mockStorage._data[LOCKOUT_KEY]).toBeUndefined(); // removed entirely
    });

    it('stores wallet in map with lowercase address', async () => {
      const accounts = [{ address: '0xAbCd123', keystore: 'encrypted' }];
      await simulateUnlockAttempt(0, 'correct', 'correct', accounts);
      expect(walletsByAddress.has('0xabcd123')).toBe(true);
      expect(activeWalletAddress).toBe('0xabcd123');
    });
  });

  describe('unlock failure — input validation', () => {
    it('rejects null accountIndex without counting as failure', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];
      await expect(simulateUnlockAttempt(null, 'p', 'p', accounts)).rejects.toThrow('Invalid account index');
      const state = await getLockoutState();
      expect(state.failedAttempts).toBe(0);
    });

    it('rejects non-string password without counting as failure', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];
      await expect(simulateUnlockAttempt(0, 123, 'p', accounts)).rejects.toThrow('Invalid password');
      const state = await getLockoutState();
      expect(state.failedAttempts).toBe(0);
    });

    it('rejects empty password without counting as failure', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];
      await expect(simulateUnlockAttempt(0, '', 'p', accounts)).rejects.toThrow('Invalid password');
      const state = await getLockoutState();
      expect(state.failedAttempts).toBe(0);
    });

    it('rejects missing account without counting as failure', async () => {
      await expect(simulateUnlockAttempt(0, 'p', 'p', [])).rejects.toThrow('Аккаунт не найден');
      const state = await getLockoutState();
      expect(state.failedAttempts).toBe(0);
    });
  });

  describe('persistent lockout mechanism', () => {
    it('increments failedAttempts in storage on each wrong password', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];
      try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      expect((await getLockoutState()).failedAttempts).toBe(1);

      try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      expect((await getLockoutState()).failedAttempts).toBe(2);
    });

    it('activates lockout after exactly 3 failed attempts', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];
      const before = Date.now();

      for (let i = 0; i < 2; i++) {
        try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      }
      // Ещё нет lockout'а — только после 3-й попытки
      expect((await getLockoutState()).lockoutUntil).toBe(0);

      try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      const state = await getLockoutState();
      expect(state.failedAttempts).toBe(3);
      expect(state.lockoutUntil).toBeGreaterThan(before);
    });

    it('uses exponential backoff 5_000 * 2^(n-3) sec', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];

      // 3 attempts → 5_000 * 2^0 = 5 sec
      for (let i = 0; i < 3; i++) {
        try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      }
      const after3 = (await getLockoutState()).lockoutUntil - Date.now();
      expect(after3).toBeGreaterThanOrEqual(4900);
      expect(after3).toBeLessThanOrEqual(5100);

      // 4th attempt → 5_000 * 2^1 = 10 sec
      // Сначала нужно «пережить» текущий lockout
      mockStorage._data[LOCKOUT_KEY].lockoutUntil = Date.now() - 1;
      try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      const after4 = (await getLockoutState()).lockoutUntil - Date.now();
      expect(after4).toBeGreaterThanOrEqual(9900);
      expect(after4).toBeLessThanOrEqual(10100);

      // 5th attempt → 5_000 * 2^2 = 20 sec
      mockStorage._data[LOCKOUT_KEY].lockoutUntil = Date.now() - 1;
      try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      const after5 = (await getLockoutState()).lockoutUntil - Date.now();
      expect(after5).toBeGreaterThanOrEqual(19900);
      expect(after5).toBeLessThanOrEqual(20100);
    });

    it('caps lockout at MAX_LOCKOUT_MS (15 минут)', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];

      // Force many failures by directly modifying state then retrying
      for (let i = 0; i < 20; i++) {
        mockStorage._data[LOCKOUT_KEY] = mockStorage._data[LOCKOUT_KEY] || { failedAttempts: 0, lockoutUntil: 0 };
        mockStorage._data[LOCKOUT_KEY].lockoutUntil = 0; // bypass check
        try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      }

      const state = await getLockoutState();
      expect(state.failedAttempts).toBeGreaterThanOrEqual(20);
      const waitTime = state.lockoutUntil - Date.now();
      expect(waitTime).toBeLessThanOrEqual(MAX_LOCKOUT_MS);
      expect(waitTime).toBeGreaterThan(MAX_LOCKOUT_MS - 100); // must be at cap
    });

    it('prevents unlock during active lockout', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];

      for (let i = 0; i < 3; i++) {
        try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      }

      await expect(
        simulateUnlockAttempt(0, 'correct', 'correct', accounts)
      ).rejects.toThrow(/Подождите/);
    });

    it('allows unlock after lockout expires', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];

      for (let i = 0; i < 3; i++) {
        try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      }

      // Fast-forward past lockout
      mockStorage._data[LOCKOUT_KEY].lockoutUntil = Date.now() - 1000;

      const result = await simulateUnlockAttempt(0, 'correct', 'correct', accounts);
      expect(result.ok).toBe(true);
    });
  });

  describe('CRITICAL: lockout state persistence across SW restart', () => {
    // Это КЛЮЧЕВОЙ тест для CRIT-3 fix. Старая версия (in-memory)
    // теряла lockout state при перезапуске SW → bruteforce attack.
    // Новая (persistent в chrome.storage.local) — переживает restart.

    it('lockout PERSISTS across SW restart (key regression guard)', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];

      // 3 failures → lockout активен
      for (let i = 0; i < 3; i++) {
        try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      }
      const beforeRestart = await getLockoutState();
      expect(beforeRestart.failedAttempts).toBe(3);
      expect(beforeRestart.lockoutUntil).toBeGreaterThan(Date.now());

      // Симуляция SW restart (Chrome убил idle worker)
      simulateSwRestart();
      // walletsByAddress обнулён, но mockStorage остался

      // Попытка unlock после restart должна всё ещё падать с lockout
      await expect(
        simulateUnlockAttempt(0, 'correct', 'correct', accounts)
      ).rejects.toThrow(/Подождите/);

      // Lockout state должен быть сохранён
      const afterRestart = await getLockoutState();
      expect(afterRestart.failedAttempts).toBe(3);
      expect(afterRestart.lockoutUntil).toEqual(beforeRestart.lockoutUntil);
    });

    it('failed attempts counter accumulates across SW restarts', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];

      // 1 failure
      try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      simulateSwRestart();

      // 2nd failure (after restart)
      try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      simulateSwRestart();

      // 3rd failure (another restart) → активирует lockout
      try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}

      const state = await getLockoutState();
      expect(state.failedAttempts).toBe(3);
      expect(state.lockoutUntil).toBeGreaterThan(Date.now());
      // Даже с 3 рестартами между попытками — атакующий всё равно в lockout'е
    });

    it('successful unlock clears lockout state from storage', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];

      // 2 failures
      for (let i = 0; i < 2; i++) {
        try { await simulateUnlockAttempt(0, 'wrong', 'correct', accounts); } catch {}
      }
      expect((await getLockoutState()).failedAttempts).toBe(2);

      // Successful unlock
      await simulateUnlockAttempt(0, 'correct', 'correct', accounts);

      // Storage полностью очищен
      expect(mockStorage._data[LOCKOUT_KEY]).toBeUndefined();
      const state = await getLockoutState(); // default
      expect(state.failedAttempts).toBe(0);
      expect(state.lockoutUntil).toBe(0);
    });
  });

  describe('wallet state management (in-memory, stirs on SW restart)', () => {
    it('tracks active wallet address in lowercase', async () => {
      const accounts = [
        { address: '0xABC', keystore: 'encrypted' },
        { address: '0xDEF', keystore: 'encrypted' },
      ];

      await simulateUnlockAttempt(0, 'correct', 'correct', accounts);
      expect(activeWalletAddress).toBe('0xabc');

      await simulateUnlockAttempt(1, 'correct', 'correct', accounts);
      expect(activeWalletAddress).toBe('0xdef');
    });

    it('can hold multiple wallets in map simultaneously', async () => {
      const accounts = [
        { address: '0xABC', keystore: 'encrypted' },
        { address: '0xDEF', keystore: 'encrypted' },
      ];

      await simulateUnlockAttempt(0, 'correct', 'correct', accounts);
      await simulateUnlockAttempt(1, 'correct', 'correct', accounts);

      expect(walletsByAddress.size).toBe(2);
    });

    it('SW restart clears in-memory wallets (but not lockout state)', async () => {
      const accounts = [{ address: '0xABC', keystore: 'encrypted' }];
      await simulateUnlockAttempt(0, 'correct', 'correct', accounts);
      expect(walletsByAddress.size).toBe(1);

      simulateSwRestart();
      expect(walletsByAddress.size).toBe(0);
      expect(activeWalletAddress).toBe(null);

      // После рестарта user увидит locked wallet, нужен повторный unlock
      const result = await simulateUnlockAttempt(0, 'correct', 'correct', accounts);
      expect(result.ok).toBe(true);
    });
  });
});
