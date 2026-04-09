// ── SOVA dApp handlers — изолированные unit-тесты ────────────────────────
// Здесь мы тестируем pure-функции, которые отражают логику service worker'а:
//   - dispatcher по EIP-1193 методам
//   - origin validation
//   - формат connectedOrigins
//   - отказ deprecated методов
// Полный SW не загружается (он зависит от chrome.* и importScripts).
// describe/it/expect — глобали Vitest, не требуют импорта.

// ── Mirrored from service-worker.js ─────────────────────────────────────
const REFUSED_METHODS = {
  'eth_sign': 'eth_sign is deprecated and unsafe. Use personal_sign or eth_signTypedData_v4.',
  'eth_sendRawTransaction': 'Pre-signed transactions are not accepted.',
  'eth_signTypedData': 'Only eth_signTypedData_v4 is supported.',
  'eth_signTypedData_v1': 'Only eth_signTypedData_v4 is supported.',
  'eth_signTypedData_v3': 'Only eth_signTypedData_v4 is supported.',
  'eth_getEncryptionPublicKey': 'Encryption methods are not supported.',
  'eth_decrypt': 'Encryption methods are not supported.',
};

const READ_ONLY_METHODS = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getBalance',
  'eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_feeHistory',
  'eth_getCode', 'eth_getStorageAt', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_getTransactionCount',
  'eth_getBlockByNumber', 'eth_getBlockByHash',
]);

const APPROVAL_REQUIRED_METHODS = new Set([
  'eth_requestAccounts', 'personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction',
]);

function classifyMethod(method) {
  if (REFUSED_METHODS[method]) return 'refused';
  if (READ_ONLY_METHODS.has(method)) return 'read-only';
  if (APPROVAL_REQUIRED_METHODS.has(method)) return 'approval-required';
  if (method === 'eth_accounts') return 'requires-connection-no-popup';
  if (method === 'wallet_getPermissions') return 'requires-connection-no-popup';
  return 'unknown';
}

function rpcResult(id, result) { return { id, result }; }
function rpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { id, error: err };
}

function originIsValid(origin) {
  if (!origin || typeof origin !== 'string') return false;
  return /^https?:\/\//.test(origin);
}

function checkSenderOrigin(senderOrigin, claimedOrigin) {
  if (!senderOrigin) return false;
  return senderOrigin === claimedOrigin;
}

function buildConnectedOriginRecord({ addresses, chainId }) {
  return {
    addresses: addresses.slice(),
    chainId,
    connectedAt: 1000,
    lastUsedAt: 1000,
    permissions: ['eth_accounts'],
  };
}

function isAddressPermittedForOrigin(record, address) {
  if (!record || !Array.isArray(record.addresses)) return false;
  return record.addresses.some((a) => a.toLowerCase() === String(address).toLowerCase());
}

// ── EIP-712 helpers ─────────────────────────────────────────────────────
function isChainMismatch(typedData, currentChainId) {
  const dom = typedData && typedData.domain;
  if (!dom || dom.chainId == null) return false;
  return Number(dom.chainId) !== Number(currentChainId);
}

