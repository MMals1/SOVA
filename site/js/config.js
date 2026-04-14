// ══════════════════════════════════════════════════════════════════════
// config.js — Constants, chain config, ABIs
// ══════════════════════════════════════════════════════════════════════

export const CHAINS = {
  1: {
    name: 'Ethereum Mainnet',
    isTestnet: false,
    hasAave: true,
    hasSwap: true,
    hasLido: true,
    hasLiquidity: true,
    pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
    wethGateway: '0xD322A49006FC828F9B5B37Ab215F99B4E5caB19C',
    tokens: {
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    },
    aTokens: {
      ETH: '0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8',
      USDC: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c',
      USDT: '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a',
    },
    swapRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
    explorer: 'https://etherscan.io/tx/',
    lido: {
      stETH: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
      wstETH: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
      withdrawalQueue: '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1',
    },
    uniV3: {
      nfpm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
      factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      pools: {
        'ETH/USDC': { addr: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', fee: 3000 },
        'ETH/USDT': { addr: '0x4e68Ccd3E89f51C3074ca5072bbAC773960dfa36', fee: 3000 },
        'wstETH/WETH': { addr: '0xD340B57AAcDD10F96FC1CF10e15921936F41E29c', fee: 500 },
        'USDC/USDT': { addr: '0x3416cF6C708Da44DB2624D63ea0AAef7113527C6', fee: 100 },
      },
    },
  },
  11155111: {
    name: 'Sepolia',
    isTestnet: true,
    hasAave: true,
    hasSwap: false,
    hasLido: true,
    hasLiquidity: false,
    pool: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
    wethGateway: '0x387d311e47e80b498169e6fb51d3193167d89F7D',
    tokens: {
      WETH: '0xC558DBdd856501FCd9aaF1E62eae57A9F0629a3c',
      USDC: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8',
      USDT: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
    },
    aTokens: {
      ETH: '0x5b071b590a59395fE4025A0Ccc1FcC931AAc1830',
      USDC: '0x16dA4541aD1807f4443d92D26044C1147406EB80',
      USDT: '0xAF0F6e8b0Dc5c913bbF4d14c22B4E78Dd14310B6',
    },
    swapRouter: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
    quoter: '0xEd1f6473345F45b75F8179591dd5bA1888af1277',
    explorer: 'https://sepolia.etherscan.io/tx/',
    lido: {
      stETH: '0x3e3FE7dBc6B4C189E7128855dD526361c49b40Af',
      wstETH: '0xB82381A3fBD3FaFA77B3a7bE693342618240067b',
      withdrawalQueue: '0x1583C7b3f4C3B008720E6BcE5726336b0aB25fdd',
    },
  },
};

export const DECIMALS = { ETH: 18, WETH: 18, USDC: 6, USDT: 6 };

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

export const POOL_ABI = [
  'function supply(address,uint256,address,uint16)',
  'function withdraw(address,uint256,address) returns (uint256)',
  'function getReserveData(address asset) view returns (tuple(uint256,uint128,uint128 currentLiquidityRate,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128))',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

export const WETH_GATEWAY_ABI = [
  'function depositETH(address,address,uint16) payable',
  'function withdrawETH(address,uint256,address)',
];

export const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256)',
];

export const SWAP_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)',
];

export const LIDO_ABI = [
  'function submit(address _referral) payable returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

export const WSTETH_ABI = [
  'function wrap(uint256 _stETHAmount) returns (uint256)',
  'function unwrap(uint256 _wstETHAmount) returns (uint256)',
  'function getWstETHByStETH(uint256) view returns (uint256)',
  'function getStETHByWstETH(uint256) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

export const WITHDRAWAL_QUEUE_ABI = [
  'function requestWithdrawals(uint256[] _amounts, address _owner) returns (uint256[])',
  'function claimWithdrawals(uint256[] _requestIds, uint256[] _hints)',
  'function getWithdrawalStatus(uint256[] _requestIds) view returns (tuple(uint256 amountOfStETH, uint256 amountOfShares, address owner, uint256 timestamp, bool isFinalized, bool isClaimed)[])',
  'function findCheckpointHints(uint256[] _requestIds, uint256 _firstIndex, uint256 _lastIndex) view returns (uint256[])',
  'function getLastCheckpointIndex() view returns (uint256)',
  'function getLastFinalizedRequestId() view returns (uint256)',
];

export const NFPM_ABI = [
  'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function increaseLiquidity(tuple(uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function decreaseLiquidity(tuple(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) returns (uint256 amount0, uint256 amount1)',
  'function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) returns (uint256 amount0, uint256 amount1)',
  'function positions(uint256 tokenId) view returns (uint96, address, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256, uint256, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
];

export const UNI_FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];

export const UNI_POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() view returns (uint128)',
  'function fee() view returns (uint24)',
];

export const FEE_TICK_SPACING = { 100: 1, 500: 10, 3000: 60, 10000: 200 };

export const SECONDS_PER_YEAR = 31536000;
