# ETH Wallet

## Продакшн

Папка `extension/` — Chrome-расширение (Manifest V3).

- `extension/manifest.json` — конфиг расширения
- `extension/popup/` — UI кошелька (popup.html, popup.js, dev.html)
- `extension/background/` — service worker
- `extension/libs/` — ethers.js v6 (UMD-бандл)
- `extension/dev-polyfill.js` — заменяет chrome.storage на localStorage для локальной разработки

**Загрузить в Chrome:** `chrome://extensions` → «Загрузить распакованное» → папка `extension/`

**Запуск dev-версии локально:**
```bash
cd extension
python3 -m http.server 8080
# → http://localhost:8080/popup/dev.html
```

---

## Остальное

| Папка / файл | Назначение |
|---|---|
| `scripts/` | Утилиты (генерация мнемоники и т.п.) |
| `study/` | Учебные примеры и эксперименты |
| `tests/` | Тесты |
| `keystore/`, `wallets/`, `*.json` | Тестовые кошельки и ключи (не использовать в проде) |
| `main.py`, `config.py` | Python-дублирование логики кошелька (для изучения) |
| `.venv/`, `requirements.txt` | Python-окружение для скриптов |

> **Сеть:** Sepolia testnet. RPC — Alchemy.