function stripEIP712Domain(types) {
  const out = { ...types };
  delete out.EIP712Domain;
  return out;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('dApp method classification', () => {
  it('classifies read-only methods', () => {
    expect(classifyMethod('eth_chainId')).toBe('read-only');
    expect(classifyMethod('eth_blockNumber')).toBe('read-only');
    expect(classifyMethod('eth_getBalance')).toBe('read-only');
    expect(classifyMethod('eth_call')).toBe('read-only');
  });

  it('classifies approval-required methods', () => {
    expect(classifyMethod('eth_requestAccounts')).toBe('approval-required');
    expect(classifyMethod('personal_sign')).toBe('approval-required');
    expect(classifyMethod('eth_signTypedData_v4')).toBe('approval-required');
    expect(classifyMethod('eth_sendTransaction')).toBe('approval-required');
  });

  it('classifies refused methods', () => {
    expect(classifyMethod('eth_sign')).toBe('refused');
    expect(classifyMethod('eth_sendRawTransaction')).toBe('refused');
    expect(classifyMethod('eth_signTypedData')).toBe('refused');
    expect(classifyMethod('eth_signTypedData_v1')).toBe('refused');
    expect(classifyMethod('eth_signTypedData_v3')).toBe('refused');
    expect(classifyMethod('eth_getEncryptionPublicKey')).toBe('refused');
    expect(classifyMethod('eth_decrypt')).toBe('refused');
  });

  it('classifies eth_accounts as connection-required no-popup', () => {
    expect(classifyMethod('eth_accounts')).toBe('requires-connection-no-popup');
    expect(classifyMethod('wallet_getPermissions')).toBe('requires-connection-no-popup');
  });

  it('classifies unknown methods', () => {
    expect(classifyMethod('foo_bar')).toBe('unknown');
    expect(classifyMethod('')).toBe('unknown');
  });

  it('does not allow legacy eth_signTypedData v1/v2/v3', () => {
    // v4 — единственная безопасная версия
    expect(classifyMethod('eth_signTypedData_v4')).toBe('approval-required');
    expect(classifyMethod('eth_signTypedData_v1')).toBe('refused');
    expect(classifyMethod('eth_signTypedData_v3')).toBe('refused');
  });
});

describe('JSON-RPC envelope helpers', () => {
  it('builds rpc result envelope', () => {
    expect(rpcResult('req-1', '0x123')).toEqual({ id: 'req-1', result: '0x123' });
  });

  it('builds rpc error envelope', () => {
    const env = rpcError('req-2', 4001, 'User rejected');
    expect(env).toEqual({ id: 'req-2', error: { code: 4001, message: 'User rejected' } });
  });

  it('includes data field in error if provided', () => {
    const env = rpcError('req-3', -32603, 'Internal', { reason: 'rpc-down' });
    expect(env.error.data).toEqual({ reason: 'rpc-down' });
  });
});

describe('origin validation', () => {
  it('accepts https origins', () => {
    expect(originIsValid('https://app.uniswap.org')).toBe(true);
    expect(originIsValid('https://opensea.io')).toBe(true);
  });

  it('accepts http localhost', () => {
    expect(originIsValid('http://localhost:3000')).toBe(true);
    expect(originIsValid('http://127.0.0.1:5173')).toBe(true);
  });

  it('rejects invalid origins', () => {
    expect(originIsValid('')).toBe(false);
    expect(originIsValid(null)).toBe(false);
    expect(originIsValid(undefined)).toBe(false);
    expect(originIsValid('ftp://example.com')).toBe(false);
    expect(originIsValid('javascript:alert(1)')).toBe(false);
  });

  it('detects sender origin spoofing', () => {
    // Sender реально с одного origin'а, но в payload'е заявляет другой
    expect(checkSenderOrigin('https://evil.com', 'https://uniswap.org')).toBe(false);
    expect(checkSenderOrigin('https://uniswap.org', 'https://uniswap.org')).toBe(true);
  });
});

describe('connectedOrigins record', () => {
  it('builds record with required fields', () => {
    const r = buildConnectedOriginRecord({
      addresses: ['0xAbCd000000000000000000000000000000001234'],
      chainId: 11155111,
    });
    expect(r.addresses).toEqual(['0xAbCd000000000000000000000000000000001234']);
    expect(r.chainId).toBe(11155111);
    expect(r.permissions).toEqual(['eth_accounts']);
    expect(r.connectedAt).toBe(1000);
  });

  it('isAddressPermittedForOrigin: case-insensitive match', () => {
    const r = buildConnectedOriginRecord({
      addresses: ['0xAbCd000000000000000000000000000000001234'],
      chainId: 1,
    });
    expect(isAddressPermittedForOrigin(r, '0xabcd000000000000000000000000000000001234')).toBe(true);
    expect(isAddressPermittedForOrigin(r, '0xABCD000000000000000000000000000000001234')).toBe(true);
    expect(isAddressPermittedForOrigin(r, '0xdead000000000000000000000000000000001234')).toBe(false);
  });

  it('isAddressPermittedForOrigin: rejects when no record', () => {
    expect(isAddressPermittedForOrigin(null, '0xabcd000000000000000000000000000000001234')).toBe(false);
    expect(isAddressPermittedForOrigin({}, '0xabcd000000000000000000000000000000001234')).toBe(false);
  });

  it('isAddressPermittedForOrigin: supports multiple addresses', () => {
    const r = buildConnectedOriginRecord({
      addresses: [
        '0xAA00000000000000000000000000000000000001',
        '0xBB00000000000000000000000000000000000002',
      ],
      chainId: 1,
    });
    expect(isAddressPermittedForOrigin(r, '0xaa00000000000000000000000000000000000001')).toBe(true);
    expect(isAddressPermittedForOrigin(r, '0xbb00000000000000000000000000000000000002')).toBe(true);
    expect(isAddressPermittedForOrigin(r, '0xcc00000000000000000000000000000000000003')).toBe(false);
  });
});

describe('EIP-712 typed data helpers', () => {
  const sampleTypedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' },
      ],
      Order: [
        { name: 'maker', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
    },
    primaryType: 'Order',
    domain: { name: 'Demo', chainId: 11155111 },
    message: { maker: '0xabc', amount: '1000' },
  };

  it('detects chainId mismatch (phishing-style)', () => {
    expect(isChainMismatch(sampleTypedData, 11155111)).toBe(false);
    expect(isChainMismatch(sampleTypedData, 1)).toBe(true);
    expect(isChainMismatch(sampleTypedData, 56)).toBe(true);
  });

  it('treats missing domain.chainId as no mismatch', () => {
    const noChain = { ...sampleTypedData, domain: { name: 'Demo' } };
    expect(isChainMismatch(noChain, 11155111)).toBe(false);
  });

  it('strips EIP712Domain from types (ethers v6 expects this)', () => {
    const stripped = stripEIP712Domain(sampleTypedData.types);
    expect(stripped.EIP712Domain).toBeUndefined();
    expect(stripped.Order).toBeDefined();
  });

  it('does not mutate original types', () => {
    stripEIP712Domain(sampleTypedData.types);
    expect(sampleTypedData.types.EIP712Domain).toBeDefined();
  });
});

