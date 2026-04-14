// ── SOVA Wallet: event-bus.js unit tests ─────────────────────────────────
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let EventBus;

beforeAll(() => {
  let src = fs.readFileSync(
    path.resolve(__dirname, '../../extension/popup/modules/event-bus.js'),
    'utf8',
  );
  src = src.replace(/^import\s+.*$/gm, '');
  src = src.replace(/^export\s+/gm, '');
  // eslint-disable-next-line no-new-func -- intentional: load non-module source into Node ctx
  new Function(src)();
  EventBus = globalThis.WolfPopupEventBus;
});

beforeEach(() => {
  EventBus.clear();
});

describe('WolfPopupEventBus', () => {
  it('exports expected API', () => {
    expect(typeof EventBus.on).toBe('function');
    expect(typeof EventBus.once).toBe('function');
    expect(typeof EventBus.off).toBe('function');
    expect(typeof EventBus.emit).toBe('function');
    expect(typeof EventBus.clear).toBe('function');
    expect(typeof EventBus.listenerCount).toBe('function');
    expect(EventBus.Events).toBeDefined();
  });

  describe('on / emit', () => {
    it('calls subscriber with payload', () => {
      const handler = vi.fn();
      EventBus.on('test', handler);
      EventBus.emit('test', { value: 42 });
      expect(handler).toHaveBeenCalledWith({ value: 42 });
    });

    it('supports multiple subscribers', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      EventBus.on('test', h1);
      EventBus.on('test', h2);
      EventBus.emit('test', 'data');
      expect(h1).toHaveBeenCalledWith('data');
      expect(h2).toHaveBeenCalledWith('data');
    });

    it('does not call handlers for other events', () => {
      const handler = vi.fn();
      EventBus.on('event-a', handler);
      EventBus.emit('event-b', 'data');
      expect(handler).not.toHaveBeenCalled();
    });

    it('handles emit with no subscribers gracefully', () => {
      expect(() => EventBus.emit('no-one-listening')).not.toThrow();
    });
  });

  describe('off', () => {
    it('removes a specific subscriber', () => {
      const handler = vi.fn();
      EventBus.on('test', handler);
      EventBus.off('test', handler);
      EventBus.emit('test');
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns unsubscribe function from on()', () => {
      const handler = vi.fn();
      const unsub = EventBus.on('test', handler);
      unsub();
      EventBus.emit('test');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('once', () => {
    it('fires handler only once', () => {
      const handler = vi.fn();
      EventBus.once('test', handler);
      EventBus.emit('test', 'first');
      EventBus.emit('test', 'second');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith('first');
    });

    it('returns unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = EventBus.once('test', handler);
      unsub();
      EventBus.emit('test');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('removes all listeners', () => {
      EventBus.on('a', vi.fn());
      EventBus.on('b', vi.fn());
      EventBus.clear();
      expect(EventBus.listenerCount('a')).toBe(0);
      expect(EventBus.listenerCount('b')).toBe(0);
    });
  });

  describe('listenerCount', () => {
    it('returns 0 for unknown events', () => {
      expect(EventBus.listenerCount('unknown')).toBe(0);
    });

    it('returns correct count', () => {
      EventBus.on('test', vi.fn());
      EventBus.on('test', vi.fn());
      expect(EventBus.listenerCount('test')).toBe(2);
    });
  });

  describe('error isolation', () => {
    it('continues calling other handlers when one throws', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const throwing = () => {
        throw new Error('boom');
      };
      const handler = vi.fn();
      EventBus.on('test', throwing);
      EventBus.on('test', handler);
      EventBus.emit('test', 'data');
      expect(handler).toHaveBeenCalledWith('data');
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('Events constants', () => {
    it('has well-known event names', () => {
      const e = EventBus.Events;
      expect(e.ACCOUNT_SWITCHED).toBe('account:switched');
      expect(e.NETWORK_CHANGED).toBe('network:changed');
      expect(e.WALLET_LOCKED).toBe('wallet:locked');
      expect(e.WALLET_UNLOCKED).toBe('wallet:unlocked');
      expect(e.TX_SENT).toBe('tx:sent');
      expect(e.SCREEN_CHANGED).toBe('screen:changed');
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(EventBus.Events)).toBe(true);
    });
  });
});
