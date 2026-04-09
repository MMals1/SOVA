# Test Plan Analysis & Coverage Gaps - test-plan-2.md

**Date:** 29 марта 2026  
**Status:** Analysis Complete  
**Based on:** Original test-plan.md + Actual Test Suite Inventory

---

## Executive Summary

### Current Coverage Status
- **Total Test Files:** 16 (5 unit + 2 integration + 9 e2e)
- **Coverage Completeness:** ~55% of planned scenarios
- **Critical Gaps:** 15+ categories of tests missing or incomplete

### Key Findings
1. **✅ Implemented at Expected Level:**
   - Smoke tests (basic popup opening)
   - Basic unlock flow
   - Account switching basics
   - Network scope detection
   - Token flow basics
   - Send flow (ETH and ERC-20)
   - Unit helpers (formatAmount, shortAddr, explorer URLs)

2. **⚠️ Partially Implemented:**
   - Performance baseline (exists but minimal)
   - Resilience tests (exists but scope unclear)
   - Transaction history (scoped tests but not pagination UI)
   - Error handling (only wrong password tested)

3. **❌ Missing or Not Tested:**
   - Service Worker lifecycle and restart
   - Auto-lock mechanism (5 min timeout)
   - Failed unlock attempt lockout (3 attempts + exponential backoff)
   - Security isolation (private key never exposed)
   - Storage persistence across popup reopens
   - Detailed UI state machine consistency
   - Invalid input validation (addresses, tokens, amounts)
   - Gas estimation error scenarios
   - Provider/network fetch failures
   - Token logo fallback rendering
   - Multi-account session consistency
   - Mnemonic validation (import correctness)
   - Lock state transitions (unlock → lock → unlock)
   - CSP compliance for event binding
   - Session timeout behavior

---

## Detailed Gap Analysis

### Layer 1: Unit Tests (Pure Logic)

**Current Status:** 5 files with basic coverage

#### ✅ Already Tested
```
- popup-helpers.test.js
  ✓ shortAddr() formatting
  ✓ formatAmount() precision
  ✓ getTxExplorerBaseUrl() by network
  ✓ getTxScopeKey() generation

- network-state.test.js
  ✓ Network detection

- service-worker-network.test.js
  ✓ RPC fallback logic

- token-scope.test.js
  ✓ Token scoping by network

- tx-pagination.test.js
  ✓ Pagination calculations
```

#### ❌ Missing Unit Tests

1. **Input Validation & Error Cases**
   - Test `shortAddr()` with null, undefined, invalid addresses
   - Test `formatAmount()` with negative, very large numbers, strings
   - Test `getTxScopeKey()` with edge cases (missing network, address format variants)
   - Test `getTxExplorerBaseUrl()` with unknown networks
   - Test pagination with zero items, negative pages, invalid pageSize

2. **Wallet-Core Functions Not Yet Tested**
   - `getTokensForNetwork()` - null/undefined input handling
   - `setTokensForNetwork()` - mutation safety
   - `getTokenLogoUrls()` - fallback logic, network validation
   - `getTotalPages()` - boundary conditions (0 items, 1 item, exact page boundaries)
   - `clampPage()` - out-of-range values
   - `paginateItems()` - slicing correctness

3. **Service Worker Message Handling (Unit)**
   - `unlock` message with invalid account index
   - `unlock` message with missing/empty password
   - Password attempt lockout logic (3 attempts, exponential backoff)
   - Default RPC fallback selection logic
   - Lock/unlock state transitions
   - Session timeout calculation

4. **Popup State Management (Unit)**
   - `PopupState` initialization
   - Account index validation
   - Network selection state mutations
   - RPC configuration updates
   - State persistence helpers

5. **Token State Module**
   - Token list caching
   - Network-specific token filtering
   - Token metadata validation
   - Duplicate token handling

6. **UI Message Helpers (Unit)**
   - Error message display/hiding
   - Status message lifecycle
   - Loading state management
   - Message queue handling

---

### Layer 2: Integration Tests (Component Interaction)

**Current Status:** 2 files with basic coverage

