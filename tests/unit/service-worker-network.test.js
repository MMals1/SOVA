function getActiveNetworkParamsFromStorage(stored) {
  const NETWORKS = {
    'eth-mainnet': { chainId: 1, defaultRpcUrl: 'https://ethereum-rpc.publicnode.com' },
    'eth-sepolia': { chainId: 11155111, defaultRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com' },
    bsc: { chainId: 56, defaultRpcUrl: 'https://bsc-rpc.publicnode.com' },
  };
  const DEFAULT_NETWORK_KEY = 'eth-sepolia';

  const selectedNetwork = stored?.selectedNetwork;
  const rpcByNetwork = stored?.rpcByNetwork;
  const rpcUrl = stored?.rpcUrl;

  const networkKey = NETWORKS[selectedNetwork] ? selectedNetwork : DEFAULT_NETWORK_KEY;
  const fallbackMap = (rpcByNetwork && typeof rpcByNetwork === 'object') ? rpcByNetwork : {};
  const legacyRpcUrl = networkKey === 'bsc' ? null : rpcUrl;
  const activeRpcUrl = fallbackMap[networkKey] || legacyRpcUrl || NETWORKS[networkKey].defaultRpcUrl;
  const chainId = NETWORKS[networkKey].chainId;

  return { rpcUrl: activeRpcUrl, chainId };
}

describe('service worker network params', () => {
  it('uses BSC chainId and ignores legacy rpcUrl for bsc', () => {
    const params = getActiveNetworkParamsFromStorage({
      selectedNetwork: 'bsc',
      rpcUrl: 'https://legacy-rpc.example',
    });

    expect(params.chainId).toBe(56);
    expect(params.rpcUrl).toBe('https://bsc-rpc.publicnode.com');
  });

  it('prefers rpcByNetwork.bsc over default for bsc', () => {
    const params = getActiveNetworkParamsFromStorage({
      selectedNetwork: 'bsc',
      rpcByNetwork: {
        bsc: 'https://custom-bsc-rpc.example',
      },
      rpcUrl: 'https://legacy-rpc.example',
    });

    expect(params.chainId).toBe(56);
    expect(params.rpcUrl).toBe('https://custom-bsc-rpc.example');
  });
});
