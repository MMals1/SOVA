import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock WebHID API ─────────────────────────────────────────────────
function createMockDevice() {
  return {
    opened: false,
    vendorId: 0x2c97,
    productId: 0x0001,
    collections: [{ usage: 0xffa0, usagePage: 0xff00 }],
    open: vi.fn(async function () {
      this.opened = true;
    }),
    close: vi.fn(async function () {
      this.opened = false;
    }),
    sendReport: vi.fn(async () => {}),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    oninputreport: null,
  };
}

beforeEach(() => {
  vi.resetModules();
  globalThis.navigator = globalThis.navigator ?? {};
  globalThis.navigator.hid = {
    requestDevice: vi.fn(),
    getDevices: vi.fn(async () => []),
    addEventListener: vi.fn(),
  };
  // Reset modules
  delete globalThis.LedgerTransport;
  delete globalThis.LedgerEth;
  delete globalThis.WolfPopupLedgerUi;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── LedgerTransport ─────────────────────────────────────────────────
describe('LedgerTransport', () => {
  it('exposes isSupported / isConnected / connect / disconnect / exchange', async () => {
    await import('../../extension/popup/modules/ledger-transport.js');
    const T = globalThis.LedgerTransport;
    expect(T).toBeDefined();
    expect(typeof T.isSupported).toBe('function');
    expect(typeof T.isConnected).toBe('function');
    expect(typeof T.connect).toBe('function');
    expect(typeof T.disconnect).toBe('function');
    expect(typeof T.exchange).toBe('function');
  });

  it('isSupported returns true when navigator.hid exists', async () => {
    await import('../../extension/popup/modules/ledger-transport.js');
    expect(globalThis.LedgerTransport.isSupported()).toBe(true);
  });

  it('isConnected returns false before connect', async () => {
    await import('../../extension/popup/modules/ledger-transport.js');
    expect(globalThis.LedgerTransport.isConnected()).toBe(false);
  });

  it('connect requests HID device', async () => {
    const mockDevice = createMockDevice();
    globalThis.navigator.hid.requestDevice.mockResolvedValue([mockDevice]);

    await import('../../extension/popup/modules/ledger-transport.js');
    await globalThis.LedgerTransport.connect();

    expect(globalThis.navigator.hid.requestDevice).toHaveBeenCalledWith({
      filters: [{ vendorId: 0x2c97 }],
    });
    expect(mockDevice.open).toHaveBeenCalled();
    expect(globalThis.LedgerTransport.isConnected()).toBe(true);
  });

  it('disconnect closes device', async () => {
    const mockDevice = createMockDevice();
    globalThis.navigator.hid.requestDevice.mockResolvedValue([mockDevice]);

    await import('../../extension/popup/modules/ledger-transport.js');
    await globalThis.LedgerTransport.connect();
    await globalThis.LedgerTransport.disconnect();

    expect(mockDevice.close).toHaveBeenCalled();
    expect(globalThis.LedgerTransport.isConnected()).toBe(false);
  });

  it('throws when no device selected', async () => {
    globalThis.navigator.hid.requestDevice.mockResolvedValue([]);

    await import('../../extension/popup/modules/ledger-transport.js');
    await expect(globalThis.LedgerTransport.connect()).rejects.toThrow('No Ledger device');
  });
});

// ── LedgerEth ───────────────────────────────────────────────────────
describe('LedgerEth', () => {
  it('exposes getAddress / getAppConfig / signTransaction / signPersonalMessage', async () => {
    await import('../../extension/popup/modules/ledger-eth.js');
    const E = globalThis.LedgerEth;
    expect(E).toBeDefined();
    expect(typeof E.getAddress).toBe('function');
    expect(typeof E.getAppConfig).toBe('function');
    expect(typeof E.signTransaction).toBe('function');
    expect(typeof E.signPersonalMessage).toBe('function');
  });

  it('getAddress throws when transport not connected', async () => {
    globalThis.LedgerTransport = { isConnected: () => false };
    await import('../../extension/popup/modules/ledger-eth.js');
    await expect(globalThis.LedgerEth.getAddress(0)).rejects.toThrow('Ledger not connected');
  });

  it('getAppConfig throws when transport not connected', async () => {
    globalThis.LedgerTransport = { isConnected: () => false };
    await import('../../extension/popup/modules/ledger-eth.js');
    await expect(globalThis.LedgerEth.getAppConfig()).rejects.toThrow('Ledger not connected');
  });

  it('getAddress parses APDU response correctly', async () => {
    const fakeAddr = 'ABCDef1234567890ABCDef1234567890ABCDef12';
    const addrBytes = new TextEncoder().encode(fakeAddr);
    const pubKey = new Uint8Array(65).fill(0x04);

    const response = new Uint8Array(1 + pubKey.length + 1 + addrBytes.length);
    response[0] = pubKey.length;
    response.set(pubKey, 1);
    response[1 + pubKey.length] = addrBytes.length;
    response.set(addrBytes, 2 + pubKey.length);

    globalThis.LedgerTransport = {
      isConnected: () => true,
      exchange: vi.fn(async () => response),
    };
    await import('../../extension/popup/modules/ledger-eth.js');
    const result = await globalThis.LedgerEth.getAddress(0);

    expect(result.address).toBe('0x' + fakeAddr);
    expect(result.publicKey).toMatch(/^0x[0-9a-f]+$/);
    expect(globalThis.LedgerTransport.exchange).toHaveBeenCalledWith(
      0xe0,
      0x02,
      0x00,
      0x00,
      expect.any(Uint8Array),
    );
  });

  it('getAppConfig parses version from APDU response', async () => {
    const response = new Uint8Array([0x01, 1, 12, 3]);
    globalThis.LedgerTransport = {
      isConnected: () => true,
      exchange: vi.fn(async () => response),
    };
    await import('../../extension/popup/modules/ledger-eth.js');
    const config = await globalThis.LedgerEth.getAppConfig();
    expect(config.version).toBe('1.12.3');
    expect(config.arbitraryDataEnabled).toBe(true);
  });
});

// ── LedgerUi ────────────────────────────────────────────────────────
describe('LedgerUi', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="feedback-mount" data-feedback-prefix="ledger" data-feedback-types="error,status"></div>
      <span id="ledger-status"></span>
      <button id="btn-ledger-connect"></button>
      <button id="btn-ledger-disconnect" style="display:none"></button>
      <div id="ledger-addresses-section" style="display:none">
        <div id="ledger-address-list"></div>
      </div>
    `;
    globalThis.WolfPopupSharedState = { activeAccountIndex: 0 };
    globalThis.WolfPopupStorage = {
      getLocal: vi.fn(async () => ({ accounts: [] })),
      setLocal: vi.fn(async () => {}),
    };
    globalThis.WolfPopupUiState = { showScreen: vi.fn() };
    globalThis.WolfPopupUiMessages = {
      showError: vi.fn(),
      setStatus: vi.fn(),
      setLoading: vi.fn(),
      clearMessages: vi.fn(),
    };
    globalThis.shortAddr = (a) => a?.slice(0, 6) + '…' + a?.slice(-4);
    globalThis.setAccountsCache = vi.fn();
    globalThis.getAccountsCached = vi.fn(async () => []);
    globalThis.WolfPopupEventBus = {
      emit: vi.fn(),
      Events: { ACCOUNT_ADDED: 'account:added' },
    };
  });

  it('exposes module on globalThis', async () => {
    await import('../../extension/popup/modules/ledger-ui.js');
    expect(globalThis.WolfPopupLedgerUi).toBeDefined();
    expect(typeof globalThis.connectLedger).toBe('function');
    expect(typeof globalThis.disconnectLedger).toBe('function');
    expect(typeof globalThis.showLedgerScreen).toBe('function');
  });

  it('isActiveLedgerAccount returns false for software account', async () => {
    globalThis.getAccountsCached = vi.fn(async () => [{ address: '0x111', name: 'Account 1' }]);
    globalThis.WolfPopupSharedState = { activeAccountIndex: 0 };
    await import('../../extension/popup/modules/ledger-ui.js');
    const result = await globalThis.WolfPopupLedgerUi.isActiveLedgerAccount();
    expect(result).toBe(false);
  });

  it('isActiveLedgerAccount returns true for ledger account', async () => {
    globalThis.getAccountsCached = vi.fn(async () => [
      { address: '0x111', name: 'Ledger 1', type: 'ledger', derivationIndex: 0 },
    ]);
    globalThis.WolfPopupSharedState = { activeAccountIndex: 0 };
    await import('../../extension/popup/modules/ledger-ui.js');
    const result = await globalThis.WolfPopupLedgerUi.isActiveLedgerAccount();
    expect(result).toBe(true);
  });

  it('connectLedger shows error when WebHID not supported', async () => {
    delete globalThis.navigator.hid;
    await import('../../extension/popup/modules/ledger-ui.js');
    // Re-apply spy after module import (ui-messages.js may overwrite globalThis ref)
    const showErrorSpy = vi.fn();
    globalThis.WolfPopupUiMessages = {
      ...globalThis.WolfPopupUiMessages,
      showError: showErrorSpy,
      clearMessages: vi.fn(),
      setStatus: vi.fn(),
      setLoading: vi.fn(),
    };
    const ok = await globalThis.connectLedger();
    expect(ok).toBe(false);
    expect(showErrorSpy).toHaveBeenCalledWith('ledger', expect.stringContaining('WebHID'));
  });
});
