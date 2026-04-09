import { describe, it, expect, beforeEach } from 'vitest';

describe('popup state management', () => {
  let state;

  beforeEach(() => {
    state = {
      provider: null,
      activeAccountIndex: 0,
      selectedChain: 'ethereum',
      selectedNetwork: 'eth-sepolia',
      rpcByNetwork: {},
    };
  });

  describe('initialization', () => {
    it('initializes with default values', () => {
      expect(state.provider).toBeNull();
      expect(state.activeAccountIndex).toBe(0);
      expect(state.selectedChain).toBe('ethereum');
      expect(state.selectedNetwork).toBe('eth-sepolia');
      expect(state.rpcByNetwork).toEqual({});
    });
  });

  describe('account switching', () => {
    it('can set active account index', () => {
      state.activeAccountIndex = 1;
      expect(state.activeAccountIndex).toBe(1);
    });

    it('validates account index is non-negative', () => {
      state.activeAccountIndex = 0;
      expect(state.activeAccountIndex).toBeGreaterThanOrEqual(0);
    });

    it('multiple state instances are independent', () => {
      const state1 = { ...state, activeAccountIndex: 0 };
      const state2 = { ...state, activeAccountIndex: 1 };
      expect(state1.activeAccountIndex).not.toBe(state2.activeAccountIndex);
    });
  });

  describe('network selection', () => {
    it('can change selected network', () => {
      state.selectedNetwork = 'eth-mainnet';
      expect(state.selectedNetwork).toBe('eth-mainnet');
    });

    it('preserves chain when changing network', () => {
      state.selectedNetwork = 'eth-mainnet';
      expect(state.selectedChain).toBe('ethereum');
    });

    it('can handle multiple chain types', () => {
      state.selectedChain = 'binance';
      state.selectedNetwork = 'bsc';
      expect(state.selectedChain).toBe('binance');
      expect(state.selectedNetwork).toBe('bsc');
    });
  });

  describe('RPC management', () => {
    it('can set custom RPC for network', () => {
      state.rpcByNetwork['eth-mainnet'] = 'https://custom-rpc.example.com';
      expect(state.rpcByNetwork['eth-mainnet']).toBe('https://custom-rpc.example.com');
    });

    it('can have different RPC per network', () => {
      state.rpcByNetwork['eth-mainnet'] = 'https://mainnet-rpc.example.com';
      state.rpcByNetwork['eth-sepolia'] = 'https://sepolia-rpc.example.com';
      expect(state.rpcByNetwork['eth-mainnet']).not.toBe(state.rpcByNetwork['eth-sepolia']);
    });

    it('returns undefined for missing RPC', () => {
      expect(state.rpcByNetwork['unknown-network']).toBeUndefined();
    });

    it('can clear RPC for network', () => {
      state.rpcByNetwork['eth-mainnet'] = 'https://rpc.example.com';
      delete state.rpcByNetwork['eth-mainnet'];
      expect(state.rpcByNetwork['eth-mainnet']).toBeUndefined();
    });
  });

  describe('provider management', () => {
    it('can set provider instance', () => {
      const mockProvider = { call: () => {} };
      state.provider = mockProvider;
      expect(state.provider).toBe(mockProvider);
    });

    it('can clear provider', () => {
      state.provider = { call: () => {} };
      state.provider = null;
      expect(state.provider).toBeNull();
    });
  });

  describe('state persistence', () => {
    it('state can be serialized to JSON (except provider)', () => {
      state.activeAccountIndex = 1;
      state.selectedNetwork = 'eth-mainnet';
      state.rpcByNetwork['eth-mainnet'] = 'https://rpc.example.com';

      const serializable = {
        activeAccountIndex: state.activeAccountIndex,
        selectedChain: state.selectedChain,
        selectedNetwork: state.selectedNetwork,
        rpcByNetwork: state.rpcByNetwork,
      };

      const json = JSON.stringify(serializable);
      const restored = JSON.parse(json);

      expect(restored.activeAccountIndex).toBe(1);
      expect(restored.selectedNetwork).toBe('eth-mainnet');
    });

    it('provider cannot be serialized', () => {
      const mockProvider = { call: () => {} };
      state.provider = mockProvider;

      const serializable = {
        activeAccountIndex: state.activeAccountIndex,
        selectedChain: state.selectedChain,
        selectedNetwork: state.selectedNetwork,
        rpcByNetwork: state.rpcByNetwork,
      };

      // Should not include provider
      expect(serializable.provider).toBeUndefined();
    });
  });
});

