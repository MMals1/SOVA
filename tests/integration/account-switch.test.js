const { isSameAddress } = require('../../extension/shared/wallet-core.js');

function createAccountSwitchHarness(sendToSW) {
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

  async function switchAccount(accounts, idx) {
    const targetAddress = accounts[idx]?.address;
    const ok = await ensureActiveAccountInSW(targetAddress, idx);
    return ok ? 'wallet' : 'unlock';
  }

  async function canSendFromActiveAccount(accounts, activeIndex) {
    const address = accounts[activeIndex]?.address;
    return ensureActiveAccountInSW(address, activeIndex);
  }

  return {
    canSendFromActiveAccount,
    switchAccount,
  };
}

describe('account switching', () => {
  it('activates an already unlocked target account without forcing lock', async () => {
    const sendToSW = vi.fn(async (msg) => {
      if (msg.type === 'get-wallet-address') {
        return { ok: true, address: '0xBBBB' };
      }
      if (msg.type === 'activate-account') {
        return { ok: true, activated: true };
      }
      return { ok: false };
    });

    const harness = createAccountSwitchHarness(sendToSW);
    const accounts = [{ address: '0xAAAA' }, { address: '0xbbbb' }];
    const screen = await harness.switchAccount(accounts, 1);

    expect(screen).toBe('wallet');
    expect(sendToSW).toHaveBeenCalledTimes(1);
    expect(sendToSW).toHaveBeenCalledWith({ type: 'get-wallet-address' });
  });

  it('prevents sending from a stale unlocked signer', async () => {
    const sendToSW = vi.fn(async (msg) => {
      if (msg.type === 'get-wallet-address') {
        return { ok: true, address: '0x1111' };
      }
      if (msg.type === 'activate-account') {
        return { ok: true, activated: false };
      }
      return { ok: false };
    });

    const harness = createAccountSwitchHarness(sendToSW);
    const accounts = [{ address: '0xAAAA' }, { address: '0x2222' }];
    const canSend = await harness.canSendFromActiveAccount(accounts, 1);

    expect(canSend).toBe(false);
    expect(sendToSW).toHaveBeenNthCalledWith(1, { type: 'get-wallet-address' });
    expect(sendToSW).toHaveBeenNthCalledWith(2, { type: 'activate-account', accountIndex: 1 });
  });

  it('shows unlock screen for selected account that is not unlocked in worker', async () => {
    let activeAddress = '0x1111';
    const sendToSW = vi.fn(async (msg) => {
      if (msg.type === 'get-wallet-address') {
        return { ok: true, address: activeAddress };
      }
      if (msg.type === 'activate-account') {
        return { ok: true, activated: false };
      }
      return { ok: false };
    });

    const harness = createAccountSwitchHarness(sendToSW);
    const accounts = [{ address: '0x1111' }, { address: '0x2222' }];
    const screen = await harness.switchAccount(accounts, 1);

    expect(activeAddress).toBe('0x1111');
    expect(screen).toBe('unlock');
  });
});
