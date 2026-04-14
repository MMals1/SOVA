// ══════════════════════════════════════════════════════════════════════
// state.js — Shared mutable state
// ══════════════════════════════════════════════════════════════════════
import { CHAINS } from './config.js';

export const state = {
  ethProvider: null,
  signer: null,
  userAddress: null,
  chainId: null,
  selectedProvider: null,
  selectedWalletKey: null,
  detectedWallets: new Map(),
  boundListeners: null,
  depositToken: 'ETH',
  withdrawToken: 'ETH',
  swapQuoteData: null,
  swapFeeTier: 3000,
  balances: { ETH: 0, USDC: 0, USDT: 0, aETH: 0, aUSDC: 0, aUSDT: 0, stETH: 0, wstETH: 0 },
  lidoApr: null,
  lpPositions: [],
  lidoWrapMode: 'wrap',
  slippage: 0.005,
  selectedFee: 3000,
  currentPoolPrice: null,
  selectedPool: null,
  rangeMin: 3151.08,
  rangeMax: 3851.32,
  apyCache: {},
};

export function cfg() {
  return CHAINS[state.chainId] || null;
}
