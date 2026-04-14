// ═══════════════════════════════════════════════════════════════════════════
// message-types.ts — Centralized message type constants (2.3)
// Single source of truth for all SW ↔ popup ↔ content-script communication.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Centralized message type constants for SW ↔ popup ↔ content-script IPC.
 * Values are short string identifiers used in `chrome.runtime.sendMessage`.
 */
export const MessageType = {
  // ── Popup → SW: Authentication ─────────────────────────────────────────
  UNLOCK: 'unlock',
  LOCK: 'lock',
  ACTIVATE_ACCOUNT: 'activate-account',

  // ── Popup → SW: Account management ────────────────────────────────────
  ADD_SUB_ACCOUNT: 'add-sub-account',
  GET_WALLET_ADDRESS: 'get-wallet-address',
  CHECK_WALLET_UNLOCKED: 'check-wallet-unlocked',

  // ── Popup → SW: Transaction signing ───────────────────────────────────
  SEND_ETH: 'send-eth',
  SEND_ERC20: 'send-erc20',
  VERIFY_PASSWORD: 'verify-password',

  // ── Popup → SW: Session management ────────────────────────────────────
  RESET_LOCK_TIMER: 'reset-lock-timer',
  NETWORK_CHANGED: 'network-changed',

  // ── Popup → SW: dApp approval lifecycle ───────────────────────────────
  DAPP_GET_PENDING: 'dapp-get-pending',
  DAPP_APPROVAL_RESPONSE: 'dapp-approval-response',
  DAPP_DISCONNECT_ORIGIN: 'dapp-disconnect-origin',

  // ── Content-script → SW ───────────────────────────────────────────────
  DAPP_REQUEST: 'dapp-request',

  // ── SW → Content-script (broadcast wrapper) ───────────────────────────
  DAPP_EVENT: 'dapp-event',
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

/**
 * Events broadcast from SW to content-scripts via BroadcastChannel.
 * These map to EIP-1193 provider events exposed to dApps.
 */
export const BroadcastEvent = {
  ACCOUNTS_CHANGED: 'accountsChanged',
  CHAIN_CHANGED: 'chainChanged',
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
} as const;

export type BroadcastEventValue = (typeof BroadcastEvent)[keyof typeof BroadcastEvent];

// ── globalThis export for importScripts / non-module contexts ───────────
declare const globalThis: Record<string, unknown>;
if (typeof globalThis !== 'undefined') {
  globalThis.MessageType = MessageType;
  globalThis.BroadcastEvent = BroadcastEvent;
}
