'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// ledger-eth.js — Ledger Ethereum App protocol (6.1)
// Implements getAddress, signTransaction, signPersonalMessage via APDU.
// Uses LedgerTransport for raw HID communication.
// Reference: https://github.com/LedgerHQ/app-ethereum/blob/develop/doc/ethapp.adoc
// ═══════════════════════════════════════════════════════════════════════════

const CLA = 0xe0;

// Instruction codes
const INS_GET_ADDRESS = 0x02;
const INS_SIGN_TX = 0x04;
const INS_SIGN_MESSAGE = 0x08;
const INS_GET_APP_CONFIG = 0x06;

/**
 * Serialize a BIP44 derivation path into bytes.
 * Default: m/44'/60'/0'/0/index
 * @param {number} [accountIndex=0]
 * @returns {Uint8Array}
 */
function _serializePath(accountIndex = 0) {
  const path = [
    0x8000002c, // 44'
    0x8000003c, // 60'
    0x80000000, // 0'
    0x00000000, // 0
    accountIndex & 0x7fffffff,
  ];
  const buf = new Uint8Array(1 + path.length * 4);
  buf[0] = path.length;
  const view = new DataView(buf.buffer);
  for (let i = 0; i < path.length; i++) {
    view.setUint32(1 + i * 4, path[i]);
  }
  return buf;
}

/**
 * Get the Ethereum address from the Ledger device.
 * @param {number} [accountIndex=0]
 * @param {boolean} [verify=false] - If true, displays address on device screen.
 * @returns {Promise<{address: string, publicKey: string}>}
 */
async function getAddress(accountIndex = 0, verify = false) {
  const transport = globalThis.LedgerTransport;
  if (!transport || !transport.isConnected()) {
    throw new Error('Ledger not connected');
  }

  const pathData = _serializePath(accountIndex);
  const result = await transport.exchange(
    CLA,
    INS_GET_ADDRESS,
    verify ? 0x01 : 0x00,
    0x00,
    pathData,
  );

  // Parse response: [pubKeyLen, pubKey..., addrLen, addr...]
  const pubKeyLen = result[0];
  const pubKey = result.subarray(1, 1 + pubKeyLen);
  const addrLen = result[1 + pubKeyLen];
  const addrBytes = result.subarray(2 + pubKeyLen, 2 + pubKeyLen + addrLen);
  const address = '0x' + new TextDecoder().decode(addrBytes);

  return {
    address,
    publicKey:
      '0x' +
      Array.from(pubKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(''),
  };
}

/**
 * Get the Ethereum app configuration from the Ledger.
 * @returns {Promise<{version: string, arbitraryDataEnabled: boolean}>}
 */
async function getAppConfig() {
  const transport = globalThis.LedgerTransport;
  if (!transport || !transport.isConnected()) {
    throw new Error('Ledger not connected');
  }

  const result = await transport.exchange(CLA, INS_GET_APP_CONFIG, 0x00, 0x00);
  return {
    arbitraryDataEnabled: !!(result[0] & 0x01),
    version: `${result[1]}.${result[2]}.${result[3]}`,
  };
}

/**
 * Sign a raw serialized transaction on the Ledger.
 * The transaction must be RLP-encoded (unsigned).
 * @param {Uint8Array} rawTxBytes - RLP-encoded unsigned transaction
 * @param {number} [accountIndex=0]
 * @returns {Promise<{v: number, r: string, s: string}>}
 */
async function signTransaction(rawTxBytes, accountIndex = 0) {
  const transport = globalThis.LedgerTransport;
  if (!transport || !transport.isConnected()) {
    throw new Error('Ledger not connected');
  }

  const pathData = _serializePath(accountIndex);

  // First chunk: path + beginning of tx data
  const MAX_CHUNK = 255;
  let offset = 0;
  let isFirst = true;

  while (offset < rawTxBytes.length || isFirst) {
    let chunk;
    if (isFirst) {
      const txChunkLen = Math.min(MAX_CHUNK - pathData.length, rawTxBytes.length);
      chunk = new Uint8Array(pathData.length + txChunkLen);
      chunk.set(pathData);
      chunk.set(rawTxBytes.subarray(0, txChunkLen), pathData.length);
      offset = txChunkLen;
    } else {
      const txChunkLen = Math.min(MAX_CHUNK, rawTxBytes.length - offset);
      chunk = rawTxBytes.subarray(offset, offset + txChunkLen);
      offset += txChunkLen;
    }

    const p1 = isFirst ? 0x00 : 0x80;
    const isLast = offset >= rawTxBytes.length;
    isFirst = false;

    if (isLast) {
      const result = await transport.exchange(CLA, INS_SIGN_TX, p1, 0x00, chunk);
      // Parse signature: v (1 byte) + r (32 bytes) + s (32 bytes)
      const v = result[0];
      const r =
        '0x' +
        Array.from(result.subarray(1, 33))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      const s =
        '0x' +
        Array.from(result.subarray(33, 65))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      return { v, r, s };
    } else {
      await transport.exchange(CLA, INS_SIGN_TX, p1, 0x00, chunk);
    }
  }

  throw new Error('Ledger: unexpected end of signing flow');
}

/**
 * Sign a personal message (EIP-191) on the Ledger.
 * @param {string|Uint8Array} message - UTF-8 string or raw bytes
 * @param {number} [accountIndex=0]
 * @returns {Promise<{v: number, r: string, s: string}>}
 */
async function signPersonalMessage(message, accountIndex = 0) {
  const transport = globalThis.LedgerTransport;
  if (!transport || !transport.isConnected()) {
    throw new Error('Ledger not connected');
  }

  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

  const pathData = _serializePath(accountIndex);

  // Build header: path + message length (4 bytes BE)
  const header = new Uint8Array(pathData.length + 4);
  header.set(pathData);
  new DataView(header.buffer).setUint32(pathData.length, msgBytes.length);

  const MAX_CHUNK = 255;
  let offset = 0;
  let isFirst = true;

  // Combine header + message into sequential chunks
  const fullPayload = new Uint8Array(header.length + msgBytes.length);
  fullPayload.set(header);
  fullPayload.set(msgBytes, header.length);

  while (offset < fullPayload.length) {
    const chunkLen = Math.min(MAX_CHUNK, fullPayload.length - offset);
    const chunk = fullPayload.subarray(offset, offset + chunkLen);
    const p1 = isFirst ? 0x00 : 0x80;
    offset += chunkLen;
    isFirst = false;

    if (offset >= fullPayload.length) {
      const result = await transport.exchange(CLA, INS_SIGN_MESSAGE, p1, 0x00, chunk);
      const v = result[0];
      const r =
        '0x' +
        Array.from(result.subarray(1, 33))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      const s =
        '0x' +
        Array.from(result.subarray(33, 65))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      return { v, r, s };
    } else {
      await transport.exchange(CLA, INS_SIGN_MESSAGE, p1, 0x00, chunk);
    }
  }

  throw new Error('Ledger: unexpected end of signing flow');
}

// ── Public API ──────────────────────────────────────────────────────────
export const LedgerEth = Object.freeze({
  getAddress,
  getAppConfig,
  signTransaction,
  signPersonalMessage,
});

globalThis.LedgerEth = LedgerEth;
