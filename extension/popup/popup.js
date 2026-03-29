'use strict';

// ── Конфигурация ──────────────────────────────────────────────────────────────
const RPC_URL  = 'https://eth-sepolia.g.alchemy.com/v2/lrmoWsP5qrMt8_aezkh4p';
const CHAIN_ID = 11155111;
const AUTO_LOCK_MINUTES = 5;

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
];

let provider = null;
let activeAccountIndex = 0;

// Мнемоника хранится только в памяти во время квиза — после прохождения обнуляется
let _pendingMnemonic  = null;
let _quizPositions    = []; // три случайных индекса [0..11]

// ── Инициализация (с миграцией старого формата) ───────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Читаем сохранённый RPC URL (если пользователь вводил свой ключ)
  const { rpcUrl } = await getLocal(['rpcUrl']);
  provider = new ethers.JsonRpcProvider(rpcUrl || RPC_URL);

  // Миграция: старый формат {keystore, address} → новый {accounts: [...]}
  const legacy = await getLocal(['keystore', 'address', 'accounts', 'activeAccount']);
  if (legacy.keystore && legacy.address && !legacy.accounts) {
    await setLocal({
      accounts: [{ address: legacy.address, keystore: legacy.keystore, name: 'Account 1' }],
      activeAccount: 0,
    });
  }

  const { accounts } = await getLocal(['accounts']);
  if (!accounts || accounts.length === 0) {
    showScreen('screen-setup');
    return;
  }

  const { activeAccount } = await getLocal(['activeAccount']);
  activeAccountIndex = (activeAccount != null && activeAccount < accounts.length) ? activeAccount : 0;

  const current = accounts[activeAccountIndex];
  const { unlocked, unlockTime } = await getSession(['unlocked', 'unlockTime']);
  const expired = !unlockTime || (Date.now() - unlockTime > AUTO_LOCK_MINUTES * 60 * 1000);

  if (!unlocked || expired) {
    setAvatar('unlock-avatar', current.address);
    document.getElementById('unlock-address').textContent = shortAddr(current.address);
    showScreen('screen-unlock');
  } else {
    await setSession({ unlockTime: Date.now() });
    showScreen('screen-wallet');
    loadWalletScreen(current.address);
  }
});

// ── Навигация ─────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('acct-menu')?.classList.add('hidden');
}

