const { formatAmount, getTxExplorerBaseUrl, getTxScopeKey, shortAddr } = require('../../extension/shared/wallet-core.js');

describe('popup helpers', () => {
  it('formats short addresses correctly', () => {
    expect(shortAddr('0x1234567890abcdef1234567890abcdef12345678')).toBe('0x1234…5678');
    expect(shortAddr('')).toBe('');
  });

  it('formats token and ETH amounts correctly', () => {
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(1.5)).toBe('1.5');
    expect(formatAmount(0.001234)).toBe('0.001234');
    expect(formatAmount(0.00000001)).toBe('< 0.000001');
  });

  it('builds explorer links for supported networks', () => {
    expect(getTxExplorerBaseUrl('eth-mainnet')).toBe('https://etherscan.io/tx/');
    expect(getTxExplorerBaseUrl('eth-sepolia')).toBe('https://sepolia.etherscan.io/tx/');
    expect(getTxExplorerBaseUrl('bsc')).toBe('https://bscscan.com/tx/');
    expect(getTxExplorerBaseUrl('unknown')).toBe('https://etherscan.io/tx/');
  });

  it('builds scoped transaction keys by network and address', () => {
    expect(getTxScopeKey('0xABCDEF', 'eth-mainnet')).toBe('eth-mainnet:0xabcdef');
  });
});
