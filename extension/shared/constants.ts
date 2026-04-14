// ═══════════════════════════════════════════════════════════════════════════
// constants.ts — Centralized magic numbers, timeouts, caps, and alarm names
// Single source of truth. All modules import from here.
// ═══════════════════════════════════════════════════════════════════════════

// ── Alarms & Lock ──────────────────────────────────────────────────────────
export const LOCK_ALARM = 'auto-lock';
export const LOCK_DELAY_MIN_DEFAULT = 5;
export const LOCK_DELAY_OPTIONS: number[] = [1, 5, 15, 30];

// ── Security: bruteforce & lockout ─────────────────────────────────────────
export const LOCKOUT_KEY = 'security:lockout';
export const MAX_LOCKOUT_MS = 15 * 60 * 1000; // 15 минут

// ── dApp connections ───────────────────────────────────────────────────────
export const DAPP_REQUEST_TTL_MS = 60 * 1000; // 60 секунд
export const MAX_CONNECTED_ORIGINS = 100;
export const CONNECTED_ORIGIN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 дней
export const MAX_PENDING_APPROVALS_GLOBAL = 20;

// ── Wallets ────────────────────────────────────────────────────────────────
export const MAX_UNLOCKED_WALLETS = 20;

// ── Audit log ──────────────────────────────────────────────────────────────
export const AUDIT_LOG_MAX = 500;
export const AUDIT_LOG_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

// ── Popup timeouts & intervals ─────────────────────────────────────────────
export const SW_TIMEOUT_MS = 15_000; // 15 секунд — SW message timeout
export const AUTO_REFRESH_MIN_INTERVAL_MS = 10_000;
export const AUTO_REFRESH_FALLBACK_MS = 30_000;
export const LOGO_LOAD_TIMEOUT_MS = 3_000;

// ── Transactions ───────────────────────────────────────────────────────────
export const TX_HISTORY_LIMIT = 1000;
export const TX_PAGE_SIZE = 10;
export const TX_INITIAL_MAX_COUNT = '0x3e8'; // 1000
export const TX_INCREMENTAL_MAX_COUNT = '0x64'; // 100
export const REST_DEFAULT_OFFSET = 200;

// ── Spend limits ───────────────────────────────────────────────────────────
export const DEFAULT_DAILY_LIMIT_ETH = 0.1;

// ── Quiz ───────────────────────────────────────────────────────────────────
export const QUIZ_WORD_COUNT = 5;