// ── Переключение табов Setup ──────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tabs .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.tabs [data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// ── Переключение вкладок кошелька ─────────────────────────────────────────────
function switchWalletTab(tab) {
  document.querySelectorAll('.wallet-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.wallet-tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.wallet-tabs [data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`wallet-tab-${tab}`).classList.add('active');
}

// ── Создание кошелька ─────────────────────────────────────────────────────────
async function createWallet() {
  const password = document.getElementById('create-password').value;
  clearMessages('create');
  if (password.length < 8) { showError('create', 'Пароль минимум 8 символов'); return; }

  // Читаем выбор API ключа
  const rpcChoice = _readRpcChoice();
  if (!rpcChoice.ok) { showError('create', rpcChoice.error); return; }

  setLoading('btn-create', true);
  setStatus('create', 'Генерация ключей…');

  try {
    const wallet   = ethers.Wallet.createRandom();
    const mnemonic = wallet.mnemonic.phrase;

    setStatus('create', 'Шифрование keystore…');
    const keystore = await wallet.encrypt(password);

    const { accounts = [] } = await getLocal(['accounts']);
    accounts.push({ address: wallet.address, keystore, name: `Account ${accounts.length + 1}` });
    activeAccountIndex = accounts.length - 1;
    await setLocal({ accounts, activeAccount: activeAccountIndex });

    // Сохраняем RPC URL и обновляем провайдер
    await _saveRpcChoice(rpcChoice);

    // Разблокируем SW — wallet живёт там, а не в popup
    await sendToSW({ type: 'unlock', password, accountIndex: activeAccountIndex });

    _pendingMnemonic = mnemonic; // сохраняем для квиза
    document.getElementById('mnemonic-display').textContent = mnemonic;
    clearMessages('create');
    showScreen('screen-mnemonic');

  } catch (e) {
    showError('create', 'Ошибка: ' + e.message);
  } finally {
    setLoading('btn-create', false);
    setStatus('create', '');
  }
}

// ── Импорт кошелька ───────────────────────────────────────────────────────────
async function importWallet() {
  const mnemonic = document.getElementById('import-mnemonic').value.trim();
  const password = document.getElementById('import-password').value;
  clearMessages('import');
  if (!mnemonic) { showError('import', 'Введите мнемоническую фразу'); return; }
  if (password.length < 8) { showError('import', 'Пароль минимум 8 символов'); return; }

  // Читаем выбор API ключа
  const rpcChoice = _readRpcChoice();
  if (!rpcChoice.ok) { showError('import', rpcChoice.error); return; }

  setLoading('btn-import', true);
  setStatus('import', 'Проверка фразы…');

  try {
    let wallet;
    try {
      wallet = ethers.Wallet.fromPhrase(mnemonic);
    } catch {
      showError('import', 'Неверная мнемоническая фраза');
      return;
    }

    setStatus('import', 'Шифрование keystore…');
    const keystore = await wallet.encrypt(password);

    const { accounts = [] } = await getLocal(['accounts']);
    accounts.push({ address: wallet.address, keystore, name: `Account ${accounts.length + 1}` });
    activeAccountIndex = accounts.length - 1;
    await setLocal({ accounts, activeAccount: activeAccountIndex });

    // Сохраняем RPC URL и обновляем провайдер
    await _saveRpcChoice(rpcChoice);

    // Разблокируем SW — wallet живёт там, а не в popup
    await sendToSW({ type: 'unlock', password, accountIndex: activeAccountIndex });

    clearMessages('import');
    showScreen('screen-wallet');
    loadWalletScreen(wallet.address);

  } catch (e) {
    showError('import', 'Ошибка: ' + e.message);
  } finally {
    setLoading('btn-import', false);
    setStatus('import', '');
  }
}

// ── Разблокировка ─────────────────────────────────────────────────────────────
// Пароль уходит в SW, там расшифровывается keystore и wallet остаётся в SW памяти.
// Popup НЕ получает приватный ключ — только подтверждение успеха/ошибки.
async function unlockWallet() {
  const password = document.getElementById('unlock-password').value;
  clearMessages('unlock');
  if (!password) { showError('unlock', 'Введите пароль'); return; }

  setLoading('btn-unlock', true);
  setStatus('unlock', 'Проверка пароля…');

  const result = await sendToSW({ type: 'unlock', password, accountIndex: activeAccountIndex });

  if (!result?.ok) {
    showError('unlock', 'Неверный пароль');
    setLoading('btn-unlock', false);
    setStatus('unlock', '');
    return;
  }

  document.getElementById('unlock-password').value = '';
  clearMessages('unlock');
  setLoading('btn-unlock', false);
  setStatus('unlock', '');

  const { accounts } = await getLocal(['accounts']);
  showScreen('screen-wallet');
  loadWalletScreen(accounts[activeAccountIndex].address);
}

// ── Экран кошелька ────────────────────────────────────────────────────────────
async function loadWalletScreen(address) {
  setAvatar('wallet-avatar', address); // header-avatar не существует в HTML — убран

  const { accounts } = await getLocal(['accounts']);
  const acctName = accounts[activeAccountIndex]?.name || `Account ${activeAccountIndex + 1}`;
  document.getElementById('header-acct-name').textContent = acctName;
  document.getElementById('wallet-address').textContent = shortAddr(address);

  loadBalance(address);
  loadTokenBalances(address);
  loadTransactions(address);
  switchWalletTab('tokens');
}

async function loadBalance(address) {
  try {
    const wei = await provider.getBalance(address);
    document.getElementById('wallet-balance').textContent =
      parseFloat(ethers.formatEther(wei)).toFixed(6);
  } catch {
    document.getElementById('wallet-balance').textContent = '—';
  }
}

async function refreshBalance() {
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (!address) return;
  document.getElementById('wallet-balance').textContent = '…';
  await loadBalance(address);
  loadTokenBalances(address);
  loadTransactions(address);
}

// ── ERC-20 токены ─────────────────────────────────────────────────────────────
async function loadTokenBalances(address) {
  const { tokens = [] } = await getLocal(['tokens']);
  const el = document.getElementById('token-list');
  el.textContent = ''; // безопасная очистка — без innerHTML

  if (!tokens.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Нет добавленных токенов';
    el.appendChild(p);
    return;
  }

  tokens.forEach(t => {
    const id = t.address.slice(2, 10);

    const item = document.createElement('div');
    item.className = 'token-item';

    // Левая часть: иконка + название
    const left = document.createElement('div');
    left.className = 'token-left';

    const icon = document.createElement('div');
    icon.className = 'token-icon';
    icon.textContent = t.symbol.slice(0, 4); // textContent — XSS невозможен

    const info = document.createElement('div');

    const symEl = document.createElement('div');
    symEl.className = 'token-symbol';
    symEl.textContent = t.symbol; // textContent — XSS невозможен

    const addrEl = document.createElement('div');
    addrEl.className = 'token-addr';
    addrEl.textContent = t.address.slice(0, 10) + '…'; // textContent — XSS невозможен

    info.appendChild(symEl);
    info.appendChild(addrEl);
    left.appendChild(icon);
    left.appendChild(info);

    // Баланс
    const balanceEl = document.createElement('span');
    balanceEl.className = 'token-balance';
    balanceEl.id = `tb-${id}`;
    balanceEl.textContent = '…';

    // Кнопка удаления — addEventListener вместо onclick в строке
    const removeBtn = document.createElement('button');
    removeBtn.className = 'token-remove';
    removeBtn.title = 'Удалить';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeToken(t.address));

    item.appendChild(left);
    item.appendChild(balanceEl);
    item.appendChild(removeBtn);
    el.appendChild(item);
  });

  await Promise.all(tokens.map(async t => {
    const id = t.address.slice(2, 10);
    try {
      const contract  = new ethers.Contract(t.address, ERC20_ABI, provider);
      const raw       = await contract.balanceOf(address);
      const formatted = formatAmount(parseFloat(ethers.formatUnits(raw, t.decimals)));
      const balEl = document.getElementById(`tb-${id}`);
      if (balEl) balEl.textContent = `${formatted} ${t.symbol}`;
    } catch {
      const balEl = document.getElementById(`tb-${id}`);
      if (balEl) balEl.textContent = '—';
    }
  }));
}

