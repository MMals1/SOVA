'use strict';

// Дефолтные RPC URL по сетям. Используются publicnode endpoints, которые
// бесплатны, не требуют API key и не привязаны ни к одному аккаунту.
//
// SECURITY NOTE: НЕ хранить здесь private API keys. Если пользователь хочет
// использовать Alchemy/Infura/etc., он вводит свой ключ через popup
// (см. extension/popup/popup.html → "Использовать встроенный API ключ"),
// который сохраняется в chrome.storage.local и применяется только локально.
globalThis.WOLF_WALLET_RPC_DEFAULTS = {
  'eth-mainnet': 'https://ethereum-rpc.publicnode.com',
  'eth-sepolia': 'https://ethereum-sepolia-rpc.publicnode.com',
  bsc: 'https://bsc-rpc.publicnode.com',

  // Moralis API key — дефолтный, встроенный. Один ключ для всех сетей
  // (ETH, Sepolia, BSC и 20+ других). Free tier: 40K CU/день.
  // Пользователь может заменить на свой через настройки.
  moralisApiKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6ImFlYTFlZWMyLTIzYmEtNGRkYy05ZDJhLTZmZmNlMzIwNzNjYiIsIm9yZ0lkIjoiNTA4OTUzIiwidXNlcklkIjoiNTIzNjYyIiwidHlwZUlkIjoiZTgwZDhkOGMtMmM1OC00NjBiLWI4N2QtMDRhYTBlYmM0ZjgxIiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3NzU3MzQ5MjYsImV4cCI6NDkzMTQ5NDkyNn0.EqviI_sQxqGGXE-hWz2pwTd4UgrrAzDzBCZIVcREXws',
};
