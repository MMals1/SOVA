# Test Plan for Wolf Wallet Extension

## Goals

- Verify the extension works correctly as a Chrome Manifest V3 wallet.
- Catch regressions in popup UI, service worker state, account switching, network switching, token handling, and transaction flow.
- Separate fast checks from higher-value end-to-end scenarios.

## Test Strategy

### 1. Smoke Tests

Purpose: confirm the extension opens and core flows are not broken after changes.

Scenarios:
- Popup opens without JS errors.
- Setup screen allows switching between `Войти` and `Создать`.
- Unlock screen accepts password flow.
- Wallet screen loads balance, token list, and transaction history.
- Network selector opens and changes between Ethereum Mainnet and Ethereum Sepolia.

### 2. Unit-Level Logic Tests

Purpose: validate deterministic logic in popup and service worker.

Targets in popup logic:
- Address formatting:
  - `shortAddr()`
- Amount formatting:
  - `formatAmount()`
- Network helpers:
  - current network resolution
  - explorer URL generation
  - token logo URL generation
- Transaction helpers:
  - transaction scope key generation by `network + address`
  - pagination calculations
- RPC selection logic:
  - default RPC vs custom RPC per network

Targets in service worker logic:
- Active network parameter resolution
- Default RPC fallback selection
- Lock/unlock state transitions
- Validation for `send-eth` and `send-erc20`

## Integration Tests

Purpose: verify popup and service worker work together through Chrome messaging and storage.

Scenarios:
- Create wallet -> unlock -> wallet screen loads.
- Import wallet -> unlock -> wallet screen loads.
- Switch active account -> extension forces correct unlock for selected account.
- If service worker wallet differs from selected popup account, send flow is blocked and user is redirected to unlock.
- Auto-lock clears session and requires re-unlock.
- Network state persists in storage across popup reopen.

## End-to-End Tests

Purpose: validate real user flows in browser context.

### Account Flows
- Create first wallet.
- Save mnemonic confirmation flow.
- Unlock wallet after popup reopen.
- Add subaccount.
- Switch between accounts.

### Network Flows
- Switch from Sepolia to Mainnet.
- Verify balance/token/history are network-specific.
- Verify transaction explorer links match selected network.

### Token Flows
- Add token in Mainnet.
- Confirm token appears only in Mainnet.
- Switch to Sepolia and confirm token is not shown there unless explicitly added.
- Remove token and verify it disappears only for current network.
- Verify token logo rendering and fallback behavior.

### Transaction Flows
- ETH send flow: estimate gas -> confirm -> submit.
- ERC-20 send flow: estimate gas -> confirm -> submit.
- Insufficient funds path shows correct error.
- Locked service worker path returns user to unlock screen.
- Transaction history updates after send.
- Transaction history pagination works across many records.

## UI Test Coverage

Purpose: ensure visible states remain usable.

Checks:
- Buttons are clickable under MV3 CSP.
- IBM Plex Mono is applied consistently to text, inputs, and buttons.
- Global logo renders correctly across setup, unlock, wallet, and confirm screens.
- History items show:
  - `in` with green arrow
  - `out` with red arrow
  - correct `from` or `to`
  - shortened hash
  - copy button
  - explorer link
- Pagination buttons enable/disable correctly.
- Network badge updates between MAINNET and TESTNET.

## Error Handling Tests

Scenarios:
- Wrong unlock password.
- Invalid mnemonic import.
- Invalid recipient address.
- Invalid token contract address.
- Unsupported custom RPC URL.
- Provider/network fetch failure.
- Service worker restart while popup stays open.

## Security-Focused Tests

Checks:
- Private key is never exposed to popup context.
- Service worker stores decrypted wallet only in memory.
- Lock clears session state.
- Account switch cannot silently reuse wrong unlocked signer.
- Token/network history caches remain scoped by network and address.

## Suggested Test Layers and Tools

### Layer 1. Fast Logic Tests
Recommended tools:
- Vitest or Jest

Test only pure helpers and isolated state logic.

### Layer 2. DOM/Popup Tests
Recommended tools:
- Vitest + jsdom

Test:
- screen switching
- event binding compatibility layer
- pagination rendering
- transaction item rendering

### Layer 3. Browser E2E Tests
Recommended tools:
- Playwright

Test against loaded unpacked extension in Chromium.

## Priority Order

### Phase 1
- Smoke tests
- Account unlock flow
- Account switch signer consistency
- Network-specific token/history behavior
- ETH send insufficient funds path

### Phase 2
- Transaction history rendering and pagination
- Token add/remove flows
- Explorer links by network
- Service worker lock/unlock lifecycle

### Phase 3
- Token logo fallback matrix
- More edge-case RPC/provider failures
- Long-session and service-worker restart behavior

## Minimal Initial Test Set

Start with these first:
- `shortAddr()` formatting
- explorer URL generation by network
- transaction scope key generation
- transaction pagination logic
- selected account vs unlocked signer mismatch handling
- token storage scoped by network
- transaction history scoped by network

## Folder Structure Proposal

```text
tests/
  test-plan.md
  unit/
    popup-helpers.test.js
    network-state.test.js
    tx-pagination.test.js
    token-scope.test.js
  integration/
    popup-sw-session.test.js
    account-switch.test.js
  e2e/
    smoke.spec.js
    unlock.spec.js
    send-eth.spec.js
    token-flow.spec.js
    network-scope.spec.js
```

## Exit Criteria

Testing is in acceptable state when:
- Core wallet flows pass reliably.
- Account switching cannot send from wrong signer.
- Network-specific state isolation is covered.
- Transaction rendering and pagination are covered.
- No critical regression remains in popup interaction under MV3.