function onTokenAddrChange() {
  const val = document.getElementById('token-address').value.trim();
  document.getElementById('btn-fetch-token').disabled = !ethers.isAddress(val);
}

async function fetchTokenInfo() {
  const addr = document.getElementById('token-address').value.trim();
  clearMessages('add-token');
  if (!ethers.isAddress(addr)) { showError('add-token', 'Неверный адрес контракта'); return; }
  setStatus('add-token', 'Загрузка информации…');
  try {
    const c = new ethers.Contract(addr, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([c.symbol(), c.decimals()]);
    document.getElementById('token-symbol').value   = symbol;
    document.getElementById('token-decimals').value = decimals.toString();
    setStatus('add-token', '');
  } catch {
    setStatus('add-token', '');
    showError('add-token', 'Не удалось загрузить информацию о токене');
  }
}

async function addToken() {
  const addr     = document.getElementById('token-address').value.trim();
  const symbol   = document.getElementById('token-symbol').value.trim().toUpperCase();
  const decimals = parseInt(document.getElementById('token-decimals').value) || 18;
  clearMessages('add-token');
  if (!ethers.isAddress(addr)) { showError('add-token', 'Неверный адрес контракта'); return; }
  if (!symbol)                 { showError('add-token', 'Введите символ токена');     return; }

  const { tokens = [] } = await getLocal(['tokens']);
  if (tokens.some(t => t.address.toLowerCase() === addr.toLowerCase())) {
    showError('add-token', 'Этот токен уже добавлен'); return;
  }
  tokens.push({ address: addr, symbol, decimals });
  await setLocal({ tokens });

  document.getElementById('token-address').value  = '';
  document.getElementById('token-symbol').value   = '';
  document.getElementById('token-decimals').value = '18';
  document.getElementById('btn-fetch-token').disabled = true;

  showScreen('screen-wallet');
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (address) { loadTokenBalances(address); switchWalletTab('tokens'); }
}

async function removeToken(addr) {
  const { tokens = [] } = await getLocal(['tokens']);
  await setLocal({ tokens: tokens.filter(t => t.address.toLowerCase() !== addr.toLowerCase()) });
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (address) loadTokenBalances(address);
}

// ── Переключатель аккаунтов ───────────────────────────────────────────────────
async function toggleAccountMenu() {
  const menu = document.getElementById('acct-menu');
  if (menu.classList.contains('hidden')) {
    await renderAccountMenu();
    menu.classList.remove('hidden');
  } else {
    menu.classList.add('hidden');
  }
}

async function renderAccountMenu() {
  const { accounts = [] } = await getLocal(['accounts']);
  const listEl = document.getElementById('acct-list');
  listEl.textContent = ''; // безопасная очистка

  accounts.forEach((acct, i) => {
    const item = document.createElement('div');
    item.className = 'acct-item' + (i === activeAccountIndex ? ' active' : '');
    item.addEventListener('click', () => switchAccount(i)); // addEventListener вместо onclick в строке

    const avatarEl = document.createElement('div');
    avatarEl.className = 'avatar avatar-sm';
    avatarEl.id = `acct-av-${i}`;

    const infoEl = document.createElement('div');
    infoEl.style.flex = '1';

    const nameEl = document.createElement('div');
    nameEl.className = 'acct-item-name';
    nameEl.textContent = acct.name; // textContent — XSS невозможен

    const addrEl = document.createElement('div');
    addrEl.className = 'acct-item-addr';
    addrEl.textContent = shortAddr(acct.address); // textContent — XSS невозможен

    infoEl.appendChild(nameEl);
    infoEl.appendChild(addrEl);
    item.appendChild(avatarEl);
    item.appendChild(infoEl);

    if (i === activeAccountIndex) {
      const check = document.createElement('span');
      check.className = 'acct-item-check';
      check.textContent = '✓';
      item.appendChild(check);
    }

    listEl.appendChild(item);
  });

  accounts.forEach((_, i) => setAvatar(`acct-av-${i}`, accounts[i].address));
}

async function switchAccount(idx) {
  const { accounts = [] } = await getLocal(['accounts']);
  if (idx >= accounts.length) return;
  activeAccountIndex = idx;
  await setLocal({ activeAccount: idx });
  showScreen('screen-wallet');
  loadWalletScreen(accounts[idx].address);
}

// ── Добавить субаккаунт ───────────────────────────────────────────────────────
// Деривация и шифрование нового аккаунта происходят в SW
async function addSubAccount() {
  const password = document.getElementById('add-account-password').value;
  clearMessages('add-account');
  if (!password) { showError('add-account', 'Введите пароль'); return; }

  setLoading('btn-add-account', true);
  setStatus('add-account', 'Создание субаккаунта…');

  const result = await sendToSW({ type: 'add-sub-account', password });

  if (!result?.ok) {
    const msg = result?.error?.includes('password') || result?.error?.includes('пароль')
      ? 'Неверный пароль'
      : (result?.error || 'Ошибка');
    showError('add-account', msg);
    setLoading('btn-add-account', false);
    setStatus('add-account', '');
    return;
  }

  const { accounts = [] } = await getLocal(['accounts']);
  accounts.push({ address: result.address, keystore: result.keystore, name: `Account ${result.index + 1}` });
  activeAccountIndex = result.index;
  await setLocal({ accounts, activeAccount: result.index });

  document.getElementById('add-account-password').value = '';
  setLoading('btn-add-account', false);
  setStatus('add-account', '');
  showScreen('screen-wallet');
  loadWalletScreen(result.address);
}

async function loadTransactions(address) {
  const el = document.getElementById('tx-list');
  el.textContent = '';
  const loadingEl = document.createElement('p');
  loadingEl.className = 'empty';
  loadingEl.textContent = 'Загрузка…';
  el.appendChild(loadingEl);

  try {
    const [sentRes, recvRes] = await Promise.all([
      fetchAlchemyTransfers(address, 'from'),
      fetchAlchemyTransfers(address, 'to'),
    ]);

    // Явно проверяем JSON-RPC ошибки
    if (sentRes.error) throw new Error(sentRes.error.message || 'Alchemy error (from)');
    if (recvRes.error) throw new Error(recvRes.error.message || 'Alchemy error (to)');

    const sent = sentRes.result?.transfers || [];
    const recv = recvRes.result?.transfers || [];

    // Объединяем, дедуплицируем по хэшу, сортируем (новые первые), берём 20
    const seen = new Set();
    const all = [...sent, ...recv]
      .filter(tx => {
        if (seen.has(tx.hash)) return false;
        seen.add(tx.hash);
        return true;
      })
      .sort((a, b) => (parseInt(b.blockNum, 16) || 0) - (parseInt(a.blockNum, 16) || 0))
      .slice(0, 20);

    el.textContent = '';

    if (!all.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Транзакций пока нет';
      el.appendChild(p);
      return;
    }

    all.forEach(tx => {
      const isOut  = tx.from?.toLowerCase() === address.toLowerCase();
      const peer   = isOut ? tx.to : tx.from;
      const amount = tx.value != null ? formatAmount(parseFloat(tx.value)) : '?';
      const asset  = tx.asset || 'ETH';

      const txEl = document.createElement('div');
      txEl.className = 'tx';

      const leftEl = document.createElement('div');
      leftEl.className = 'tx-left';

      // Направление + адрес — textContent, данные из блокчейна не попадут в HTML
      const dirEl = document.createElement('span');
      dirEl.className = 'tx-dir';
      dirEl.textContent = `${isOut ? '→' : '←'} ${shortAddr(peer)}`;

      // Ссылка на Etherscan — href и textContent отдельно, не через шаблон
      const linkEl = document.createElement('a');
      linkEl.className = 'tx-link';
      linkEl.href = `https://sepolia.etherscan.io/tx/${encodeURIComponent(tx.hash)}`;
      linkEl.target = '_blank';
      linkEl.rel = 'noopener noreferrer';
      linkEl.textContent = tx.hash.slice(0, 16) + '…'; // textContent — XSS невозможен

      leftEl.appendChild(dirEl);
      leftEl.appendChild(linkEl);

      const amountEl = document.createElement('span');
      amountEl.className = `tx-amount ${isOut ? 'out' : 'inc'}`;
      amountEl.textContent = `${isOut ? '−' : '+'}${amount} ${asset}`; // textContent — XSS невозможен

      txEl.appendChild(leftEl);
      txEl.appendChild(amountEl);
      el.appendChild(txEl);
    });

  } catch (e) {
    console.error('[loadTransactions]', e);
    el.textContent = '';
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Не удалось загрузить транзакции'; // ошибка НЕ выводится в DOM
    el.appendChild(p);
  }
}

async function fetchAlchemyTransfers(address, direction) {
  const body = {
    id: 1, jsonrpc: '2.0',
    method: 'alchemy_getAssetTransfers',
    params: [{
      fromBlock:        '0x0',
      toBlock:          'latest',
      category:         ['external', 'erc20'],
      withMetadata:     false,
      excludeZeroValue: true,
      maxCount:         '0x14', // 20
      [direction === 'from' ? 'fromAddress' : 'toAddress']: address,
    }],
  };
  const res = await fetch(RPC_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Отправка транзакции ───────────────────────────────────────────────────────
async function showSendScreen() {
  const { tokens = [] } = await getLocal(['tokens']);
  const select = document.getElementById('send-asset');
  select.textContent = ''; // безопасная очистка

  // ETH — статичная опция
  const ethOpt = document.createElement('option');
  ethOpt.value = 'ETH';
  ethOpt.textContent = 'ETH (Ether)';
  select.appendChild(ethOpt);

  // ERC-20 токены — value и textContent отдельно, не через шаблон
  tokens.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.address;           // setAttribute безопасен для value
    opt.textContent = `${t.symbol} (ERC-20)`; // textContent — XSS невозможен
    select.appendChild(opt);
  });

  showScreen('screen-send');
}

// Подпись и отправка транзакции — приватный ключ остаётся в SW, сюда не приходит
async function sendTransaction() {
  const to     = document.getElementById('send-to').value.trim();
  const amount = document.getElementById('send-amount').value.trim();
  const asset  = document.getElementById('send-asset').value;

  clearMessages('send');
  if (!ethers.isAddress(to))              { showError('send', 'Неверный адрес получателя'); return; }
  if (!amount || parseFloat(amount) <= 0) { showError('send', 'Введите корректную сумму');  return; }

  setLoading('btn-send', true);
  setStatus('send', 'Подпись и отправка…');

  try {
    let result;

    if (asset === 'ETH') {
      result = await sendToSW({ type: 'send-eth', to, amount });
    } else {
      const { tokens = [] } = await getLocal(['tokens']);
      const token = tokens.find(t => t.address.toLowerCase() === asset.toLowerCase());
      if (!token) { showError('send', 'Токен не найден'); return; }
      result = await sendToSW({
        type: 'send-erc20', to, amount,
        tokenAddress: token.address,
        decimals:     token.decimals,
      });
    }

    if (!result?.ok) {
      // SW потерял ключ (Chrome убил фоновый процесс) — нужно разблокировать снова
      if (result?.error === 'locked') { await handleSWLocked(); return; }
      let errMsg = 'Ошибка отправки';
      if (result?.error?.includes('insufficient funds')) errMsg = 'Недостаточно средств';
      else if (result?.error?.includes('nonce'))         errMsg = 'Ошибка nonce — попробуйте ещё раз';
      showError('send', errMsg);
      return;
    }

    clearMessages('send');
    showSuccess('send', `Отправлено! ${result.hash.slice(0, 20)}…`);

    setTimeout(async () => {
      showScreen('screen-wallet');
      const { accounts } = await getLocal(['accounts']);
      loadWalletScreen(accounts[activeAccountIndex].address);
    }, 2000);

  } catch {
    showError('send', 'Ошибка отправки');
  } finally {
    setLoading('btn-send', false);
    setStatus('send', '');
  }
}

// ── Копирование адреса ────────────────────────────────────────────────────────
async function copyAddress() {
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  if (!address) return;

  try {
    await navigator.clipboard.writeText(address);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = address;
    Object.assign(ta.style, { position: 'fixed', opacity: '0' });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  // Сохраняем дочерние узлы (SVG) без использования innerHTML
  const btn = document.querySelector('.copy-btn');
  const originalNodes = Array.from(btn.childNodes).map(n => n.cloneNode(true));
  btn.textContent = '';
  const tick = document.createElement('span');
  tick.style.cssText = 'font-size:12px;color:#4ade80';
  tick.textContent = '✓';
  btn.appendChild(tick);
  setTimeout(() => {
    btn.textContent = '';
    originalNodes.forEach(n => btn.appendChild(n)); // восстанавливаем без innerHTML
  }, 1500);
}

// ── Мнемоника ─────────────────────────────────────────────────────────────────
function copyMnemonic() {
  navigator.clipboard.writeText(document.getElementById('mnemonic-display').textContent).catch(() => {});
}

// Пользователь нажал "Я сохранил" → показываем квиз
function confirmMnemonic() {
  if (!_pendingMnemonic) {
    // Не должно происходить, но на всякий случай
    showScreen('screen-setup');
    return;
  }
  _quizPositions = _pickQuizPositions();
  _renderQuiz();
  showScreen('screen-quiz');
}

// Выбираем 3 случайных уникальных позиции из 12, сортируем по возрастанию
function _pickQuizPositions() {
  const positions = new Set();
  while (positions.size < 3) {
    positions.add(Math.floor(Math.random() * 12));
  }
  return Array.from(positions).sort((a, b) => a - b);
}

// Рисуем три поля ввода — createElement, без innerHTML
function _renderQuiz() {
  const container = document.getElementById('quiz-inputs');
  container.textContent = '';
  clearMessages('quiz');

  _quizPositions.forEach((pos, i) => {
    const field = document.createElement('div');
    field.className = 'field';

    const lbl = document.createElement('label');
    lbl.textContent = `Слово #${pos + 1}`;

    const inp = document.createElement('input');
    inp.type          = 'text';
    inp.id            = `quiz-inp-${i}`;
    inp.placeholder   = `Введите слово #${pos + 1}`;
    inp.autocomplete  = 'off';
    inp.spellcheck    = false;
    // Enter на последнем поле → проверяем
    if (i === 2) inp.addEventListener('keydown', e => { if (e.key === 'Enter') verifyQuiz(); });

    field.appendChild(lbl);
    field.appendChild(inp);
    container.appendChild(field);
  });

  // Фокус на первое поле
  document.getElementById('quiz-inp-0')?.focus();
}

// Проверяем ответы
async function verifyQuiz() {
  if (!_pendingMnemonic) { showScreen('screen-setup'); return; }
  clearMessages('quiz');

  const words = _pendingMnemonic.split(' ');
  let allCorrect = true;

  _quizPositions.forEach((pos, i) => {
    const inp = document.getElementById(`quiz-inp-${i}`);
    if (!inp) { allCorrect = false; return; } // null-guard на случай если DOM не готов
    const entered = inp.value.trim().toLowerCase();
    const correct = words[pos].toLowerCase();

    if (entered === correct) {
      inp.style.borderColor = '#4ade80'; // зелёный
    } else {
      inp.style.borderColor = '#ef4444'; // красный
      allCorrect = false;
    }
  });

  if (!allCorrect) {
    showError('quiz', 'Одно или несколько слов неверны — проверьте фразу и попробуйте снова');
    return;
  }

  // Квиз пройден — обнуляем мнемонику из памяти
  _pendingMnemonic = null;
  _quizPositions   = [];

  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  showScreen('screen-wallet');
  if (address) loadWalletScreen(address);
}

// Кнопка "Посмотреть снова" — возврат к экрану с фразой
function backToMnemonic() {
  // Сбрасываем цвета полей и ошибку
  _quizPositions.forEach((_, i) => {
    const inp = document.getElementById(`quiz-inp-${i}`);
    if (inp) inp.style.borderColor = '';
  });
  clearMessages('quiz');
  showScreen('screen-mnemonic');
}

// ── Блокировка / сброс ────────────────────────────────────────────────────────
async function lockWallet() {
  // SW обнуляет _wallet и очищает session storage
  await sendToSW({ type: 'lock' });
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  setAvatar('unlock-avatar', address);
  document.getElementById('unlock-address').textContent = shortAddr(address);
  showScreen('screen-unlock');
}

async function resetWallet() {
  const ok = confirm(
    'Удалить кошелёк с этого устройства?\n\n' +
    'Восстановить можно только по мнемонической фразе.'
  );
  if (!ok) return;
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  activeAccountIndex = 0;
  showScreen('screen-setup');
}

// ── Аватарка ──────────────────────────────────────────────────────────────────
function setAvatar(elementId, address) {
  const el = document.getElementById(elementId);
  if (!el || !address) return;
  const hue  = Math.round(parseInt(address.slice(2, 4), 16) * 360 / 255);
  const hue2 = (hue + 40) % 360;
  el.style.background = `linear-gradient(135deg, hsl(${hue},55%,45%), hsl(${hue2},55%,32%))`;
  el.textContent = address.slice(2, 4).toUpperCase();
}
// ── Форматирование чисел ────────────────────────────────────────────────────
// Показывает ровно столько знаков, сколько нужно, без хвостовых нулей:
//   200        → "200"
//   1.5        → "1.5"
//   0.001234   → "0.001234"
//   0.00000001 → "< 0.000001"
function formatAmount(value) {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  let s;
  if      (abs >= 1000)    s = value.toFixed(2);
  else if (abs >= 1)       s = value.toFixed(4);
  else if (abs >= 0.000001) s = value.toFixed(6);
  else                     return '< 0.000001';
  // Убираем хвостовые нули и лишнюю точку
  return s.replace(/\.?0+$/, '');
}
// ── Вспомогательные функции ───────────────────────────────────────────────────
function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '';
}

function getLocal(keys)    { return new Promise(r => chrome.storage.local.get(keys, r)); }
function setLocal(data)    { return new Promise(r => chrome.storage.local.set(data, r)); }
function removeLocal(keys) { return new Promise(r => chrome.storage.local.remove(keys, r)); }
function getSession(keys)  { return new Promise(r => chrome.storage.session.get(keys, r)); }
function setSession(data)  { return new Promise(r => chrome.storage.session.set(data, r)); }

// ── Выбор API ключа ───────────────────────────────────────────────────────────
// Читает состояние чекбокса и поля ввода на экране setup.
// Возвращает { ok, url, useDefault } или { ok: false, error }
function _readRpcChoice() {
  const useDefault = document.getElementById('use-default-key')?.checked !== false;
  const customUrl  = document.getElementById('custom-rpc-url')?.value.trim() || '';

  if (!useDefault) {
    if (!customUrl) {
      return { ok: false, error: 'Введите Alchemy RPC URL или используйте встроенный ключ' };
    }
    if (!customUrl.startsWith('https://')) {
      return { ok: false, error: 'URL должен начинаться с https://' };
    }
  }

  return { ok: true, useDefault, url: useDefault ? null : customUrl };
}

// Сохраняет выбор в хранилище и обновляет провайдер
async function _saveRpcChoice(choice) {
  if (choice.useDefault) {
    await removeLocal('rpcUrl'); // удаляем кастомный — будет использоваться дефолтный
  } else {
    await setLocal({ rpcUrl: choice.url });
  }
  // Обновляем провайдер сразу
  provider = new ethers.JsonRpcProvider(choice.useDefault ? RPC_URL : choice.url);
}

// Показывает/скрывает поле кастомного URL при переключении чекбокса
function toggleCustomKey() {
  const useDefault  = document.getElementById('use-default-key').checked;
  const customField = document.getElementById('custom-key-field');
  if (customField) customField.style.display = useDefault ? 'none' : 'block';
}

// Отправляем сообщение в service worker и ждём ответа
function sendToSW(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

// SW был убит Chrome (потерял _wallet) — сессия устарела, нужно разблокировать снова
async function handleSWLocked() {
  await chrome.storage.session.clear();
  const { accounts } = await getLocal(['accounts']);
  const address = accounts[activeAccountIndex]?.address;
  setAvatar('unlock-avatar', address);
  document.getElementById('unlock-address').textContent = shortAddr(address);
  showScreen('screen-unlock');
}

function showError(prefix, msg) {
  const el = document.getElementById(`${prefix}-error`);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function setStatus(prefix, msg) {
  const el = document.getElementById(`${prefix}-status`);
  if (el) { el.textContent = msg; el.style.display = msg ? 'block' : 'none'; }
}
function showSuccess(prefix, msg) {
  const el = document.getElementById(`${prefix}-success`);
  if (el) { el.textContent = '✓ ' + msg; el.style.display = 'block'; }
}
function clearMessages(prefix) {
  ['error', 'status', 'success'].forEach(type => {
    const el = document.getElementById(`${prefix}-${type}`);
    if (el) el.style.display = 'none';
  });
}
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (btn) btn.disabled = loading;
}
