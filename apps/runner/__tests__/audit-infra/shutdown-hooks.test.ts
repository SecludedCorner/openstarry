/**
 * W0 shared infra — shutdown-hooks unit tests.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createShutdownHookRegistry,
  SHUTDOWN_ORDER,
} from '../../src/audit-infra/shutdown-hooks.js';

describe('shutdown-hooks', () => {
  it('invokes hooks in ascending order', async () => {
    const registry = createShutdownHookRegistry();
    const order: string[] = [];
    registry.register({ id: 'c', order: 300, fn: () => { order.push('c'); } });
    registry.register({ id: 'a', order: 100, fn: () => { order.push('a'); } });
    registry.register({ id: 'b', order: 200, fn: () => { order.push('b'); } });
    await registry.trigger('programmatic');
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('awaits async hooks serially', async () => {
    const registry = createShutdownHookRegistry();
    const order: string[] = [];
    registry.register({
      id: 'slow',
      order: 100,
      fn: async () => {
        await new Promise((r) => setTimeout(r, 10));
        order.push('slow');
      },
    });
    registry.register({
      id: 'fast',
      order: 200,
      fn: () => { order.push('fast'); },
    });
    await registry.trigger('programmatic');
    expect(order).toEqual(['slow', 'fast']);
  });

  it('isolates hook failures; later hooks still run', async () => {
    const registry = createShutdownHookRegistry();
    const later = vi.fn();
    registry.register({
      id: 'boom',
      order: 100,
      fn: () => { throw new Error('boom'); },
    });
    registry.register({ id: 'later', order: 200, fn: later });
    await registry.trigger('programmatic');
    expect(later).toHaveBeenCalled();
  });

  it('trigger is idempotent within a single cascade', async () => {
    const registry = createShutdownHookRegistry();
    const fn = vi.fn();
    registry.register({ id: 'once', order: 100, fn });
    await Promise.all([registry.trigger('SIGTERM'), registry.trigger('SIGINT')]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('signal handlers install/uninstall without side effects when no triggers fire', () => {
    const registry = createShutdownHookRegistry();
    const beforeTerm = process.listenerCount('SIGTERM');
    const beforeInt = process.listenerCount('SIGINT');
    registry.installSignalHandlers();
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm + 1);
    expect(process.listenerCount('SIGINT')).toBe(beforeInt + 1);
    registry.uninstallSignalHandlers();
    expect(process.listenerCount('SIGTERM')).toBe(beforeTerm);
    expect(process.listenerCount('SIGINT')).toBe(beforeInt);
  });

  it('SHUTDOWN_ORDER constants are monotonically increasing (stop < log < sink < hmac < exit)', () => {
    const o = SHUTDOWN_ORDER;
    expect(o.STOP_ACCEPTING).toBeLessThan(o.FLUSH_STRUCTURED_LOG);
    expect(o.FLUSH_STRUCTURED_LOG).toBeLessThan(o.FLUSH_AUDIT_SINK);
    expect(o.FLUSH_AUDIT_SINK).toBeLessThan(o.HMAC_CLEAR_AND_SIGN);
    expect(o.HMAC_CLEAR_AND_SIGN).toBeLessThan(o.PROCESS_EXIT);
  });
});
