(function () {
  'use strict';

  // ── Mnemonic quiz flow ────────────────────────────────────────────────
  // После генерации кошелька пользователь подтверждает что сохранил фразу
  // через квиз из 5 случайных слов из 12.

  const PopupState = globalThis.WolfPopupSharedState || {};
  const _showScreen = (...a) => (globalThis.WolfPopupUiState || globalThis).showScreen(...a);
  const _showError = (...a) => (globalThis.WolfPopupUiMessages || globalThis).showError(...a);
  const _clearMessages = (...a) => (globalThis.WolfPopupUiMessages || globalThis).clearMessages(...a);
  const _copyText = (...a) => (globalThis.WolfPopupClipboard || globalThis).copyText(...a);
  const _getLocal = (...a) => (globalThis.WolfPopupStorage || globalThis).getLocal(...a);

  let _pendingMnemonic = null;
  let _quizPositions = [];
  const QUIZ_WORD_COUNT = 5;

  function setPendingMnemonic(m) { _pendingMnemonic = m; }
  function getPendingMnemonic() { return _pendingMnemonic; }

  function copyMnemonic() {
    _copyText(document.getElementById('mnemonic-display').textContent).catch(() => {});
  }

  function confirmMnemonic() {
    if (!_pendingMnemonic) {
      _showScreen('screen-setup');
      return;
    }
    _quizPositions = _pickQuizPositions();
    _renderQuiz();
    _showScreen('screen-quiz');
  }

  function _pickQuizPositions() {
    const positions = new Set();
    while (positions.size < QUIZ_WORD_COUNT) {
      positions.add(Math.floor(Math.random() * 12));
    }
    return Array.from(positions).sort((a, b) => a - b);
  }

  function _renderQuiz() {
    const container = document.getElementById('quiz-inputs');
    container.textContent = '';
    _clearMessages('quiz');

    _quizPositions.forEach((pos, i) => {
      const field = document.createElement('div');
      field.className = 'field';

      const lbl = document.createElement('label');
      lbl.textContent = `Слово #${pos + 1}`;

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.id = `quiz-inp-${i}`;
      inp.placeholder = `Введите слово #${pos + 1}`;
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      if (i === QUIZ_WORD_COUNT - 1) {
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') verifyQuiz(); });
      }

      field.appendChild(lbl);
      field.appendChild(inp);
      container.appendChild(field);
    });

    document.getElementById('quiz-inp-0')?.focus();
  }

  async function verifyQuiz() {
    if (!_pendingMnemonic) { _showScreen('screen-setup'); return; }
    _clearMessages('quiz');

    const words = _pendingMnemonic.split(' ');
    let allCorrect = true;

    _quizPositions.forEach((pos, i) => {
      const inp = document.getElementById(`quiz-inp-${i}`);
      if (!inp) { allCorrect = false; return; }
      const entered = inp.value.trim().toLowerCase();
      const correct = words[pos].toLowerCase();

      if (entered === correct) {
        inp.style.borderColor = '#4ade80';
      } else {
        inp.style.borderColor = '#ef4444';
        allCorrect = false;
      }
    });

    if (!allCorrect) {
      _showError('quiz', 'Одно или несколько слов неверны — проверьте фразу и попробуйте снова');
      return;
    }

    _pendingMnemonic = null;
    _quizPositions = [];

    const { accounts } = await _getLocal(['accounts']);
    const address = accounts[PopupState.activeAccountIndex]?.address;
    _showScreen('screen-wallet');
    if (address && typeof globalThis.loadWalletScreen === 'function') {
      globalThis.loadWalletScreen(address);
    }
  }

  function backToMnemonic() {
    _quizPositions.forEach((_, i) => {
      const inp = document.getElementById(`quiz-inp-${i}`);
      if (inp) inp.style.borderColor = '';
    });
    _clearMessages('quiz');
    _showScreen('screen-mnemonic');
  }

  // Expose
  globalThis.copyMnemonic = copyMnemonic;
  globalThis.confirmMnemonic = confirmMnemonic;
  globalThis.verifyQuiz = verifyQuiz;
  globalThis.backToMnemonic = backToMnemonic;

  globalThis.WolfPopupQuizFlow = {
    setPendingMnemonic,
    getPendingMnemonic,
    copyMnemonic,
    confirmMnemonic,
    verifyQuiz,
    backToMnemonic,
  };
})();
