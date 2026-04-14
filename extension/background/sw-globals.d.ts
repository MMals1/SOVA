// ═══════════════════════════════════════════════════════════════════════════
// sw-globals.d.ts — Type declarations for SW global scope
// All sw-*.ts files share a single scope via importScripts().
// This file declares cross-file globals, chrome APIs, and ethers.
// ═══════════════════════════════════════════════════════════════════════════

// ── Chrome extension APIs (subset used by SOVA SW) ──────────────────────

declare namespace chrome {
  namespace runtime {
    const id: string;
    const lastError: { message: string } | undefined;
    function getURL(path: string): string;
    function sendMessage(message: unknown, callback?: (response: unknown) => void): void;
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    const onInstalled: {
      addListener(callback: (details: { reason: string }) => void): void;
    };
  }

  namespace storage {
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }
    const local: StorageArea;
    const session: StorageArea;
  }

  namespace alarms {
    interface Alarm {
      name: string;
    }
    function create(
      name: string,
      alarmInfo: { delayInMinutes?: number; periodInMinutes?: number },
    ): void;
    function clear(name: string): void;
    const onAlarm: {
      addListener(callback: (alarm: Alarm) => void): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    function query(queryInfo: Record<string, unknown>): Promise<Tab[]>;
    function sendMessage(tabId: number, message: unknown, callback?: () => void): void;
  }

  namespace windows {
    interface Window {
      id?: number;
    }
    function create(createData: {
      url?: string;
      type?: string;
      width?: number;
      height?: number;
      focused?: boolean;
    }): Promise<Window | undefined>;
    function get(windowId: number): Promise<Window>;
    function update(
      windowId: number,
      updateInfo: {
        focused?: boolean;
        drawAttention?: boolean;
      },
    ): Promise<Window>;
    const onRemoved: {
      addListener(callback: (windowId: number) => void): void;
    };
  }

  namespace action {
    function setBadgeText(details: { text: string }): void;
    function setBadgeBackgroundColor(details: { color: string }): void;
  }

  namespace notifications {
    function create(
      notificationId: string,
      options: {
        type: string;
        iconUrl: string;
        title: string;
        message: string;
        priority?: number;
      },
      callback?: () => void,
    ): void;
    function clear(notificationId: string): void;
    const onClicked:
      | {
          addListener(callback: (notificationId: string) => void): void;
        }
      | undefined;
  }
}

// ── MessageSender (chrome.runtime.onMessage) ────────────────────────────

interface MessageSender {
  id?: string;
  tab?: { id?: number; url?: string };
  url?: string;
  origin?: string;
}

// ── ethers (loaded via importScripts — globals) ─────────────────────────

declare const ethers: {
  isAddress(value: string): boolean;
  parseEther(ether: string): bigint;
  parseUnits(value: string, decimals: number): bigint;
  getBytes(value: string): Uint8Array;
  Wallet: {
    fromEncryptedJson(json: string, password: string): Promise<EthersWallet>;
  };
  HDNodeWallet: {
    fromPhrase(phrase: string, password: string | null, path: string): EthersWallet;
  };
  JsonRpcProvider: new (url: string, chainId: number) => EthersProvider;
  Contract: new (address: string, abi: string[], signer: EthersSigner) => EthersContract;
};

interface EthersWallet {
  address: string;
  mnemonic: { phrase: string } | null;
  connect(provider: EthersProvider): EthersSigner;
  signMessage(message: string | Uint8Array): Promise<string>;
  signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, unknown>,
    value: Record<string, unknown>,
  ): Promise<string>;
  encrypt(password: string): Promise<string>;
}

interface EthersProvider {
  send(method: string, params: unknown[]): Promise<unknown>;
  estimateGas(tx: Record<string, unknown>): Promise<bigint>;
  getFeeData(): Promise<{
    maxFeePerGas: bigint | null;
    gasPrice: bigint | null;
  }>;
}

interface EthersSigner extends EthersWallet {
  sendTransaction(tx: Record<string, unknown>): Promise<{ hash: string }>;
}

interface EthersContract {
  transfer(to: string, amount: bigint): Promise<{ hash: string }>;
}

// ── Shared modules (loaded via importScripts before sw-*.js) ────────────

