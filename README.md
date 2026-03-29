# ETH Wallet

## Production Extension

Папка `extension/` — production Chrome-расширение (Manifest V3).

- `extension/manifest.json` — конфиг расширения
- `extension/popup/popup.html` — UI popup
- `extension/popup/popup.js` — логика popup
- `extension/popup/logo.jpeg` — бренд-логотип
- `extension/background/service-worker.js` — service worker
- `extension/libs/ethers.umd.min.js` — ethers.js v6 UMD
- `extension/network-config.js` — дефолтные RPC-конфиги по сетям

**Загрузить в Chrome:** `chrome://extensions` → «Загрузить распакованное» → папка `extension/`

## Packaging

Для Chrome Web Store упаковывайте только содержимое `extension/`.
