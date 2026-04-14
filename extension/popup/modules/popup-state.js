'use strict';

// Shared mutable state accessible by all popup modules.
// Initialised once; values are updated in-place by the modules that own them.
export const WolfPopupSharedState = {
  provider: null,
  activeAccountIndex: 0,
  selectedChain: 'ethereum',
  selectedNetwork: 'eth-sepolia',
  rpcByNetwork: {},
};
globalThis.WolfPopupSharedState = WolfPopupSharedState;
