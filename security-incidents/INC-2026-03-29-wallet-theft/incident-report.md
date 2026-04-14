# Security Incident Report

Incident ID: INC-2026-03-29-wallet-theft
Status: Open (containment in progress)
Severity: Critical
Type: Unauthorized transfer of real funds

## 1. Incident Summary

A confirmed unauthorized transfer was executed from the victim wallet to an attacker-controlled address on Ethereum mainnet.

Victim address:

- 0xAbDb2D1C02f0A2130bDD5731c9048bB386cD9B61

Attacker address:

- 0xeeeee90971B6264C53175D3Af6840a8dD5dc7b6C

Theft transaction hash:

- 0xf0ee06d6aa87ff8e274937c731e1ba9beb4c3b01fc87e7e57db0c0701a3c4a42

## 2. On-Chain Evidence (Verified)

Data retrieved from Ethereum mainnet RPC (`https://ethereum-rpc.publicnode.com`):

- `from`: `0xabdb2d1c02f0a2130bdd5731c9048bb386cd9b61`
- `to`: `0xeeeee90971b6264c53175d3af6840a8dd5dc7b6c`
- `chainId`: `0x1` (Ethereum mainnet)
- `status`: `0x1` (success)
- `type`: `0x0` (legacy transfer)
- `input`: `0x` (plain ETH transfer)
- `value`: `0x2fe19eea3a5a8` wei = `0.000842337284761` ETH
- `gasUsed`: `0x5208` (21000)
- `blockNumber`: `0x179de38`
- `blockTimestamp`: `0x69c93cb3` = `2026-03-29T14:52:35.000Z`

Conclusion: the transaction is a valid, signed transfer from the victim account.

## 3. Technical Assessment (How Attack Was Possible)

### 3.1 Most probable root cause

The private key (or mnemonic, or unlocked signing session on the victim machine) was compromised outside normal wallet UI protections.

Why this is the most likely scenario:

- Transaction is a normal ETH transfer with a valid signature from the victim address.
- The extension signs only via service worker wallet object in memory; no backend custodian exists.
- No evidence in current extension architecture that funds can move without access to signing capability.

### 3.2 Plausible attack vectors

1. Seed phrase exposure:

- Clipboard leakage, screenshot/cloud sync, notes app backup, browser form history leak.

2. Password compromise + encrypted keystore theft:

- Local malware/keylogger captured password and used stored encrypted keystore from browser storage.

3. Host/browser compromise:

- Infostealer malware, malicious extension, remote-control malware, or compromised browser profile.

4. Active unlocked-session abuse:

- If wallet was unlocked, attacker with machine/browser control could trigger send flow.

### 3.3 Code-level risk review (current project)

Observed from codebase:

- Keystore is stored in `chrome.storage.local` (encrypted).
- Decrypted wallet exists in service worker memory and is cleared on lock/auto-lock.
- No backend key custody.
- `chrome.runtime.onMessage` handles signing actions (`send-eth`, `send-erc20`).

Important note:

- This design still depends on endpoint security of the user device/browser profile. If host is compromised, key material or unlocked session can be abused.

## 4. Containment Actions (Immediate)

1. Stop using compromised wallet immediately.
2. Move all remaining assets from related wallets/derivations to a new wallet generated on a clean device.
3. Revoke token approvals for compromised address.
4. Rotate all secrets potentially exposed on same machine:

- exchange API keys
- email password + 2FA reset
- cloud storage credentials

5. Preserve evidence before cleanup:

- browser profile snapshot
- extension list + versions
- OS logs around theft time

## 5. Eradication & Recovery Plan

1. Reinstall OS or run full incident-response cleanup for infostealer risk.
2. Reinstall browser from trusted source and use clean profile.
3. Reinstall SOVA extension from trusted local build/repo state.
4. Use hardware wallet for mainnet funds.
5. Enable strict operational controls:

- dedicated browser profile for crypto only
- no unknown extensions
- no clipboard managers for seed/passwords

## 6. Next Investigation Steps

1. Confirm if any other outbound transactions from victim address occurred near incident time.
2. Audit installed browser extensions and recent installs/updates.
3. Check for suspicious processes, launch agents, and persistence mechanisms on host.
4. Verify whether mnemonic/password ever touched clipboard or cloud-synced notes.
5. Compare compromised tx time with local machine activity timeline.

## 7. Recommended Product Hardening (SOVA)

1. Add optional per-transaction password re-authentication for mainnet.
2. Add recipient risk warning screen for first-time addresses.
3. Add spending limits / daily cap for mainnet sends.
4. Add local anomaly telemetry log (non-sensitive) for forensics.
5. Add explicit device-compromise warning in UI when enabling mainnet.