#### ✅ Already Tested
```
- account-switch.test.js
  ✓ Account switching basics

- popup-sw-session.test.js
  ✓ Popup and Service Worker messaging
```

#### ❌ Missing Integration Tests

1. **Unlock Flow & Session Management**
   - Unlock popup → Service Worker state sync ✗
   - Unlock with correct password → session storage updated ✗
   - Unlock attempt with wrong password → retry allowed but with delays ✗
   - Failed unlock attempts (1st, 2nd, 3rd) → incrementing delays ✗
   - Lockout after 3 failed attempts (5-60 min backoff) ✗
   - Lock → Clear session storage → Popup shows unlock screen ✗

2. **Account Consistency**
   - Create account A → Select account B → Unlock fails if B not unlocked ✗
   - Switch account while unlocked → Force re-unlock ✗
   - Import account → Storage persists through popup reopen ✗
   - Multiple accounts → Different keystores, same password handling ✗

3. **Network State Persistence**
   - Select Mainnet → Close popup → Reopen → Mainnet still selected ✗
   - Switch network → Fetch tokens for new network ✗
   - Network change → Token list updates correctly ✗
   - Unsupported RPC URL → Falls back to default ✗

4. **Token State Persistence**
   - Add token to Mainnet → Switch to Sepolia → Token not shown ✗
   - Switch back to Mainnet → Token still present ✗
   - Remove token from Mainnet → Switch networks → Storage updated ✗
   - Invalid token contract address → Shows error, doesn't add ✗

5. **Transaction History Scope**
   - Submit TX on Mainnet → Switch to Sepolia → History empty ✗
   - Switch back to Mainnet → History restored ✗
   - Submit TX as Account A → Switch to Account B → History empty ✗
   - History persists in localStorage with scope key `network:address` ✗

6. **Storage Isolation**
   - Popup gets data via chrome.storage.local/session ✗
   - Service Worker maintains in-memory wallet only ✗
   - Restarting Service Worker → Session cleared → Re-unlock required ✗
   - Multiple popup instances → Shared storage, consistent state ✗

7. **Message Flow Validation**
   - Unknown message type → Service Worker returns error ✗
   - Malformed message → Graceful error handling ✗
   - Timeout on Service Worker response → Popup shows timeout error ✗
   - Service Worker offline → Popup retries or shows offline state ✗

8. **RPC Fallback Mechanism**
   - Custom RPC URL provided → Used for network ✗
   - Custom RPC URL fails → Falls back to default RPC ✗
   - Default RPC fails → Tries alternate public RPC ✗
   - All RPC endpoints fail → User shown network error ✗

---

### Layer 3: E2E Tests (Full User Flows)

**Current Status:** 9 files, moderate coverage

#### ✅ Already Tested
```
- smoke.spec.js
  ✓ Popup opens without JS errors
  ✓ Setup screen visible
  ✓ Tab switching (Create/Import)

- unlock.spec.js
  ✓ Unlock with correct password
  ✓ Error shown for wrong password

- send-eth.spec.js (existence confirmed)
- send-erc20.spec.js (existence confirmed)
- account-onboarding.spec.js (existence confirmed)
- token-flow.spec.js (existence confirmed)
- network-scope.spec.js (existence confirmed)
- perf-baseline.spec.js (exists but unclear scope)
- resilience.spec.js (exists but unclear scope)
```

#### ❌ Missing E2E Test Scenarios

1. **Unlock & Lock Lifecycle**
   - ✗ Multiple failed password attempts (3x) then system lockout
   - ✗ Wait through lockout period (5 min) → Can unlock again
   - ✗ Auto-lock after 5 minutes of inactivity
   - ✗ Lock button → Clears session → Requires re-unlock
   - ✗ Browser close → Service Worker killed → New unlock required
   - ✗ Unlock → Reopen popup → Still unlocked (session active)
   - ✗ Unlock → Wait 5 min → Popup remains but requires re-unlock (alarm fires)

