const {
  getTokenLogoUrls,
  getTokensForNetwork,
  setTokensForNetwork,
} = require('../../extension/shared/wallet-core.js');

describe('token scope by network', () => {
  it('adds token only to the selected network', () => {
    const initial = {
      'eth-mainnet': [{ address: '0xA', symbol: 'AAA', decimals: 18 }],
      'eth-sepolia': [],
    };
    const token = { address: '0xB', symbol: 'BBB', decimals: 6 };

    const next = setTokensForNetwork(initial, 'eth-sepolia', [token]);

    expect(getTokensForNetwork(next, 'eth-sepolia')).toEqual([token]);
    expect(getTokensForNetwork(next, 'eth-mainnet')).toEqual([{ address: '0xA', symbol: 'AAA', decimals: 18 }]);
  });

  it('does not show mainnet tokens in sepolia', () => {
    const scoped = {
      'eth-mainnet': [{ address: '0xMain', symbol: 'USDT', decimals: 6 }],
      'eth-sepolia': [{ address: '0xSepolia', symbol: 'sUSDT', decimals: 6 }],
    };

    const mainnet = getTokensForNetwork(scoped, 'eth-mainnet');
    const sepolia = getTokensForNetwork(scoped, 'eth-sepolia');

    expect(mainnet).toHaveLength(1);
    expect(sepolia).toHaveLength(1);
    expect(mainnet[0].address).not.toBe(sepolia[0].address);
  });

  it('removes token only from the selected network', () => {
    const before = {
      'eth-mainnet': [
        { address: '0xA', symbol: 'AAA', decimals: 18 },
        { address: '0xB', symbol: 'BBB', decimals: 18 },
      ],
      'eth-sepolia': [{ address: '0xC', symbol: 'CCC', decimals: 18 }],
    };

    const filteredMainnet = getTokensForNetwork(before, 'eth-mainnet')
      .filter((token) => token.address !== '0xA');
    const after = setTokensForNetwork(before, 'eth-mainnet', filteredMainnet);

    expect(getTokensForNetwork(after, 'eth-mainnet')).toEqual([{ address: '0xB', symbol: 'BBB', decimals: 18 }]);
    expect(getTokensForNetwork(after, 'eth-sepolia')).toEqual([{ address: '0xC', symbol: 'CCC', decimals: 18 }]);
  });

  it('generates token logo URLs for ethereum and BNB networks', () => {
    const address = '0xAbCdEf0000000000000000000000000000000001';

    expect(getTokenLogoUrls(address, 'eth-mainnet')).toEqual([
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${address}/logo.png`,
      'https://tokens.1inch.io/0xabcdef0000000000000000000000000000000001.png',
    ]);
    expect(getTokenLogoUrls(address, 'bsc')).toEqual([
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/${address}/logo.png`,
      'https://tokens.1inch.io/0xabcdef0000000000000000000000000000000001.png',
    ]);
  });
});
