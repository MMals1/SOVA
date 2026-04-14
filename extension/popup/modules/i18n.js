'use strict';

import { WolfPopupStorage } from './storage.js';

// ── i18n: Русский + English ───────────────────────────────────────────
// Все UI-строки popup'а. Элементы в popup.html помечены data-lang="key".
// applyLang() подставляет textContent из текущего языка.
// Элементы с дочерними HTML-нодами (label > input) пропускаются.

const translations = {
  ru: {
    // ── Setup screen ──
    tabLogin: 'Войти',
    tabCreate: 'Создать',
    labelMnemonic: 'Мнемоническая фраза (12 слов)',
    labelPassword: 'Пароль',
    hintEncrypt: 'Шифрует ключ локально — никуда не уходит',
    btnLogin: 'Войти',
    labelNewPassword: 'Пароль нового кошелька',
    btnCreate: 'Создать кошелёк',
    labelNetwork: 'Сеть',
    labelUsePublicRpc: 'Использовать публичный RPC',
    labelRpcUrl: 'RPC URL (активная сеть)',
    labelEtherscanKey: 'Etherscan API ключ',
    hintEtherscanOptional: '',
    btnSaveKey: 'Сохранить',
    hintEtherscanLink: 'Один ключ работает для ETH, Sepolia, BSC и других сетей.',

    // ── Mnemonic screen ──
    titleMnemonic: 'Сохраните фразу восстановления',
    warnMnemonic: '⚠️ Запишите эти 12 слов. Без них кошелёк нельзя восстановить.',
    btnCopy: 'Скопировать',
    btnSaved: 'Я сохранил →',

    // ── Quiz screen ──
    titleQuiz: 'Проверка фразы',
    subtitleQuiz: 'Введите слова по номерам, чтобы подтвердить что фраза сохранена',
    btnVerify: 'Подтвердить →',
    btnBackMnemonic: '← Посмотреть фразу снова',

    // ── Unlock screen ──
    labelUnlockPassword: 'Пароль',
    btnUnlock: 'Разблокировать',
    btnDeleteWallet: 'Удалить кошелёк',

    // ── Wallet screen ──
    btnSend: '↑ Отправить',
    btnAddToken: '+ Токен',
    tabTokens: 'Токены',
    tabHistory: 'История',
    titleTransactions: 'Транзакции',
    statusUpdating: 'Обновление…',
    statusLoading: 'Загрузка…',
    paginationPrev: '← Назад',
    paginationNext: 'Вперед →',

    // ── Account menu ──
    menuAddSubaccount: '➕ Добавить субаккаунт',
    menuImportWallet: '🔑 Импортировать кошелёк',
    menuConnectedSites: '🌐 Подключённые сайты',

    // ── Send screen ──
    btnBack: '← Назад',
    titleSend: 'Отправить',
    labelAsset: 'Актив',
    labelRecipient: 'Адрес получателя',
    labelAmount: 'Сумма',
    btnSendTx: 'Отправить',

    // ── Confirm screen ──
    titleConfirm: 'Подтверждение',
    confirmRecipient: 'Получатель',
    confirmAmount: 'Сумма',
    confirmAsset: 'Актив',
    confirmGas: 'Газ (оценка)',
    confirmTotal: 'Итого',
    btnCancel: 'Отмена',
    btnConfirmSend: 'Подтвердить',

    // ── Add token screen ──
    titleAddToken: 'Добавить ERC-20 токен',
    labelContractAddress: 'Адрес контракта',
    btnFetchToken: 'Загрузить ↓',
    labelSymbol: 'Символ',
    labelDecimals: 'Decimals',
    btnAddTokenAction: 'Добавить токен',

    // ── Add account screen ──
    titleSubaccount: 'Новый субаккаунт',
    subtitleSubaccount:
      'Субаккаунты выводятся из той же мнемоники по пути BIP-44. Введите пароль основного аккаунта.',
    labelMainPassword: 'Пароль основного аккаунта',
    btnCreateSubaccount: 'Создать субаккаунт',

    // ── dApp approval ──
    dappSubtitleLoading: 'Загрузка…',
    dappBtnReject: 'Отклонить',
    dappBtnApprove: 'Одобрить',

    // ── Connected sites ──
    titleConnectedSites: 'Подключённые сайты',
    subtitleConnectedSites:
      'Сайты, которые имеют доступ к вашему адресу и могут запрашивать подпись.',

    // ── Settings screen ──
    titleSettings: 'Настройки',
    settingsLangTitle: 'Язык / Language',
    settingsApiTitle: 'API ключи',
    settingsSitesTitle: 'Подключённые сайты',
    settingsSitesDesc: 'Сайты с доступом к вашему адресу.',
  },

  en: {
    // ── Setup screen ──
    tabLogin: 'Login',
    tabCreate: 'Create',
    labelMnemonic: 'Mnemonic phrase (12 words)',
    labelPassword: 'Password',
    hintEncrypt: 'Encrypts key locally — never leaves your device',
    btnLogin: 'Login',
    labelNewPassword: 'New wallet password',
    btnCreate: 'Create wallet',
    labelNetwork: 'Network',
    labelUsePublicRpc: 'Use public RPC',
    labelRpcUrl: 'RPC URL (active network)',
    labelEtherscanKey: 'Etherscan API key',
    hintEtherscanOptional: '',
    btnSaveKey: 'Save',
    hintEtherscanLink: 'One key works for ETH, Sepolia, BSC and other networks.',

    // ── Mnemonic screen ──
    titleMnemonic: 'Save your recovery phrase',
    warnMnemonic: '⚠️ Write down these 12 words. Without them, the wallet cannot be recovered.',
    btnCopy: 'Copy',
    btnSaved: 'I saved it →',

    // ── Quiz screen ──
    titleQuiz: 'Phrase verification',
    subtitleQuiz: 'Enter the words by number to confirm you saved the phrase',
    btnVerify: 'Verify →',
    btnBackMnemonic: '← View phrase again',

    // ── Unlock screen ──
    labelUnlockPassword: 'Password',
    btnUnlock: 'Unlock',
    btnDeleteWallet: 'Delete wallet',

    // ── Wallet screen ──
    btnSend: '↑ Send',
    btnAddToken: '+ Token',
    tabTokens: 'Tokens',
    tabHistory: 'History',
    titleTransactions: 'Transactions',
    statusUpdating: 'Updating…',
    statusLoading: 'Loading…',
    paginationPrev: '← Back',
    paginationNext: 'Next →',

    // ── Account menu ──
    menuAddSubaccount: '➕ Add sub-account',
    menuImportWallet: '🔑 Import wallet',
    menuConnectedSites: '🌐 Connected sites',

    // ── Send screen ──
    btnBack: '← Back',
    titleSend: 'Send',
    labelAsset: 'Asset',
    labelRecipient: 'Recipient address',
    labelAmount: 'Amount',
    btnSendTx: 'Send',

    // ── Confirm screen ──
    titleConfirm: 'Confirmation',
    confirmRecipient: 'Recipient',
    confirmAmount: 'Amount',
    confirmAsset: 'Asset',
    confirmGas: 'Gas (estimate)',
    confirmTotal: 'Total',
    btnCancel: 'Cancel',
    btnConfirmSend: 'Confirm',

    // ── Add token screen ──
    titleAddToken: 'Add ERC-20 token',
    labelContractAddress: 'Contract address',
    btnFetchToken: 'Fetch ↓',
    labelSymbol: 'Symbol',
    labelDecimals: 'Decimals',
    btnAddTokenAction: 'Add token',

    // ── Add account screen ──
    titleSubaccount: 'New sub-account',
    subtitleSubaccount:
      'Sub-accounts are derived from the same mnemonic via BIP-44. Enter the main account password.',
    labelMainPassword: 'Main account password',
    btnCreateSubaccount: 'Create sub-account',

    // ── dApp approval ──
    dappSubtitleLoading: 'Loading…',
    dappBtnReject: 'Reject',
    dappBtnApprove: 'Approve',

    // ── Connected sites ──
    titleConnectedSites: 'Connected sites',
    subtitleConnectedSites: 'Sites with access to your address that can request signatures.',

    // ── Settings screen ──
    titleSettings: 'Settings',
    settingsLangTitle: 'Language / Язык',
    settingsApiTitle: 'API keys',
    settingsSitesTitle: 'Connected sites',
    settingsSitesDesc: 'Sites with access to your address.',
  },
};

let currentLang = 'ru';

const _getLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).getLocal(...a);
const _setLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).setLocal(...a);

function t(key) {
  return translations[currentLang]?.[key] || translations.ru[key] || key;
}

function getLang() {
  return currentLang;
}

function applyLang() {
  document.querySelectorAll('[data-lang]').forEach((el) => {
    const key = el.getAttribute('data-lang');
    const text = translations[currentLang]?.[key];
    if (text == null) return;
    // Не перезаписываем textContent если есть дочерние элементы (input, button и т.д.)
    if (el.children && el.children.length > 0) return;
    el.textContent = text;
  });
  document.documentElement.lang = currentLang === 'en' ? 'en' : 'ru';
}

async function setLang(lang) {
  if (lang !== 'ru' && lang !== 'en') return;
  currentLang = lang;
  await _setLocal({ language: lang });
  applyLang();
}

async function loadLang() {
  try {
    const { language } = await _getLocal(['language']);
    if (language === 'en' || language === 'ru') {
      currentLang = language;
    }
  } catch {
    /* default ru */
  }
}

export const WolfPopupI18n = {
  translations,
  t,
  getLang,
  setLang,
  loadLang,
  applyLang,
};
globalThis.WolfPopupI18n = WolfPopupI18n;