2. **Account Management Flows**
   - ✗ Create first wallet → Choose password → Mnemonic display
   - ✗ Confirm mnemonic (24 words) → Correct order validation
   - ✗ Save mnemonic → Account created → Listed on wallet screen
   - ✗ Add subaccount → New address generated → Listed with index
   - ✗ Import wallet from mnemonic → Validates BIP39 compliance
   - ✗ Invalid mnemonic → Shows error, doesn't import
   - ✗ Duplicate account import (same mnemonic) → Prevents duplicate
   - ✗ Switch between 3+ accounts → State consistent per account

3. **Network & Token Isolation**
   - ✗ Mainnet: Add token A → Balance shows correctly
   - ✗ Switch to Sepolia → Token A not shown
   - ✗ Back to Mainnet → Token A still present with same balance
   - ✗ Sepolia: Add different token B
   - ✗ Network switch → Only network-specific tokens shown
   - ✗ Remove token from Mainnet → Still in Sepolia storage
   - ✗ Invalid token contract → Validation error, not added

4. **Transaction History Scoping**
   - ✗ Send ETH on Mainnet → History shows `out` with amount
   - ✗ Switch account → History empty (different address)
   - ✗ Switch back → History restored (same address)
   - ✗ Switch network → History empty for that network
   - ✗ Back to original network → History shows again
   - ✗ Pagination: 20+ transactions → Pages and nav buttons work
   - ✗ Last page → Next button disabled
   - ✗ First page → Previous button disabled

5. **Send ETH Error Paths**
   - ✗ Invalid recipient address format → Error shown, not sent
   - ✗ Recipient address = current address → Validation error
   - ✗ Amount exceeds balance + gas → Insufficient funds error
   - ✗ Amount = 0 → Validation error
   - ✗ Negative amount → Validation error
   - ✗ Non-numeric amount → Validation error
   - ✗ Gas estimation fails (network down) → Error shown
   - ✗ User cancels before confirmation → No transaction sent

6. **Send ERC-20 Validation**
   - ✗ Token = null → Error shown
   - ✗ Token contract not deployed → Contract fetch fails
   - ✗ Token balance insufficient → Error shown
   - ✗ Approve + Transfer flow → Two transactions required
   - ✗ Approve step fails → Alert shown, transfer not executed
   - ✗ Transfer succeeds but approve failed → Handled gracefully

7. **UI Consistency & Rendering**
   - ✗ All screens render without layout bugs (IBM Plex Mono font)
   - ✗ Network badge shows correct label (MAINNET vs TESTNET)
   - ✗ Account name displays on wallet screen
   - ✗ Balance updates after transaction
   - ✗ Copy address button → Text copied to clipboard
   - ✗ Explorer link → Opens correct txn URL for network
   - ✗ History item shows: in/out arrow, amount, address, status
   - ✗ Pagination buttons state (enabled/disabled) correct

8. **Network Switching**
   - ✗ Network dropdown → Lists all networks
   - ✗ Select Mainnet → Balance/tokens update
   - ✗ Native asset badge shows ETH on Mainnet, BNB on BSC
   - ✗ Network change persists across popup reopen
   - ✗ RPC URL change → Provider updates
   - ✗ Custom RPC failure → Falls back to default
   - ✗ Explorer link uses correct domain per network

9. **Security & Isolation**
   - ✗ Private key never visible in popup (only in SW)
   - ✗ Lock screen and setup screen show no sensitive data
   - ✗ DevTools inspection → No exposed private keys
   - ✗ Search storage → Keystore encrypted
   - ✗ Session storage cleared on lock → No residual data
   - ✗ Service Worker death → Wallet cleared from memory

10. **Error Resilience**
    - ✗ Network briefly cuts → Popup handles gracefully
    - ✗ RPC returns 503 → Shows error, allows retry
    - ✗ Gas estimate fails → Shows error, user can adjust manually
    - ✗ Balance fetch fails → Shows last known balance or "error"
    - ✗ Token metadata fetch fails → Shows fallback data
    - ✗ History fetch fails → Shows cached history or empty
    - ✗ Multi-tab race condition → Storage lock prevents conflicts

---

## Missing Test Categories Summary

