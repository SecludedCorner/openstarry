/**
 * CompositeChannel — composes multiple ICommChannel instances under a strategy.
 *
 * Implements Architecture_Documentation/53 §11 (Composition Model). Channels
 * declaring the `composable` capability can be wrapped by a CompositeChannel
 * with one of three strategies:
 *   - fallback:  try children in order; first success wins (primary + secondary failover).
 *   - broadcast: send to all children concurrently; succeeds if at least one delivers.
 *   - pipeline:  send through children sequentially; every stage must succeed (A→B→C handoff).
 *
 * Constraints (Doc 53 §11):
 *   - Max composition depth: 3 (prevents unbounded nesting).
 *   - Capabilities = intersection of all child capabilities.
 *   - Only `composable` children may participate.
 *   - Lifecycle (connect/disconnect) delegates to all children.
 *
 * Reference implementation of the FROZEN ICommChannel interface, sibling to
 * PipelineChannel. NEW IN v0.59.6 (Doc 53 §11 closure).
 */

import type {
  ICommChannel,
  CommMessage,
  CommCapability,
  CommChannelStatus,
  CommTopology,
  CommMessageHandler,
} from "@openstarry/sdk";
import { CommCapabilityError } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("CompositeChannel");

export type CompositionStrategy = 'fallback' | 'broadcast' | 'pipeline';

/** Max composition nesting depth (Doc 53 §11). */
export const MAX_COMPOSITION_DEPTH = 3 as const;

const STRATEGY_TOPOLOGY: Record<CompositionStrategy, CommTopology> = {
  fallback: 'point-to-point',
  broadcast: 'broadcast',
  pipeline: 'pipeline',
};

/** Compute the composition depth of a channel (leaf = 0, composite = 1 + max child depth). */
function depthOf(channel: ICommChannel): number {
  return channel instanceof CompositeChannel ? channel.compositionDepth : 0;
}

export class CompositeChannel implements ICommChannel {
  readonly name: string;
  readonly version = '1.0.0';
  readonly capabilities: readonly CommCapability[];
  readonly topology: CommTopology;
  /** Nesting depth: 1 when wrapping only leaf channels, +1 per nested composite. */
  readonly compositionDepth: number;

  private readonly children: readonly ICommChannel[];
  private readonly strategy: CompositionStrategy;
  private status: CommChannelStatus = 'disconnected';

  constructor(name: string, children: readonly ICommChannel[], strategy: CompositionStrategy) {
    if (children.length === 0) {
      throw new Error("CompositeChannel requires at least one child channel");
    }
    // Only composable children may participate (Doc 53 §11).
    for (const child of children) {
      if (!child.capabilities.includes('composable')) {
        throw new Error(
          `Child channel "${child.name}" is not composable (capabilities: [${child.capabilities.join(', ')}])`,
        );
      }
    }
    // Depth limit: 1 + deepest nested composite, must not exceed MAX_COMPOSITION_DEPTH.
    const depth = 1 + Math.max(0, ...children.map(depthOf));
    if (depth > MAX_COMPOSITION_DEPTH) {
      throw new Error(
        `CompositeChannel nesting depth ${depth} exceeds MAX_COMPOSITION_DEPTH (${MAX_COMPOSITION_DEPTH})`,
      );
    }

    this.name = name;
    this.children = children;
    this.strategy = strategy;
    this.compositionDepth = depth;
    this.topology = STRATEGY_TOPOLOGY[strategy];
    this.capabilities = CompositeChannel.intersectCapabilities(children);
  }

  /** Capabilities = intersection of all children's capabilities. */
  private static intersectCapabilities(children: readonly ICommChannel[]): readonly CommCapability[] {
    const [first, ...rest] = children;
    return first.capabilities.filter((cap) =>
      rest.every((c) => c.capabilities.includes(cap)),
    );
  }

  getStatus(): CommChannelStatus {
    return this.status;
  }

  async connect(target?: string): Promise<void> {
    try {
      this.status = 'connecting';
      await Promise.all(this.children.map((c) => c.connect(target)));
      this.status = 'connected';
    } catch (err) {
      this.status = 'error';
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.status = 'draining';
    await Promise.all(this.children.map((c) => c.disconnect().catch(() => undefined)));
    this.status = 'disconnected';
  }

  async send(target: string, message: CommMessage): Promise<void> {
    if (!this.capabilities.includes('messaging')) {
      throw new CommCapabilityError(this.name, 'messaging', this.capabilities);
    }
    const senders = this.children.filter((c) => typeof c.send === 'function');
    if (senders.length === 0) {
      throw new Error(`CompositeChannel "${this.name}" has no messaging-capable children`);
    }

    switch (this.strategy) {
      case 'fallback': {
        const errors: string[] = [];
        for (const child of senders) {
          try {
            await child.send!(target, message);
            return; // first success wins
          } catch (err) {
            errors.push(`${child.name}: ${(err as Error).message}`);
          }
        }
        throw new Error(`CompositeChannel fallback exhausted all children — ${errors.join('; ')}`);
      }
      case 'broadcast': {
        const results = await Promise.allSettled(senders.map((c) => c.send!(target, message)));
        const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failures.length === senders.length) {
          throw new Error(
            `CompositeChannel broadcast failed on all children — ` +
            failures.map((f) => (f.reason as Error)?.message ?? String(f.reason)).join('; '),
          );
        }
        if (failures.length > 0) {
          logger.warn(`broadcast: ${failures.length}/${senders.length} children failed (best-effort delivered)`);
        }
        return;
      }
      case 'pipeline': {
        // Sequential A→B→C handoff: every stage must succeed.
        for (const child of senders) {
          await child.send!(target, message);
        }
        return;
      }
    }
  }

  onMessage(handler: CommMessageHandler): () => void {
    const unsubs = this.children
      .filter((c) => typeof c.onMessage === 'function')
      .map((c) => c.onMessage!(handler));
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }
}
