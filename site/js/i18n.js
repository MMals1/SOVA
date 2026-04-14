// ══════════════════════════════════════════════════════════════════════
// i18n.js — Internationalization
// ══════════════════════════════════════════════════════════════════════

export const T = {
  ru: {
    tagline: 'DeFi banking via SOVA Wallet',
    btnConnect: 'Connect',
    btnDisconnect: 'Disconnect',
    badgeDisconnected: 'Disconnected',
    badgeConnected: 'Connected',
    switchAccount: 'switch \u21bb',
    sumWallet: 'Wallet',
    sumDeposited: 'AAVE Deposits',
    tabBalance: 'Balance',
    tabAave: 'AAVE',
    tabSwap: 'Swap',
    tabHistory: 'History',
    titleDeposit: 'Deposit',
    titleWithdraw: 'Withdraw',
    titleSwap: 'Swap',
    titleHistory: 'Operations History',
    labelAmount: 'Amount',
    btnDeposit: 'Deposit',
    btnWithdraw: 'Withdraw',
    btnSwap: 'Swap',
    swapYouPay: 'You pay',
    swapYouGet: 'You receive',
    swapRate: 'Rate',
    swapMinReceived: 'Min received',
    swapMainnetOnly: 'Swaps are only available on Ethereum Mainnet. Switch network.',
    aaveUnsupported: 'AAVE is not available for this network.',
    historyEmpty: '\u2014 no operations \u2014',
    errInsufficient: 'Insufficient balance',
    errEnterAmount: 'Enter amount',
    toastSuccess: 'Transaction submitted',
    toastError: 'Error',
    // Lido
    tabLido: 'Lido',
    titleStake: 'Stake ETH',
    titleManageStETH: 'Manage stETH',
    btnStake: 'Stake',
    btnRequestWithdraw: 'Request Withdrawal',
    btnClaimWithdraw: 'Claim',
    btnWrap: 'Wrap',
    btnUnwrap: 'Unwrap',
    lidoApr: 'Lido APR',
    lidoWithdrawInfo: 'Withdrawal takes 1-5 days after request',
    lidoUnsupported: 'Lido is not available for this network.',
    labelStakeAmount: 'ETH to stake',
    labelWrapAmount: 'Amount',
    labelWithdrawAmount: 'stETH to withdraw',
    // Liquidity
    tabLiquidity: 'Liquidity',
    titlePositions: 'Your Positions',
    titleNewPosition: 'New Position',
    titleRiskDashboard: 'Risk Dashboard',
    btnMintPosition: 'Add Liquidity',
    btnRemoveLiquidity: 'Remove',
    btnCollectFees: 'Collect Fees',
    labelPool: 'Pool',
    labelFeeTier: 'Fee Tier',
    labelPriceRange: 'Price Range',
    posInRange: 'In Range',
    posOutOfRange: 'Out of Range',
    riskIL: 'Impermanent Loss',
    riskFeeApr: 'Fee APR',
    riskRangeHealth: 'Range Health',
    liquidityUnsupported: 'Liquidity is not available for this network.',
    labelMinPrice: 'Min Price',
    labelMaxPrice: 'Max Price',
    labelAmount0: 'Amount Token0',
    labelAmount1: 'Amount Token1',
    noPositions: 'No liquidity positions found.',
    sumLido: 'Lido Staked',
  },
  en: {
    tagline: 'DeFi banking via SOVA Wallet',
    btnConnect: 'Connect',
    btnDisconnect: 'Disconnect',
    badgeDisconnected: 'Disconnected',
    badgeConnected: 'Connected',
    switchAccount: 'switch \u21bb',
    sumWallet: 'Wallet',
    sumDeposited: 'AAVE Deposits',
    tabBalance: 'Balance',
    tabAave: 'AAVE',
    tabSwap: 'Swap',
    tabHistory: 'History',
    titleDeposit: 'Deposit',
    titleWithdraw: 'Withdraw',
    titleSwap: 'Swap',
    titleHistory: 'Operations History',
    labelAmount: 'Amount',
    btnDeposit: 'Deposit',
    btnWithdraw: 'Withdraw',
    btnSwap: 'Swap',
    swapYouPay: 'You pay',
    swapYouGet: 'You receive',
    swapRate: 'Rate',
    swapMinReceived: 'Min received',
    swapMainnetOnly: 'Swaps are only available on Ethereum Mainnet. Switch network.',
    aaveUnsupported: 'AAVE is not available for this network.',
    historyEmpty: '\u2014 no operations \u2014',
    errInsufficient: 'Insufficient balance',
    errEnterAmount: 'Enter amount',
    toastSuccess: 'Transaction submitted',
    toastError: 'Error',
    // Lido
    tabLido: 'Lido',
    titleStake: 'Stake ETH',
    titleManageStETH: 'Manage stETH',
    btnStake: 'Stake',
    btnRequestWithdraw: 'Request Withdrawal',
    btnClaimWithdraw: 'Claim',
    btnWrap: 'Wrap',
    btnUnwrap: 'Unwrap',
    lidoApr: 'Lido APR',
    lidoWithdrawInfo: 'Withdrawal takes 1-5 days after request',
    lidoUnsupported: 'Lido is not available for this network.',
    labelStakeAmount: 'ETH to stake',
    labelWrapAmount: 'Amount',
    labelWithdrawAmount: 'stETH to withdraw',
    // Liquidity
    tabLiquidity: 'Liquidity',
    titlePositions: 'Your Positions',
    titleNewPosition: 'New Position',
    titleRiskDashboard: 'Risk Dashboard',
    btnMintPosition: 'Add Liquidity',
    btnRemoveLiquidity: 'Remove',
    btnCollectFees: 'Collect Fees',
    labelPool: 'Pool',
    labelFeeTier: 'Fee Tier',
    labelPriceRange: 'Price Range',
    posInRange: 'In Range',
    posOutOfRange: 'Out of Range',
    riskIL: 'Impermanent Loss',
    riskFeeApr: 'Fee APR',
    riskRangeHealth: 'Range Health',
    liquidityUnsupported: 'Liquidity is not available for this network.',
    labelMinPrice: 'Min Price',
    labelMaxPrice: 'Max Price',
    labelAmount0: 'Amount Token0',
    labelAmount1: 'Amount Token1',
    noPositions: 'No liquidity positions found.',
    sumLido: 'Lido Staked',
  },
};

let lang = localStorage.getItem('sova-bank-lang') || 'ru';

export function t(k) {
  return T[lang]?.[k] || T.ru[k] || k;
}

export function applyLang() {
  document.querySelectorAll('[data-lang]').forEach((el) => {
    const k = el.getAttribute('data-lang');
    if (T[lang]?.[k] != null && !(el.children && el.children.length > 0))
      el.textContent = T[lang][k];
  });
}

export function setupLangToggle() {
  (document.getElementById('lang-toggle') || document.getElementById('lang-btn')).addEventListener(
    'click',
    () => {
      lang = lang === 'ru' ? 'en' : 'ru';
      localStorage.setItem('sova-bank-lang', lang);
      document.getElementById('lang-label').textContent = lang === 'ru' ? 'RU / EN' : 'EN / RU';
      applyLang();
    },
  );
}