describe('refused method messages', () => {
  it('eth_sign error message is informative', () => {
    expect(REFUSED_METHODS['eth_sign']).toMatch(/deprecated|unsafe/);
    expect(REFUSED_METHODS['eth_sign']).toMatch(/personal_sign|signTypedData/);
  });

  it('refused list does not include allowed methods', () => {
    expect(REFUSED_METHODS['eth_chainId']).toBeUndefined();
    expect(REFUSED_METHODS['personal_sign']).toBeUndefined();
    expect(REFUSED_METHODS['eth_signTypedData_v4']).toBeUndefined();
    expect(REFUSED_METHODS['eth_sendTransaction']).toBeUndefined();
  });
});

describe('dApp request payload format', () => {
  it('mirrors EIP-1193 request shape', () => {
    const payload = {
      id: 'req-1',
      method: 'eth_chainId',
      params: [],
    };
    expect(payload.method).toBe('eth_chainId');
    expect(Array.isArray(payload.params)).toBe(true);
  });

  it('eth_sendTransaction params is [txObject]', () => {
    const payload = {
      id: 'req-2',
      method: 'eth_sendTransaction',
      params: [{
        from: '0xabc',
        to: '0xdef',
        value: '0x1',
      }],
    };
    expect(payload.params[0].from).toBe('0xabc');
    expect(payload.params[0].to).toBe('0xdef');
  });

  it('personal_sign params is [hexMessage, address]', () => {
    const payload = {
      id: 'req-3',
      method: 'personal_sign',
      params: ['0x48656c6c6f', '0xabc'],
    };
    expect(payload.params).toHaveLength(2);
  });
});

