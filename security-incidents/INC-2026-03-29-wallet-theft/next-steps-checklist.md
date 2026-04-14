# Incident Next Steps Checklist

## Immediate (0-2 hours)

- [ ] Stop all use of compromised address.
- [ ] Transfer any remaining funds from related wallets/accounts to a new wallet on a clean device.
- [ ] Revoke token approvals for compromised address.
- [ ] Export and save browser extension list.
- [ ] Preserve local logs and timeline artifacts before cleanup.

## Short-Term (same day)

- [ ] Run malware/infostealer scan (full scan, not quick).
- [ ] Audit browser profile for suspicious extensions or tampering.
- [ ] Rotate critical credentials possibly exposed on same machine.
- [ ] Build a clean machine/browser profile dedicated to wallet operations.

## Product Hardening (this week)

- [ ] Add optional password re-auth for mainnet sends.
- [ ] Add first-time recipient warning and high-risk destination confirmation.
- [ ] Add send limits (per tx/day) for mainnet mode.
- [ ] Add local signed-action audit trail for forensic reconstruction.
- [ ] Add stronger user guidance about seed phrase handling risks.

## Investigation Questions

- [ ] Was the wallet unlocked at theft time?
- [ ] Was mnemonic ever copied to clipboard or cloud notes?
- [ ] Any unknown software installed in last 7 days?
- [ ] Any suspicious browser extension updates in last 7 days?
- [ ] Any parallel suspicious outbound transactions from same or related addresses?

Для расследования (вам нужно проверить самостоятельно в коде SOVA):

Как хранится приватный ключ/сид — chrome.storage.local? localStorage? В зашифрованном ли виде?
Есть ли в коде проверка origin при получении запросов на подпись от window.ethereum?
Есть ли content_scripts в manifest.json, которые имеют доступ ко всем страницам ("matches": ["<all_urls>"])?
Нет ли в коде отправки данных на внешние URL (fetch/XMLHttpRequest с ключами)
