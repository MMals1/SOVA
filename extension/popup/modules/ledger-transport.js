'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// ledger-transport.js — WebHID transport for Ledger hardware wallet (6.1)
// Handles raw APDU communication over HID for Ledger Nano S/X/S Plus.
// This module is loaded from the popup context (WebHID is not available in SW).
// ═══════════════════════════════════════════════════════════════════════════

const LEDGER_VENDOR_ID = 0x2c97;
const CHANNEL = 0x0101;
const TAG = 0x05;
const PACKET_SIZE = 64;

// ── WebHID transport ────────────────────────────────────────────────────

let _device = null;

/**
 * Check if WebHID API is available in the current context.
 * @returns {boolean}
 */
function isSupported() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.hid !== 'undefined' &&
    typeof navigator.hid.requestDevice === 'function'
  );
}

/**
 * Check if a Ledger device is currently connected and opened.
 * @returns {boolean}
 */
function isConnected() {
  return _device !== null && _device.opened;
}

/**
 * Request a Ledger device via WebHID and open it.
 * User gesture required (button click triggers browser HID picker).
 * @returns {Promise<boolean>} true if connection succeeded.
 */
async function connect() {
  if (!isSupported()) throw new Error('WebHID is not supported in this context');

  // Check for already-paired devices first
  const paired = await navigator.hid.getDevices();
  _device = paired.find((d) => d.vendorId === LEDGER_VENDOR_ID) || null;

  if (!_device) {
    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: LEDGER_VENDOR_ID }],
    });
    if (!devices || devices.length === 0) {
      throw new Error('No Ledger device selected');
    }
    _device = devices[0];
  }

  if (!_device.opened) {
    await _device.open();
  }

  return true;
}

/**
 * Disconnect the Ledger device.
 */
async function disconnect() {
  if (_device && _device.opened) {
    try {
      await _device.close();
    } catch {
      /* ignore */
    }
  }
  _device = null;
}

/**
 * Send an APDU command and receive the response.
 * Handles HID framing (64-byte packets with channel/tag/sequence headers).
 * @param {number} cla - Class byte
 * @param {number} ins - Instruction byte
 * @param {number} p1 - Parameter 1
 * @param {number} p2 - Parameter 2
 * @param {Uint8Array} [data] - Optional payload
 * @returns {Promise<Uint8Array>} Response data (without SW status if 0x9000)
 */
async function exchange(cla, ins, p1, p2, data) {
  if (!_device || !_device.opened) throw new Error('Ledger not connected');

  // Build APDU
  const payload = data || new Uint8Array(0);
  const apdu = new Uint8Array(5 + payload.length);
  apdu[0] = cla;
  apdu[1] = ins;
  apdu[2] = p1;
  apdu[3] = p2;
  apdu[4] = payload.length;
  apdu.set(payload, 5);

  // Frame into HID packets
  await _sendFramed(apdu);

  // Receive response
  return _receiveFramed();
}

/**
 * Send a framed APDU over HID (split into 64-byte packets).
 * @param {Uint8Array} apdu
 */
async function _sendFramed(apdu) {
  let offset = 0;
  let seq = 0;

  while (offset < apdu.length) {
    const packet = new Uint8Array(PACKET_SIZE + 1); // +1 for report ID
    packet[0] = 0x00; // Report ID
    const view = new DataView(packet.buffer, 1);
    view.setUint16(0, CHANNEL);
    packet[3] = TAG;
    view.setUint16(3, seq);

    let headerLen;
    if (seq === 0) {
      // First packet includes total length
      view.setUint16(5, apdu.length);
      headerLen = 7;
    } else {
      headerLen = 5;
    }

    const chunkSize = Math.min(PACKET_SIZE - headerLen, apdu.length - offset);
    packet.set(apdu.subarray(offset, offset + chunkSize), 1 + headerLen);
    offset += chunkSize;
    seq++;

    await _device.sendReport(0x00, packet.subarray(1));
  }
}

/**
 * Receive a framed response from the Ledger.
 * @returns {Promise<Uint8Array>}
 */
async function _receiveFramed() {
  let totalLength = 0;
  let collected = new Uint8Array(0);
  let seq = 0;
  const TIMEOUT_MS = 120_000; // 2 min for user confirmation on device

  while (true) {
    const report = await _waitForInputReport(TIMEOUT_MS);
    const data = new Uint8Array(report.data.buffer);

    // Verify channel and tag
    const ch = (data[0] << 8) | data[1];
    if (ch !== CHANNEL) continue;
    if (data[2] !== TAG) continue;

    const rSeq = (data[3] << 8) | data[4];
    if (rSeq !== seq) continue;

    let headerLen;
    if (seq === 0) {
      totalLength = (data[5] << 8) | data[6];
      headerLen = 7;
    } else {
      headerLen = 5;
    }

    const chunk = data.subarray(headerLen);
    const merged = new Uint8Array(collected.length + chunk.length);
    merged.set(collected);
    merged.set(chunk, collected.length);
    collected = merged;
    seq++;

    if (collected.length >= totalLength) break;
  }

  const response = collected.subarray(0, totalLength);

  // Check status word (last 2 bytes)
  if (response.length < 2) throw new Error('Invalid Ledger response');
  const sw = (response[response.length - 2] << 8) | response[response.length - 1];

  if (sw === 0x9000) {
    return response.subarray(0, response.length - 2);
  }
  if (sw === 0x6985) throw new Error('Ledger: user rejected');
  if (sw === 0x6a80) throw new Error('Ledger: invalid data');
  if (sw === 0x6d00) throw new Error('Ledger: Ethereum app not open');
  if (sw === 0x6e00) throw new Error('Ledger: wrong app or device locked');
  throw new Error(`Ledger error: 0x${sw.toString(16).padStart(4, '0')}`);
}

/**
 * Wait for an input report with timeout.
 * @param {number} timeoutMs
 * @returns {Promise<HIDInputReportEvent>}
 */
function _waitForInputReport(timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      _device.removeEventListener('inputreport', handler);
      reject(new Error('Ledger: response timeout'));
    }, timeoutMs);

    function handler(event) {
      clearTimeout(timer);
      _device.removeEventListener('inputreport', handler);
      resolve(event);
    }

    _device.addEventListener('inputreport', handler);
  });
}

// ── Public API ──────────────────────────────────────────────────────────
export const LedgerTransport = Object.freeze({
  isSupported,
  isConnected,
  connect,
  disconnect,
  exchange,
  LEDGER_VENDOR_ID,
});

globalThis.LedgerTransport = LedgerTransport;
