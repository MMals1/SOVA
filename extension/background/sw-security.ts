/// <reference path="sw-globals.d.ts" />
'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// sw-security.ts — Debug logging, lock constants, bruteforce protection,
//                  connected-origins limits, audit log
// Loaded first — provides _swLog() and security primitives to all other modules
// ═══════════════════════════════════════════════════════════════════════════

// LOW-1 + LOW-10: debug flag. В production логи отключены — console.error
// может утекать диагностику (chain id, origin, params в stack trace).
// Включается через chrome.storage.local.debugSW = true.
let _debugEnabled = false;
try {
  chrome.storage.local.get(['debugSW']).then((result: Record<string, unknown>) => {
    _debugEnabled = !!(result as { debugSW?: boolean }).debugSW;
  });
} catch {
  /* ignore */
}
function _swLog(...args: unknown[]): void {
  if (_debugEnabled) console.error(...args);
}

const LOCK_ALARM = 'auto-lock';
const LOCK_DELAY_MIN_DEFAULT = 5;
const LOCK_DELAY_OPTIONS: number[] = [1, 5, 15, 30];

// 1.5: Читаем настраиваемый auto-lock timeout из storage
async function getLockDelayMin(): Promise<number> {
  try {
    const { autoLockMinutes } = (await chrome.storage.local.get(['autoLockMinutes'])) as {
      autoLockMinutes?: string;
    };
    const val = parseInt(autoLockMinutes as string, 10);
    if (LOCK_DELAY_OPTIONS.includes(val)) return val;
  } catch {
    /* ignore */
  }
  return LOCK_DELAY_MIN_DEFAULT;
}

// TTL для pending dApp-запросов (секунды).
const DAPP_REQUEST_TTL_MS = 60 * 1000;

// MED-7: LRU + TTL для connectedOrigins.
// Ограничиваем размер (100 origin'ов) и автоматически чистим записи
// старше 90 дней (по lastUsedAt). Защита от unbounded growth storage'а.
const MAX_CONNECTED_ORIGINS = 100;
const CONNECTED_ORIGIN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 дней

function enforceConnectedOriginsLimits(
  connectedOrigins: Record<string, ConnectedOriginRecord>,
): Record<string, ConnectedOriginRecord> {
  const entries = Object.entries(connectedOrigins || {});
  const now = Date.now();
  // 1. Удаляем expired (lastUsedAt > 90 дней назад)
  const fresh = entries.filter(([_, rec]) => {
    const last = rec?.lastUsedAt || rec?.connectedAt || 0;
    return now - last < CONNECTED_ORIGIN_TTL_MS;
  });
  // 2. Если всё ещё > cap — оставляем top-N по lastUsedAt (LRU eviction)
  if (fresh.length > MAX_CONNECTED_ORIGINS) {
    fresh.sort((a, b) => (b[1]?.lastUsedAt || 0) - (a[1]?.lastUsedAt || 0));
    fresh.length = MAX_CONNECTED_ORIGINS;
  }
  return Object.fromEntries(fresh);
}

// ── Bruteforce protection (PERSISTENT) ──────────────────────────────────────
const LOCKOUT_KEY = 'security:lockout';
const MAX_LOCKOUT_MS = 15 * 60 * 1000; // 15 минут (cap при множественных неудачах)

async function getLockoutState(): Promise<LockoutState> {
  const result = (await chrome.storage.local.get([LOCKOUT_KEY])) as Record<string, LockoutState>;
  return result[LOCKOUT_KEY] || { failedAttempts: 0, lockoutUntil: 0 };
}

async function recordFailedAttempt(): Promise<void> {
  const state = await getLockoutState();
  const next = state.failedAttempts + 1;
  // Exponential backoff: 3 → 5 сек, 4 → 10, 5 → 20, 6 → 40, 7 → 80, ..., cap 15 мин
  const lockoutUntil =
    next >= 3 ? Date.now() + Math.min(MAX_LOCKOUT_MS, 5_000 * Math.pow(2, next - 3)) : 0;
  await chrome.storage.local.set({
    [LOCKOUT_KEY]: { failedAttempts: next, lockoutUntil },
  });
}

async function resetLockoutState(): Promise<void> {
  await chrome.storage.local.remove([LOCKOUT_KEY]);
}

// ── Audit log ─────────────────────────────────────────────────────────────
const AUDIT_LOG_MAX = 500;
const AUDIT_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

async function appendAuditLog(entry: Record<string, unknown>): Promise<void> {
  try {
    const { auditLog = [] } = (await chrome.storage.local.get(['auditLog'])) as {
      auditLog?: Array<Record<string, unknown>>;
    };
    const now = Date.now();
    const record = { timestamp: now, ...entry };
    auditLog.push(record);
    // Удаляем записи старше TTL
    const cutoff = now - AUDIT_LOG_TTL_MS;
    const filtered = auditLog.filter((r) => ((r.timestamp as number) || 0) >= cutoff);
    // Cap по размеру (LRU — удаляем самые старые)
    while (filtered.length > AUDIT_LOG_MAX) filtered.shift();
    await chrome.storage.local.set({ auditLog: filtered });
  } catch (err) {
    _swLog('[SOVA SW] auditLog append failed', (err as Error)?.message);
  }
}
