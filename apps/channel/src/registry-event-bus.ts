/**
 * RegistryEventBus — IRegistryEventBus implementation.
 *
 * Plan39 W3: Implements the PROVISIONAL IRegistryEventBus interface.
 * Internal event dispatch using Map<type, Set<handler>>.
 *
 * PROVISIONAL: This class backs a PROVISIONAL interface.
 * NOT FROZEN. Plan40 re-evaluation required.
 *
 * Trust hierarchy (CONSTRAINT-D12):
 * - emit() is Daemon-side only; Channel must not call emit() to claim identity.
 * - on() is Channel-side; handlers update the read-replica registry.
 * - isReady() reflects whether the underlying IPC transport is connected.
 *
 * AT-7 attack vectors closed:
 * - AT-7a (Ghost Agent): Channel only receives events — never originates them.
 * - AT-7b (Shadow Agent): Daemon deduplicates before emitting agent:spawned.
 * - AT-7c (Identity Split): Daemon serializes terminate-before-register.
 */

import type {
  IRegistryEventBus,
  RegistryEvent,
  RegistryEventType,
} from "@openstarry/sdk";

/** Handler function for a specific event type. */
type RegistryEventHandler = (event: RegistryEvent) => void;

/**
 * RegistryEventBus — in-process event bus implementing IRegistryEventBus.
 *
 * PROVISIONAL: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 * @since v0.39.0-alpha
 * @provisional Plan40 re-evaluation required
 */
export class RegistryEventBus implements IRegistryEventBus {
  private readonly handlers = new Map<RegistryEventType, Set<RegistryEventHandler>>();
  private ready = false;

  /**
   * Mark the IPC channel as ready.
   * Called after the fork IPC channel is established (AC-W3-1).
   */
  setReady(value: boolean): void {
    this.ready = value;
  }

  /**
   * Emit a registry event to all subscribers.
   * Daemon-side only — Channel must not call this to assert identity claims (AC-W3-3).
   * Fail-open: handler errors are swallowed to prevent one bad handler from
   * blocking the event pipeline.
   */
  emit(event: RegistryEvent): void {
    const set = this.handlers.get(event.type);
    if (!set || set.size === 0) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        // Fail-open: delivery errors must not abort the event pipeline.
      }
    }
  }

  /**
   * Subscribe to a registry event type.
   * Channel-side: handlers update the local read-replica registry.
   * Returns an unsubscribe function.
   */
  on(type: RegistryEventType, handler: RegistryEventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  /** Check if the IPC channel transport is ready. */
  isReady(): boolean {
    return this.ready;
  }
}