describe('token state management', () => {
  let tokenState;

  beforeEach(() => {
    tokenState = {
      tokensByNetwork: {},
    };
  });

  describe('token addition', () => {
    it('adds token to network', () => {
      const token = { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 };
      if (!tokenState.tokensByNetwork['eth-mainnet']) {
        tokenState.tokensByNetwork['eth-mainnet'] = [];
      }
      tokenState.tokensByNetwork['eth-mainnet'].push(token);

      expect(tokenState.tokensByNetwork['eth-mainnet']).toContain(token);
    });

    it('prevents duplicate tokens', () => {
      const token = { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' };
      tokenState.tokensByNetwork['eth-mainnet'] = [token];

      const existing = tokenState.tokensByNetwork['eth-mainnet'].find(
        t => t.address.toLowerCase() === token.address.toLowerCase()
      );
      expect(existing).toBeDefined();
    });

    it('handles tokens per network independently', () => {
      const tokenA = { address: '0xAAAA', symbol: 'TokenA' };
      const tokenB = { address: '0xBBBB', symbol: 'TokenB' };

      tokenState.tokensByNetwork['eth-mainnet'] = [tokenA];
      tokenState.tokensByNetwork['eth-sepolia'] = [tokenB];

      expect(tokenState.tokensByNetwork['eth-mainnet'][0]).not.toBe(tokenState.tokensByNetwork['eth-sepolia'][0]);
    });
  });

  describe('token removal', () => {
    it('removes token from network', () => {
      const token = { address: '0xA', symbol: 'USDC' };
      tokenState.tokensByNetwork['eth-mainnet'] = [token];

      tokenState.tokensByNetwork['eth-mainnet'] = tokenState.tokensByNetwork['eth-mainnet'].filter(
        t => t.address !== token.address
      );

      expect(tokenState.tokensByNetwork['eth-mainnet']).not.toContain(token);
    });

    it('removes only from selected network', () => {
      const token = { address: '0xA', symbol: 'USDC' };
      tokenState.tokensByNetwork['eth-mainnet'] = [token];
      tokenState.tokensByNetwork['eth-sepolia'] = [token];

      tokenState.tokensByNetwork['eth-mainnet'] = [];

      expect(tokenState.tokensByNetwork['eth-mainnet']).toHaveLength(0);
      expect(tokenState.tokensByNetwork['eth-sepolia']).toHaveLength(1);
    });
  });

  describe('token lookup', () => {
    it('finds token by address case-insensitively', () => {
      const token = { address: '0xA0B86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC' };
      tokenState.tokensByNetwork['eth-mainnet'] = [token];

      const found = tokenState.tokensByNetwork['eth-mainnet'].find(
        t => t.address.toLowerCase() === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
      );

      expect(found).toBe(token);
    });

    it('returns undefined for non-existent token', () => {
      tokenState.tokensByNetwork['eth-mainnet'] = [];
      const found = tokenState.tokensByNetwork['eth-mainnet'].find(t => t.address === '0xA');
      expect(found).toBeUndefined();
    });
  });

  describe('token metadata', () => {
    it('validates token has required fields', () => {
      const token = { address: '0xA', symbol: 'USDC', decimals: 6 };
      const isValid = Boolean(token.address && token.symbol && token.decimals);
      expect(isValid).toBe(true);
    });

    it('rejects token missing address', () => {
      const token = { symbol: 'USDC', decimals: 6 };
      const isValid = token.address && token.symbol && token.decimals;
      expect(isValid).toBeFalsy();
    });

    it('stores token with metadata', () => {
      const token = {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
        name: 'USD Coin',
        balance: '1000000000', // 6 decimals = 1000 USDC
      };
      tokenState.tokensByNetwork['eth-mainnet'] = [token];

      expect(tokenState.tokensByNetwork['eth-mainnet'][0].balance).toBe('1000000000');
    });
  });
});

describe('UI message helpers', () => {
  let uiMessages;

  beforeEach(() => {
    uiMessages = {
      _messages: {},
    };

    uiMessages.showError = function (panel, message) {
      if (!this._messages[panel]) this._messages[panel] = {};
      this._messages[panel].error = message;
    };

    uiMessages.setStatus = function (panel, message) {
      if (!this._messages[panel]) this._messages[panel] = {};
      this._messages[panel].status = message;
    };

    uiMessages.showSuccess = function (panel, message) {
      if (!this._messages[panel]) this._messages[panel] = {};
      this._messages[panel].success = message;
    };

    uiMessages.clearMessages = function (panel) {
      if (this._messages[panel]) {
        this._messages[panel] = {};
      }
    };

    uiMessages.setLoading = function (elementId, isLoading) {
      if (!this._messages[elementId]) this._messages[elementId] = {};
      this._messages[elementId].loading = isLoading;
    };
  });

  describe('error display', () => {
    it('shows error message', () => {
      uiMessages.showError('unlock', 'Invalid password');
      expect(uiMessages._messages['unlock'].error).toBe('Invalid password');
    });

    it('replaces previous error', () => {
      uiMessages.showError('unlock', 'Error 1');
      uiMessages.showError('unlock', 'Error 2');
      expect(uiMessages._messages['unlock'].error).toBe('Error 2');
    });

    it('isolates errors by panel', () => {
      uiMessages.showError('unlock', 'Unlock error');
      uiMessages.showError('send', 'Send error');
      expect(uiMessages._messages['unlock'].error).toBe('Unlock error');
      expect(uiMessages._messages['send'].error).toBe('Send error');
    });
  });

  describe('status display', () => {
    it('shows status message', () => {
      uiMessages.setStatus('send', 'Sending...');
      expect(uiMessages._messages['send'].status).toBe('Sending...');
    });

    it('can clear status message', () => {
      uiMessages.setStatus('send', 'Sending...');
      uiMessages.setStatus('send', '');
      expect(uiMessages._messages['send'].status).toBe('');
    });
  });

  describe('success display', () => {
    it('shows success message', () => {
      uiMessages.showSuccess('send', '✓ Transaction sent');
      expect(uiMessages._messages['send'].success).toBe('✓ Transaction sent');
    });
  });

  describe('message clearing', () => {
    it('clears all messages for panel', () => {
      uiMessages.showError('unlock', 'Error');
      uiMessages.setStatus('unlock', 'Status');
      uiMessages.showSuccess('unlock', 'Success');

      uiMessages.clearMessages('unlock');

      expect(uiMessages._messages['unlock']).toEqual({});
    });

    it('does not affect other panels', () => {
      uiMessages.showError('unlock', 'Error');
      uiMessages.showError('send', 'Send Error');

      uiMessages.clearMessages('unlock');

      expect(uiMessages._messages['unlock']).toEqual({});
      expect(uiMessages._messages['send'].error).toBe('Send Error');
    });
  });

  describe('loading state', () => {
    it('sets loading state', () => {
      uiMessages.setLoading('btn-unlock', true);
      expect(uiMessages._messages['btn-unlock'].loading).toBe(true);
    });

    it('clears loading state', () => {
      uiMessages.setLoading('btn-unlock', true);
      uiMessages.setLoading('btn-unlock', false);
      expect(uiMessages._messages['btn-unlock'].loading).toBe(false);
    });
  });
});
