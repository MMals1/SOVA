(function () {
  'use strict';

  const GLOBAL_OWL_TOKEN_SRC = 'logo_new.png';

  function keepGlobalOwlInTokensState() {
    const appRoot = document.getElementById('app');
    appRoot?.classList.add('owl-state-tokens');
    appRoot?.classList.remove('owl-state-history');

    const logoImg = document.querySelector('.global-avatar img');
    if (!logoImg) return;

    if (logoImg.getAttribute('src') !== GLOBAL_OWL_TOKEN_SRC) {
      logoImg.setAttribute('src', GLOBAL_OWL_TOKEN_SRC);
    }
    logoImg.dataset.state = 'tokens';
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
    document.getElementById('acct-menu')?.classList.add('hidden');

    if (typeof globalThis.closeNetworkPickers === 'function') {
      globalThis.closeNetworkPickers();
    }
    if (id !== 'screen-wallet' && typeof globalThis.stopAutoRefresh === 'function') {
      globalThis.stopAutoRefresh();
    }
  }

  function switchTab(tab) {
    document.querySelectorAll('.tabs .tab-btn').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((content) => content.classList.remove('active'));
    document.querySelector(`.tabs [data-tab="${tab}"]`)?.classList.add('active');
    document.getElementById(`tab-${tab}`)?.classList.add('active');
  }

  function switchWalletTab(tab) {
    document.querySelectorAll('.wallet-tabs .tab-btn').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.wallet-tab-content').forEach((content) => content.classList.remove('active'));
    document.querySelector(`.wallet-tabs [data-tab="${tab}"]`)?.classList.add('active');
    document.getElementById(`wallet-tab-${tab}`)?.classList.add('active');
    keepGlobalOwlInTokensState();
  }

  globalThis.WolfPopupUiState = {
    showScreen,
    switchTab,
    switchWalletTab,
  };
})();
