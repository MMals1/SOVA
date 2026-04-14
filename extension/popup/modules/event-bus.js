'use strict';

// ── event-bus.js — Lightweight pub/sub for popup modules (2.4) ──────────
// Replaces implicit globalThis coupling with typed event channels.
// Modules emit events; subscribers react. Zero dependencies.

const _listeners = new Map(); // eventName → Set<callback>
const _onceFlags = new WeakMap(); // callback → true (for auto-cleanup)

/**
 * Subscribe to an event. Returns an unsubscribe function.
 * @param {string} event - Event name (e.g. 'account:switched').
 * @param {Function} callback - Handler function.
 * @returns {() => void} Unsubscribe function.
 */
function on(event, callback) {
  if (!_listeners.has(event)) _listeners.set(event, new Set());
  _listeners.get(event).add(callback);
  return () => off(event, callback);
}

/**
 * Subscribe to an event once. Auto-unsubscribes after first invocation.
 * @param {string} event
 * @param {Function} callback
 * @returns {() => void}
 */
function once(event, callback) {
  function wrapper(...args) {
    off(event, wrapper);
    return callback(...args);
  }
  _onceFlags.set(wrapper, true);
  return on(event, wrapper);
}

/**
 * Unsubscribe a specific callback from an event.
 * @param {string} event
 * @param {Function} callback
 */
function off(event, callback) {
  const set = _listeners.get(event);
  if (set) {
    set.delete(callback);
    if (set.size === 0) _listeners.delete(event);
  }
}

/**
 * Emit an event with optional payload. All subscribers called synchronously.
 * @param {string} event
 * @param {*} [payload]
 */
function emit(event, payload) {
  const set = _listeners.get(event);
  if (!set) return;
  for (const cb of [...set]) {
    try {
      cb(payload);
    } catch (e) {
      console.error(`[EventBus] Error in handler for "${event}":`, e);
    }
  }
}

/**
 * Remove all listeners (useful for testing / cleanup).
 */
function clear() {
  _listeners.clear();
}

/**
 * Get count of listeners for an event (useful for debugging).
 * @param {string} event
 * @returns {number}
 */
function listenerCount(event) {
  return _listeners.has(event) ? _listeners.get(event).size : 0;
}

// ── Well-known event names ──────────────────────────────────────────────
const Events = Object.freeze({
  // Account lifecycle
  ACCOUNT_SWITCHED: 'account:switched', // { index, address }
  ACCOUNT_ADDED: 'account:added', // { index, address }
  ACCOUNTS_LOADED: 'accounts:loaded', // { accounts }

  // Network
  NETWORK_CHANGED: 'network:changed', // { networkKey, meta }
  RPC_UPDATED: 'rpc:updated', // { networkKey, rpcUrl }

  // Wallet state
  WALLET_LOCKED: 'wallet:locked', // void
  WALLET_UNLOCKED: 'wallet:unlocked', // { address }
  WALLET_CREATED: 'wallet:created', // { address }

  // Balance / refresh
  BALANCE_UPDATED: 'balance:updated', // { address, balance }
  REFRESH_STARTED: 'refresh:started', // void
  REFRESH_FINISHED: 'refresh:finished', // void

  // Transaction
  TX_SENT: 'tx:sent', // { hash, to, value }
  TX_HISTORY_LOADED: 'tx:history:loaded', // { address, count }

  // Screen navigation
  SCREEN_CHANGED: 'screen:changed', // { screenId }

  // Token
  TOKEN_ADDED: 'token:added', // { address, symbol }
  TOKEN_REMOVED: 'token:removed', // { address }
  TOKENS_LOADED: 'tokens:loaded', // { count }
});

// ── Public API ──────────────────────────────────────────────────────────
export const WolfPopupEventBus = Object.freeze({
  on,
  once,
  off,
  emit,
  clear,
  listenerCount,
  Events,
});

globalThis.WolfPopupEventBus = WolfPopupEventBus;
