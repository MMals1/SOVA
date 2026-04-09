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
};
