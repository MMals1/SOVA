const { isSameAddress } = require('../../extension/shared/wallet-core.js');

function createSessionHarness(sendToSW) {
  async function isActiveAccountUnlocked(expectedAddress) {
    if (!expectedAddress) return false;
    const result = await sendToSW({ type: 'get-wallet-address' });
    return !!(result?.ok && isSameAddress(result.address, expectedAddress));
  }

  async function ensureActiveAccountInSW(expectedAddress, accountIndex) {
    if (!expectedAddress || accountIndex == null) return false;
    if (await isActiveAccountUnlocked(expectedAddress)) return true;

    const activated = await sendToSW({ type: 'activate-account', accountIndex });
    if (!activated?.ok || !activated.activated) return false;
    return isActiveAccountUnlocked(expectedAddress);
  }

  async function resolveStartupScreen({
    unlocked,
    unlockTime,
    autoLockMinutes,
    selectedAddress,
    selectedIndex,
    now,
  }) {
    const expired = !unlockTime || (now - unlockTime > autoLockMinutes * 60 * 1000);
    if (!unlocked || expired) return 'unlock';

    const ready = await ensureActiveAccountInSW(selectedAddress, selectedIndex);
    return ready ? 'wallet' : 'unlock';
  }

  return {
    ensureActiveAccountInSW,
    resolveStartupScreen,
  };
}

describe('popup <-> service worker session', () => {
  it('opens wallet screen only when the selected account is really unlocked', async () => {
    const sendToSW = vi.fn(async (msg) => {
      if (msg.type === 'get-wallet-address') {
        return { ok: true, address: '0xAbCd' };
      }
      return { ok: false };
    });

    const harness = createSessionHarness(sendToSW);
    const screen = await harness.resolveStartupScreen({
      unlocked: true,
      unlockTime: Date.now(),
      autoLockMinutes: 5,
      selectedAddress: '0xabcd',
      selectedIndex: 0,
      now: Date.now(),
    });

    expect(screen).toBe('wallet');
    expect(sendToSW).toHaveBeenCalledWith({ type: 'get-wallet-address' });
  });

  it('redirects to unlock when service worker wallet is missing', async () => {
    const sendToSW = vi.fn(async (msg) => {
      if (msg.type === 'get-wallet-address') {
        return { ok: true, address: null };
      }
      if (msg.type === 'activate-account') {
        return { ok: true, activated: false };
      }
      return { ok: false };
    });

    const harness = createSessionHarness(sendToSW);
    const screen = await harness.resolveStartupScreen({
      unlocked: true,
      unlockTime: Date.now(),
      autoLockMinutes: 5,
      selectedAddress: '0xabcd',
      selectedIndex: 1,
      now: Date.now(),
    });

    expect(screen).toBe('unlock');
    expect(sendToSW).toHaveBeenNthCalledWith(1, { type: 'get-wallet-address' });
    expect(sendToSW).toHaveBeenNthCalledWith(2, { type: 'activate-account', accountIndex: 1 });
  });

  it('keeps session and worker account state in sync via activate-account flow', async () => {
    let activeAddress = '0x1111';
    const sendToSW = vi.fn(async (msg) => {
      if (msg.type === 'get-wallet-address') {
        return { ok: true, address: activeAddress };
      }
      if (msg.type === 'activate-account') {
        activeAddress = '0x2222';
        return { ok: true, activated: true };
      }
      return { ok: false };
    });

    const harness = createSessionHarness(sendToSW);
    const ok = await harness.ensureActiveAccountInSW('0x2222', 2);

    expect(ok).toBe(true);
    expect(sendToSW).toHaveBeenCalledTimes(3);
    expect(sendToSW).toHaveBeenNthCalledWith(1, { type: 'get-wallet-address' });
    expect(sendToSW).toHaveBeenNthCalledWith(2, { type: 'activate-account', accountIndex: 2 });
    expect(sendToSW).toHaveBeenNthCalledWith(3, { type: 'get-wallet-address' });
  });
});