### A. Security & Isolation (**CRITICAL**)
- [ ] Private key isolation (never visible to popup)
- [ ] Service Worker memory clearing on lock
- [ ] Session token expiration at 5 min
- [ ] Keystore encryption validation
- [ ] No XSS vectors in UI rendering
- [ ] CSP compliance for event handlers
- **Priority:** Phase 1 (before production)

### B. Error Handling & Validation (**HIGH**)
- [ ] Invalid input validation (addresses, amounts, tokens)
- [ ] Failed unlock attempt lockout (3 attempts + backoff)
- [ ] Gas estimation failure handling
- [ ] All network failure scenarios
- [ ] Mnemonic validation (BIP39)
- [ ] Unused message type handling
- **Priority:** Phase 1

### C. Lifecycle & State Management (**HIGH**)
- [ ] Auto-lock timeout (5 min alarm)
- [ ] Service Worker restart → re-unlock required
- [ ] Lock/unlock state transitions
- [ ] Session storage persistence
- [ ] Multiple popup instance consistency
- [ ] RPC fallback exhaustion
- **Priority:** Phase 1

### D. UI & UX (**MEDIUM**)
- [ ] Pagination rendering and button states
- [ ] Network badge updates
- [ ] Token logo fallback rendering
- [ ] Font consistency (IBM Plex Mono)
- [ ] Copy-to-clipboard functionality
- [ ] Explorer link validation per network
- **Priority:** Phase 2

### E. Data Scope & Isolation (**HIGH**)
- [ ] Transaction history scoped by `network:address`
- [ ] Token list scoped by network
- [ ] Account-specific data never leaks
- [ ] Network state persists across reopen
- [ ] Storage key collision prevention
- **Priority:** Phase 1

### F. Multi-Account Consistency (**HIGH**)
- [ ] Account creation and listing
- [ ] Account switch forces unlock
- [ ] Account data isolated
- [ ] Subaccount generation
- [ ] Account name persistence
- **Priority:** Phase 1

### G. Advanced Flows (**MEDIUM**)
- [ ] Token add/remove with validation
- [ ] Mnemonic import compliance
- [ ] Approve + Transfer pattern (ERC-20)
- [ ] Multiple send attempts in one session
- [ ] Long transaction history (50+ items)
- **Priority:** Phase 2

### H. Performance (**LOW**)
- [ ] Startup time < 1 second
- [ ] Transaction submission < 2 seconds (excluding gas estimation)
- [ ] Popup reopen from cache < 500ms
- [ ] Memory leak detection (long session)
- **Priority:** Phase 2-3

### I. Regression Prevention (**ONGOING**)
- [ ] Chrome version compatibility (V3 MV3)
- [ ] Provider switching (ethers.js API changes)
- [ ] Storage API changes
- [ ] Runtime API changes
- **Priority:** Continuous

---

## Recommended Implementation Order

### Phase 1: Critical Coverage (2-3 weeks)
**Focus:** Security, Lifecycle, State Management

1. **Week 1: Security + State Lifecycle**
   - Auto-lock timeout test (5 min alarm)
   - Failed unlock lockout (3+ attempts)
   - Service Worker restart → re-unlock
   - Lock/unlock transitions
   - Session state consistency

2. **Week 2: Input Validation + Error Handling**
   - Invalid address detection
   - Invalid amount (negative, 0, non-numeric)
   - Gas estimation failure paths
   - Token contract validation
   - Mnemonic BIP39 validation

3. **Week 3: Data Scope Validation**
   - Token list filtering by network
   - Transaction history scope by `network:address`
   - Account data isolation
   - Multi-account session handling

### Phase 2: UX & Advanced Flows (1-2 weeks)
4. Pagination rendering + UI state
5. Network switching completeness
6. Token add/remove flows
7. Explorer link validation

### Phase 3: Performance + Polish (1 week)
8. Performance baselines
9. Memory leak detection
10. Stress testing (many transactions/tokens)

---

## New Test Files to Create