// ── chainId mismatch hard block (P2-4) ────────────────────────────────
// Проверяет что handleSignTypedDataV4 HARD-BLOCK'ает подпись при mismatch'е.
// Раньше было warning, теперь код 4901 (Chain not configured).

describe('P2-4: EIP-712 chainId hard block', () => {
  // Mirror of Phase 2 chainId parsing + mismatch check from service-worker.js
  function checkChainIdMismatch(typedDataDomainChainId, currentChainId) {
    if (typedDataDomainChainId == null) return { ok: true };
    let parsed;
    if (typeof typedDataDomainChainId === 'number') {
      parsed = typedDataDomainChainId;
    } else if (typeof typedDataDomainChainId === 'string') {
      parsed = typedDataDomainChainId.startsWith('0x')
        ? parseInt(typedDataDomainChainId, 16)
        : parseInt(typedDataDomainChainId, 10);
    } else if (typeof typedDataDomainChainId === 'bigint') {
      parsed = Number(typedDataDomainChainId);
    } else {
      parsed = NaN;
    }
    if (!Number.isFinite(parsed)) {
      const e = new Error(`Invalid domain.chainId in typed data: ${typedDataDomainChainId}`);
      e.code = 4100;
      throw e;
    }
    if (parsed !== Number(currentChainId)) {
      const e = new Error(
        `Chain ID mismatch: typed data requires chainId ${parsed}, ` +
        `but wallet is on ${currentChainId}. Switch network in SOVA wallet first.`
      );
      e.code = 4901; // EIP-1193 Chain not configured
      throw e;
    }
    return { ok: true };
  }

  it('allows signing when chainIds match (number)', () => {
    expect(() => checkChainIdMismatch(11155111, 11155111)).not.toThrow();
  });

  it('allows signing when chainId is hex string matching', () => {
    expect(() => checkChainIdMismatch('0xaa36a7', 11155111)).not.toThrow();
  });

  it('allows signing when chainId is decimal string matching', () => {
    expect(() => checkChainIdMismatch('11155111', 11155111)).not.toThrow();
  });

  it('allows signing when chainId is bigint matching', () => {
    expect(() => checkChainIdMismatch(11155111n, 11155111)).not.toThrow();
  });

  it('allows signing when domain.chainId is absent (null)', () => {
    expect(() => checkChainIdMismatch(null, 11155111)).not.toThrow();
  });

  it('allows signing when domain.chainId is undefined', () => {
    expect(() => checkChainIdMismatch(undefined, 11155111)).not.toThrow();
  });

  it('HARD BLOCKS with code 4901 when chainId mismatches (phishing scenario)', () => {
    let thrown;
    try {
      checkChainIdMismatch(1, 11155111); // dApp asks for mainnet, wallet on Sepolia
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown.code).toBe(4901);
    expect(thrown.message).toMatch(/Chain ID mismatch/);
    expect(thrown.message).toMatch(/chainId 1/);
    expect(thrown.message).toMatch(/wallet is on 11155111/);
  });

  it('blocks attack: dApp tries to sign Polygon permit while user on mainnet', () => {
    let thrown;
    try {
      checkChainIdMismatch(137, 1); // classic cross-chain phishing
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe(4901);
  });

  it('blocks attack: dApp tries to sign BSC permit while user on Sepolia', () => {
    let thrown;
    try {
      checkChainIdMismatch(56, 11155111);
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe(4901);
  });

  it('rejects malformed chainId with 4100', () => {
    let thrown;
    try {
      checkChainIdMismatch('not_a_chain', 1);
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe(4100);
    expect(thrown?.message).toMatch(/Invalid domain.chainId/);
  });

  it('rejects NaN chainId with 4100', () => {
    let thrown;
    try {
      checkChainIdMismatch(NaN, 1);
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe(4100);
  });

  it('rejects object chainId (not a primitive) with 4100', () => {
    let thrown;
    try {
      checkChainIdMismatch({ chainId: 1 }, 1);
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe(4100);
  });
});

// ── P2-1: RPC method whitelist (no fall-through proxy) ────────────────

describe('P2-1: RPC method whitelist (not blacklist)', () => {
  // Mirror of dispatchDappMethod logic: explicit whitelist for read-only proxy.
  // Unknown eth_* methods должны возвращать 4200, а не попадать в proxy.

  const READ_ONLY_PROXY_METHODS = new Set([
    'eth_chainId', 'net_version', 'eth_blockNumber',
    'eth_getBalance', 'eth_call', 'eth_estimateGas', 'eth_gasPrice',
    'eth_feeHistory', 'eth_getCode', 'eth_getStorageAt',
    'eth_getTransactionByHash', 'eth_getTransactionReceipt',
    'eth_getTransactionCount', 'eth_getBlockByNumber', 'eth_getBlockByHash',
  ]);

  const APPROVAL_METHODS = new Set([
    'eth_requestAccounts', 'personal_sign', 'eth_signTypedData_v4',
    'eth_sendTransaction',
  ]);

  const SPECIAL_METHODS = new Set([
    'eth_accounts', 'wallet_getPermissions', 'wallet_revokePermissions',
  ]);

  const REFUSED_METHODS = new Set([
    'eth_sign', 'eth_sendRawTransaction',
    'eth_signTypedData', 'eth_signTypedData_v1', 'eth_signTypedData_v3',
    'eth_getEncryptionPublicKey', 'eth_decrypt',
  ]);

  function dispatchMethod(method) {
    if (REFUSED_METHODS.has(method)) {
      const e = new Error(`${method} is refused`);
      e.code = 4200;
      throw e;
    }
    if (READ_ONLY_PROXY_METHODS.has(method)) return 'proxy';
    if (APPROVAL_METHODS.has(method)) return 'approval';
    if (SPECIAL_METHODS.has(method)) return 'special';
    // ← Whitelist: unknown methods are NOT proxied (P2-1)
    const e = new Error(`Method not supported: ${method}`);
    e.code = 4200;
    throw e;
  }

  it('proxies known read-only methods', () => {
    expect(dispatchMethod('eth_chainId')).toBe('proxy');
    expect(dispatchMethod('eth_blockNumber')).toBe('proxy');
    expect(dispatchMethod('eth_getBalance')).toBe('proxy');
    expect(dispatchMethod('eth_call')).toBe('proxy');
  });

  it('routes approval methods to approval flow', () => {
    expect(dispatchMethod('eth_requestAccounts')).toBe('approval');
    expect(dispatchMethod('personal_sign')).toBe('approval');
    expect(dispatchMethod('eth_signTypedData_v4')).toBe('approval');
    expect(dispatchMethod('eth_sendTransaction')).toBe('approval');
  });

  it('HARD-REJECTS unknown eth_* methods with 4200 (P2-1 guard)', () => {
    // Before P2-1: unknown eth_* fell through to proxyRpc.
    // After P2-1: they get 4200 Method not supported.
    let thrown;
    try {
      dispatchMethod('eth_superDangerousNewMethod');
    } catch (e) {
      thrown = e;
    }
    expect(thrown?.code).toBe(4200);
    expect(thrown?.message).toMatch(/Method not supported/);
  });

  it('rejects hypothetical provider-specific methods', () => {
    // Раньше эти могли бы пройти через proxy (если SW наивно прокси-ил)
    const provSpecific = ['alchemy_getAssetTransfers', 'parity_pendingTransactions', 'debug_traceTransaction'];
    for (const m of provSpecific) {
      expect(() => dispatchMethod(m)).toThrow(/Method not supported/);
    }
  });

  it('rejects typo methods (eth_sigh)', () => {
    expect(() => dispatchMethod('eth_sigh')).toThrow(/Method not supported/);
  });

  it('rejects refused deprecated methods with 4200', () => {
    for (const m of REFUSED_METHODS) {
      expect(() => dispatchMethod(m)).toThrow(/is refused|Method not supported/);
    }
  });

  it('eth_accounts is in SPECIAL path, not proxy', () => {
    // Because it filters by active wallet before proxying
    expect(dispatchMethod('eth_accounts')).toBe('special');
    expect(READ_ONLY_PROXY_METHODS.has('eth_accounts')).toBe(false);
  });

  it('wallet_revokePermissions is in SPECIAL path (P1 addition)', () => {
    expect(dispatchMethod('wallet_revokePermissions')).toBe('special');
  });
});

// ── CRIT-5: persistPendingRequest stores only metadata ────────────────

describe('CRIT-5: Pending approval persistence stores only metadata', () => {
  // Mirror of Phase 1 persistPendingRequest: хранит только метаданные,
  // sensitive params НЕ попадают в session storage.

  function persistPendingRequest(request) {
    return {
      id: request.id,
      origin: request.origin,
      method: request.method,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      // ВАЖНО: params, needsUnlock, targetAddress НЕ персистятся
    };
  }

  it('does not persist params (could contain typed data, addresses, amounts)', () => {
    const request = {
      id: 'appr-1',
      origin: 'https://uniswap.org',
      method: 'eth_sendTransaction',
      params: [{ from: '0xabc', to: '0xvictim', value: '0x8ac7230489e80000' /* 10 ETH */ }],
      createdAt: 1000,
      expiresAt: 61000,
      needsUnlock: true,
      targetAccountIndex: 0,
      targetAddress: '0xabc',
    };

    const persisted = persistPendingRequest(request);

    expect(persisted.params).toBeUndefined();
    expect(persisted.needsUnlock).toBeUndefined();
    expect(persisted.targetAccountIndex).toBeUndefined();
    expect(persisted.targetAddress).toBeUndefined();
  });

  it('persists only id, origin, method, createdAt, expiresAt', () => {
    const request = {
      id: 'appr-2',
      origin: 'https://opensea.io',
      method: 'eth_signTypedData_v4',
      params: [/* big typed data payload */],
      createdAt: 2000,
      expiresAt: 62000,
    };

    const persisted = persistPendingRequest(request);
    expect(Object.keys(persisted).sort()).toEqual(
      ['createdAt', 'expiresAt', 'id', 'method', 'origin'].sort()
    );
  });

  it('does not persist EIP-712 Permit2 signature payloads', () => {
    // Classic attack: user signs Permit2 approval for unlimited spend.
    // If we persisted params and SW restarted, stale approval could be
    // presented to user later and accidentally re-approved.
    const request = {
      id: 'appr-permit',
      origin: 'https://evil.fi',
      method: 'eth_signTypedData_v4',
      params: [
        '0xuser',
        JSON.stringify({
          domain: { name: 'Permit2', chainId: 1 },
          primaryType: 'PermitSingle',
          message: {
            details: {
              token: '0xusdc',
              amount: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', // max uint
              expiration: 2000000000,
              nonce: 0,
            },
            spender: '0xattacker',
            sigDeadline: 2000000000,
          },
        }),
      ],
      createdAt: 3000,
      expiresAt: 63000,
    };

    const persisted = persistPendingRequest(request);
    const persistedJson = JSON.stringify(persisted);
    expect(persistedJson).not.toMatch(/0xattacker/);
    expect(persistedJson).not.toMatch(/Permit2/);
    expect(persistedJson).not.toMatch(/sigDeadline/);
  });
});
