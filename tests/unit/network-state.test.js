const { getTxScopeKey, isSameAddress } = require('../../extension/shared/wallet-core.js');

describe('network state', () => {
  it('compares addresses case-insensitively', () => {
    expect(isSameAddress('0xAbCd', '0xabcd')).toBe(true);
    expect(isSameAddress('0xAbCd', '0x1234')).toBe(false);
  });

  it('keeps transaction scope isolated by network', () => {
    const address = '0xAbCdEf';
    expect(getTxScopeKey(address, 'eth-mainnet')).toBe('eth-mainnet:0xabcdef');
    expect(getTxScopeKey(address, 'eth-sepolia')).toBe('eth-sepolia:0xabcdef');
  });
});