declare const MessageType: {
  readonly UNLOCK: 'unlock';
  readonly LOCK: 'lock';
  readonly ACTIVATE_ACCOUNT: 'activate-account';
  readonly ADD_SUB_ACCOUNT: 'add-sub-account';
  readonly GET_WALLET_ADDRESS: 'get-wallet-address';
  readonly CHECK_WALLET_UNLOCKED: 'check-wallet-unlocked';
  readonly SEND_ETH: 'send-eth';
  readonly SEND_ERC20: 'send-erc20';
  readonly VERIFY_PASSWORD: 'verify-password';
  readonly RESET_LOCK_TIMER: 'reset-lock-timer';
  readonly NETWORK_CHANGED: 'network-changed';
  readonly DAPP_GET_PENDING: 'dapp-get-pending';
  readonly DAPP_APPROVAL_RESPONSE: 'dapp-approval-response';
  readonly DAPP_DISCONNECT_ORIGIN: 'dapp-disconnect-origin';
  readonly DAPP_REQUEST: 'dapp-request';
  readonly DAPP_EVENT: 'dapp-event';
};

declare const BroadcastEvent: {
  readonly ACCOUNTS_CHANGED: 'accountsChanged';
  readonly CHAIN_CHANGED: 'chainChanged';
  readonly CONNECT: 'connect';
  readonly DISCONNECT: 'disconnect';
};

// ── service-worker.js globals (entry point sets these before sw-*.js) ───

declare const NETWORKS: Record<
  string,
  {
    chain?: string;
    chainId: number;
    defaultRpcUrl: string;
  }
>;
declare const DEFAULT_NETWORK_KEY: string;

// ── sw-security.ts — types provided by the .ts source file directly ─────
// (declarations removed to avoid TS2451 redeclaration conflicts)

// ── sw-wallet.ts — types provided by the .ts source file directly ───────
// (declarations removed to avoid TS2451 redeclaration conflicts)

// ── sw-rpc.ts — types provided by the .ts source file directly ──────────
// (declarations removed to avoid TS2451 redeclaration conflicts)

// ── sw-dapp.js globals ─────────────────────────────────────────────────

declare function isFromExtensionContext(sender: MessageSender): boolean;
declare function isFromOurContentScript(sender: MessageSender): boolean;
declare const POPUP_ONLY_MESSAGE_TYPES: Set<string>;
declare const CONTENT_SCRIPT_MESSAGE_TYPES: Set<string>;
declare function requestApproval(opts: ApprovalOptions): Promise<ApprovalResult>;
declare function handleApprovalResponse(
  msg: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }>;
declare function openApprovalWindow(id: string): Promise<number | null>;
declare function dispatchDappMethod(
  origin: string,
  method: string,
  params: unknown[],
): Promise<unknown>;

// ── sw-broadcast.ts — types provided by the .ts source file directly ────
// (declarations removed to avoid TS2451 redeclaration conflicts)

// ── sw-handlers.js globals ───────────────────────────────────────────────

declare function handleMessage(
  msg: Record<string, unknown>,
  sender: MessageSender,
): Promise<Record<string, unknown>>;
declare function handleDappRequest(
  msg: Record<string, unknown>,
  sender: MessageSender,
): Promise<Record<string, unknown>>;

// ── Domain types ────────────────────────────────────────────────────────

interface ConnectedOriginRecord {
  addresses: string[];
  chainId?: number;
  connectedAt?: number;
  lastUsedAt?: number;
  permissions?: string[];
}

interface LockoutState {
  failedAttempts: number;
  lockoutUntil: number;
}

interface ApprovalOptions {
  origin: string;
  method: string;
  params: unknown[];
  needsUnlock?: boolean;
  targetAccountIndex?: number | null;
  targetAddress?: string | null;
}

interface ApprovalResult {
  approved: boolean;
  rejected: boolean;
  addresses?: string[];
  reason?: string;
}

interface PendingApprovalEntry {
  resolve: (value: ApprovalResult) => void;
  reject: (reason: Error) => void;
  origin: string;
  method: string;
  params: unknown[];
  createdAt: number;
  expiresAt: number;
  needsUnlock: boolean;
  targetAccountIndex: number | null;
  targetAddress: string | null;
  _windowId: number | null;
  _timer: ReturnType<typeof setTimeout>;
}
