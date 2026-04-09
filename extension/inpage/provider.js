'use strict';

// ── SOVA Wallet inpage provider ─────────────────────────────────────────────
// Инжектится в MAIN world веб-страницы через content-script.
// Реализует EIP-1193 (window.ethereum) + EIP-6963 (provider discovery).
// Никогда не видит приватного ключа — только прокидывает JSON-RPC payload'ы
// через content-script → service worker (который держит ключ).

(function initSovaInpage() {
  if (typeof window === 'undefined') return;

  const CONTENT_TARGET = 'sova-content';
  const INPAGE_TARGET = 'sova-inpage';
  const PROVIDER_INFO = {
    uuid: 'e1f2a8c5-4a83-4b2d-9d7b-sova-wallet-0001',
    name: 'SOVA Wallet',
    icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48Y2lyY2xlIGN4PSI2NCIgY3k9IjY0IiByPSI2MCIgZmlsbD0iIzNiODJmNiIvPjx0ZXh0IHg9IjY0IiB5PSI4MCIgZm9udC1zaXplPSI1NiIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXdlaWdodD0iYm9sZCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iI2ZmZiI+UzwvdGV4dD48L3N2Zz4=',
    rdns: 'com.sovawallet',
  };

  // ── Pending requests ───────────────────────────────────────────────────────
  // LOW-8: каждый запрос получает таймер. Если ответ от SW не приходит за
  // PENDING_REQUEST_TIMEOUT_MS (SW убит/сетевой сбой/CSP заблокировал postMessage),
  // запись удаляется из _pending и Promise отклоняется с кодом 4900.
  // Раньше _pending рос неограниченно, создавая утечку памяти на долгих сессиях.
  const PENDING_REQUEST_TIMEOUT_MS = 120_000; // 2 минуты — достаточно для аппрувала пользователем
  let _nextId = 1;
  const _pending = new Map(); // id -> { resolve, reject, timer }

  function genId() {
    return `sova-${Date.now()}-${_nextId++}`;
  }

  function settlePending(id, error, result) {
    const entry = _pending.get(id);
    if (!entry) return;
    _pending.delete(id);
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    if (error) entry.reject(error);
    else entry.resolve(result);
  }

  // ── Event emitter (минимальный) ────────────────────────────────────────────
  // LOW-9: кап на количество слушателей одного события. Защита от dApp'ов
  // которые регистрируют `provider.on('accountsChanged', ...)` на каждом
  // re-render'е React'а без off() — память раздувается бесконечно.
  const MAX_LISTENERS_PER_EVENT = 20;
  class SovaEventEmitter {
    constructor() {
      this._listeners = new Map();
      this._warnedEvents = new Set();
    }
    on(event, handler) {
      if (typeof handler !== 'function') return this;
      if (!this._listeners.has(event)) this._listeners.set(event, new Set());
      const set = this._listeners.get(event);
      if (set.size >= MAX_LISTENERS_PER_EVENT) {
        if (!this._warnedEvents.has(event)) {
          this._warnedEvents.add(event);
          try {
            console.warn(
              `[SOVA] Too many listeners (${MAX_LISTENERS_PER_EVENT}) for event "${event}". ` +
              `Possible memory leak — make sure to call provider.off(...) on cleanup.`
            );
          } catch (e) { /* console may be unavailable */ }
        }
        return this;
      }
      set.add(handler);
      return this;
    }
    off(event, handler) {
      const set = this._listeners.get(event);
      if (set) {
        set.delete(handler);
        // Если слушателей снова стало мало — переоткрываем возможность warn'ить
        if (set.size < MAX_LISTENERS_PER_EVENT) {
          this._warnedEvents.delete(event);
        }
      }
      return this;
    }
    removeListener(event, handler) { return this.off(event, handler); }
    removeAllListeners(event) {
      if (event) {
        this._listeners.delete(event);
        this._warnedEvents.delete(event);
      } else {
        this._listeners.clear();
        this._warnedEvents.clear();
      }
      return this;
    }
    emit(event, payload) {
      const set = this._listeners.get(event);
      if (!set) return false;
      set.forEach((fn) => {
        try { fn(payload); }
        catch (e) { /* swallow listener errors */ }
      });
      return set.size > 0;
    }
  }

  // ── Provider ───────────────────────────────────────────────────────────────
  class SovaProvider extends SovaEventEmitter {
    constructor() {
      super();
      this.isSova = true;
      // Мы НЕ притворяемся MetaMask'ом — это антипаттерн.
      this.isMetaMask = false;
      this._chainId = null;
      this._accounts = [];
      this._isConnected = false;
    }

    // EIP-1193 main method
    request(args) {
      if (!args || typeof args !== 'object') {
        return Promise.reject(providerError(4100, 'Invalid request: args must be an object'));
      }
      const { method, params } = args;
      if (typeof method !== 'string' || !method) {
        return Promise.reject(providerError(4100, 'Invalid request: method required'));
      }

      return new Promise((resolve, reject) => {
        const id = genId();
        // LOW-8: auto-cleanup если ответ не придёт за таймаут.
        const timer = setTimeout(() => {
          if (_pending.has(id)) {
            settlePending(id, providerError(4900, `Request timed out after ${PENDING_REQUEST_TIMEOUT_MS}ms`));
          }
        }, PENDING_REQUEST_TIMEOUT_MS);
        _pending.set(id, {
          resolve: (result) => {
            this._postProcess(method, result);
            resolve(result);
          },
          reject,
          timer,
        });

        try {
          window.postMessage({
            target: CONTENT_TARGET,
            id,
            payload: { method, params: params || [] },
          }, window.location.origin);
        } catch (err) {
          settlePending(id, providerError(4100, `Failed to post message: ${err.message}`));
        }
      });
    }

    // Локально обновляем внутренний state на основе успешных ответов,
    // чтобы EIP-1193 getter'ы (на провайдере) отражали реальное состояние.
    _postProcess(method, result) {
      if (method === 'eth_chainId' && typeof result === 'string') {
        if (this._chainId !== result) {
          this._chainId = result;
        }
      } else if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
        if (Array.isArray(result)) {
          const same =
            this._accounts.length === result.length &&
            this._accounts.every((a, i) => a.toLowerCase() === (result[i] || '').toLowerCase());
          if (!same) {
            this._accounts = result.slice();
            if (!this._isConnected && result.length > 0) {
              this._isConnected = true;
              this.emit('connect', { chainId: this._chainId || '0x0' });
            }
          }
        }
      }
    }

    // Legacy compat (some dApps still use this)
    enable() {
      return this.request({ method: 'eth_requestAccounts' });
    }

    // Legacy sendAsync / send — deprecated but some old dApps call it
    sendAsync(payload, callback) {
      if (typeof callback !== 'function') return;
      this.request(payload)
        .then((result) => callback(null, { id: payload.id, jsonrpc: '2.0', result }))
        .catch((error) => callback(error, null));
    }
    send(methodOrPayload, paramsOrCallback) {
      if (typeof methodOrPayload === 'string') {
        return this.request({ method: methodOrPayload, params: paramsOrCallback || [] });
      }
      if (typeof paramsOrCallback === 'function') {
        return this.sendAsync(methodOrPayload, paramsOrCallback);
      }
      return this.request(methodOrPayload);
    }

    get chainId() { return this._chainId; }
    get selectedAddress() { return this._accounts[0] || null; }
    get networkVersion() {
      if (!this._chainId) return null;
      try { return String(parseInt(this._chainId, 16)); }
      catch { return null; }
    }
    isConnected() { return this._isConnected; }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function providerError(code, message, data) {
    const err = new Error(message);
    err.code = code;
    if (data !== undefined) err.data = data;
    return err;
  }

  // ── Incoming messages (from content-script) ───────────────────────────────
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.target !== INPAGE_TARGET) return;

    // Response to a request
    if (data.id && _pending.has(data.id)) {
      if (data.error) {
        settlePending(data.id, providerError(data.error.code || 4100, data.error.message || 'Unknown error', data.error.data));
      } else {
        settlePending(data.id, null, data.result);
      }
      return;
    }

    // Broadcast event from SW (accountsChanged / chainChanged / disconnect)
    if (data.event) {
      handleBroadcastEvent(data.event, data.data);
    }
  });

  function handleBroadcastEvent(event, payload) {
    if (!provider) return;
    if (event === 'accountsChanged' && Array.isArray(payload)) {
      provider._accounts = payload.slice();
      if (payload.length === 0 && provider._isConnected) {
        provider._isConnected = false;
        provider.emit('disconnect', providerError(4900, 'Provider disconnected'));
      }
      provider.emit('accountsChanged', payload);
    } else if (event === 'chainChanged' && typeof payload === 'string') {
      provider._chainId = payload;
      provider.emit('chainChanged', payload);
    } else if (event === 'connect' && payload && typeof payload === 'object') {
      provider._isConnected = true;
      provider.emit('connect', payload);
    } else if (event === 'disconnect') {
      provider._isConnected = false;
      provider._accounts = [];
      provider.emit('disconnect', providerError(4900, 'Provider disconnected'));
    }
  }

  // ── Instantiate & expose ───────────────────────────────────────────────────
  const provider = new SovaProvider();

  // EIP-1193: window.ethereum (только если никто ещё не занял его).
  // configurable: false — после того как мы записали, ни один скрипт не может
  // удалить или переопределить provider. Защита от provider replacement атак.
  try {
    if (!window.ethereum) {
      Object.defineProperty(window, 'ethereum', {
        value: provider,
        configurable: false,
        writable: false,
      });
    }
  } catch (e) {
    // Некоторые кошельки делают non-configurable — пропускаем.
  }

  // Также кладём в window.sova для явного доступа.
  // configurable: false — provider neulazimable после установки.
  try {
    Object.defineProperty(window, 'sova', {
      value: provider,
      configurable: false,
      writable: false,
    });
  } catch (e) { /* ignore */ }

  // ── EIP-6963: announce provider ────────────────────────────────────────────
  // Позволяет сосуществовать с MetaMask и другими wallet'ами на одной странице.
  function announceProvider() {
    const detail = Object.freeze({
      info: Object.freeze(PROVIDER_INFO),
      provider,
    });
    try {
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }));
    } catch (e) { /* ignore */ }
  }

  window.addEventListener('eip6963:requestProvider', announceProvider);
  announceProvider();

  // Сразу же запрашиваем chainId для отображения в provider.chainId (read-only)
  // Не кидаем ошибку при неудаче — сайт не подключён, это нормально.
  setTimeout(() => {
    provider.request({ method: 'eth_chainId' }).catch(() => {});
  }, 0);
})();