```
tests/
├── unit/
│   ├── wallet-core-edge-cases.test.js          [NEW]
│   ├── service-worker-unlock.test.js           [NEW]
│   ├── service-worker-lockout.test.js          [NEW]
│   ├── input-validation.test.js                [NEW]
│   ├── popup-state.test.js                     [NEW]
│   ├── token-state.test.js                     [NEW]
│   └── ui-messages.test.js                     [NEW]
│
├── integration/
│   ├── unlock-session-lifecycle.test.js        [NEW]
│   ├── account-isolation.test.js               [NEW]
│   ├── network-token-scoping.test.js           [NEW]
│   ├── history-scope.test.js                   [NEW]
│   ├── storage-persistence.test.js             [NEW]
│   ├── rpc-fallback.test.js                    [NEW]
│   └── multi-popup-consistency.test.js         [NEW]
│
└── e2e/
    ├── unlock-lockout.spec.js                  [NEW]
    ├── auto-lock-timeout.spec.js               [NEW]
    ├── account-creation-import.spec.js         [NEW]
    ├── token-scope-isolation.spec.js           [NEW]
    ├── history-pagination.spec.js              [NEW]
    ├── network-switching-scope.spec.js         [NEW]
    ├── send-validation-errors.spec.js          [NEW]
    ├── ui-consistency.spec.js                  [NEW]
    └── error-resilience.spec.js                [NEW]
```

---

## Success Criteria

### Phase 1 Completion (Critical)
- [ ] All security tests passing (private key isolation, memory clearing)
- [ ] All unlock/lock lifecycle tests passing
- [ ] All input validation tests passing
- [ ] All state scoping tests (network, account, token, history) passing
- [ ] <= 3 flaky tests out of 50+

### Phase 2 Completion
- [ ] All UI/UX tests passing
- [ ] All network switching tests passing
- [ ] All advanced flow tests passing

### Phase 3 Completion
- [ ] Performance baselines established
- [ ] No memory leaks detected
- [ ] Full coverage: 85%+ of code paths exercised

---

## Notes & Risks

### Known Risks
- **Service Worker Lifecycle:** SW restart behavior differs in dev vs prod
- **Chrome Version:** V3 MV3 API may differ between Chrome versions
- **Timing-Dependent Tests:** 5-min auto-lock timeout requires careful test isolation
- **Mocking Complexity:** ethers.js wallet creation requires careful mocking

### Recommendations
- Use `faker.js` for test data consistency
- Mock ethers.Wallet creation for speed
- Isolate time-based tests (auto-lock) with fake timers (vitest/jest)
- Run e2e tests in CI with multiple Chrome versions
- Monitor flaky tests after Phase 1 implementation

---

## Test Metrics Template

Add to `test-report.md` after each phase:

```markdown
## Phase 1 Report
- Unit Tests: XX passed, X skipped, X failed
- Integration Tests: XX passed, X skipped, X failed
- E2E Tests: XX passed, X skipped, X failed
- Coverage: XX% lines, XX% branches
- Flakiness: X% (target: < 5%)
```

---

## Appendix: Test Category Mapping

| Category | Layer | Count | Status | Priority |
|----------|-------|-------|--------|----------|
| Security | U/I/E | 8 | ❌ Missing | P0 |
| Unlock/Lock Lifecycle | U/I/E | 12 | ⚠️ Partial | P0 |
| Input Validation | U | 10 | ❌ Missing | P0 |
| Error Handling | U/I/E | 15 | ⚠️ Partial | P0 |
| Data Scoping | I/E | 10 | ⚠️ Partial | P0 |
| Multi-Account | U/I/E | 8 | ⚠️ Partial | P0 |
| Network Switching | I/E | 8 | ⚠️ Partial | P1 |
| Token Management | I/E | 8 | ⚠️ Partial | P1 |
| UI/UX | E | 12 | ❌ Missing | P1 |
| Performance | E | 5 | ⚠️ Minimal | P2 |
| **TOTAL** | | **96** | | |

---

**Analysis Date:** 29 марта 2026  
**Analyst:** Code Review System  
**Status:** Ready for Implementation Plan Review
