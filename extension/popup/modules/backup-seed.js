'use strict';

import { WolfPopupStorage } from './storage.js';
import { WolfPopupClipboard } from './clipboard.js';
import { WolfPopupUiState } from './ui-state.js';

const _Storage = globalThis.WolfPopupStorage;
const getLocal = _Storage
  ? _Storage.getLocal.bind(_Storage)
  : (keys) => new Promise((r) => chrome.storage.local.get(keys, r));

function showBackupSeed() {
  const authDiv = document.getElementById('backup-seed-auth');
  const displayDiv = document.getElementById('backup-seed-display');
  const errEl = document.getElementById('backup-seed-error');
  const pwdInput = document.getElementById('backup-seed-password');
  const mnemonicEl = document.getElementById('backup-mnemonic-display');
  if (authDiv) authDiv.style.display = '';
  if (displayDiv) displayDiv.style.display = 'none';
  if (errEl) {
    errEl.style.display = 'none';
    errEl.textContent = '';
  }
  if (pwdInput) pwdInput.value = '';
  if (mnemonicEl) {
    mnemonicEl.textContent = '';
    mnemonicEl.classList.add('seed-blurred');
    mnemonicEl.classList.remove('seed-revealed');
  }
  const hintEl = document.getElementById('backup-blur-hint');
  if (hintEl) hintEl.classList.remove('hidden');
  if (typeof globalThis.showScreen === 'function') globalThis.showScreen('screen-backup-seed');
}

async function unlockBackupSeed() {
  const pwdInput = document.getElementById('backup-seed-password');
  const errEl = document.getElementById('backup-seed-error');
  const authDiv = document.getElementById('backup-seed-auth');
  const displayDiv = document.getElementById('backup-seed-display');
  const mnemonicEl = document.getElementById('backup-mnemonic-display');
  const btn = document.getElementById('btn-backup-seed-unlock');
  const password = pwdInput?.value || '';
  if (!password) {
    errEl.textContent = 'Введите пароль';
    errEl.style.display = 'block';
    return;
  }
  if (btn) btn.disabled = true;
  errEl.style.display = 'none';
  try {
    const { accounts = [] } = await getLocal(['accounts']);
    const keystore = accounts[0]?.keystore;
    if (!keystore) throw new Error('Аккаунт не найден');
    const wallet = await ethers.Wallet.fromEncryptedJson(keystore, password);
    const phrase = wallet.mnemonic?.phrase;
    if (!phrase) throw new Error('Мнемоника недоступна (кошелёк импортирован по ключу)');
    mnemonicEl.textContent = phrase;
    mnemonicEl.classList.add('seed-blurred');
    mnemonicEl.classList.remove('seed-revealed');
    authDiv.style.display = 'none';
    displayDiv.style.display = '';
    function revealHandler() {
      mnemonicEl.classList.remove('seed-blurred');
      mnemonicEl.classList.add('seed-revealed');
      const hintEl = document.getElementById('backup-blur-hint');
      if (hintEl) hintEl.classList.add('hidden');
      mnemonicEl.removeEventListener('click', revealHandler);
    }
    mnemonicEl.addEventListener('click', revealHandler);
    const hintEl = document.getElementById('backup-blur-hint');
    if (hintEl) hintEl.addEventListener('click', revealHandler, { once: true });
  } catch (e) {
    errEl.textContent =
      e.message === 'Неверный пароль' || e.message?.includes('invalid')
        ? 'Неверный пароль'
        : e.message;
    errEl.style.display = 'block';
  } finally {
    if (btn) btn.disabled = false;
    if (pwdInput) pwdInput.value = '';
  }
}

function copyBackupSeed() {
  const mnemonicEl = document.getElementById('backup-mnemonic-display');
  const statusEl = document.getElementById('backup-seed-status');
  const text = mnemonicEl?.textContent;
  if (!text) return;
  navigator.clipboard
    .writeText(text)
    .then(() => {
      if (statusEl) {
        statusEl.textContent = '✓ Скопировано (очистится через 30 сек)';
        statusEl.style.display = 'block';
      }
      setTimeout(() => {
        navigator.clipboard.writeText('').catch(() => {});
        if (statusEl) {
          statusEl.textContent = 'Буфер очищен';
          setTimeout(() => {
            statusEl.style.display = 'none';
          }, 2000);
        }
      }, 30000);
    })
    .catch(() => {
      if (statusEl) {
        statusEl.textContent = 'Ошибка копирования';
        statusEl.style.display = 'block';
      }
    });
}

// ── Public API ──────────────────────────────────────────────────────────
export const WolfPopupBackupSeed = {
  showBackupSeed,
  unlockBackupSeed,
  copyBackupSeed,
};

globalThis.WolfPopupBackupSeed = WolfPopupBackupSeed;
globalThis.showBackupSeed = showBackupSeed;
globalThis.unlockBackupSeed = unlockBackupSeed;
globalThis.copyBackupSeed = copyBackupSeed;
