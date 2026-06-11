/**
 * PipelineChannel — local IPC channel for intra-process agent communication.
 * Plan38 C12 (SEC-007).
 *
 * Wires comm:send through MessageRouter for security checks.
 * All messages are validated by MessageRouter (capability enforcement, SEC-005,
 * SEC-008) before delivery. This ensures at least one functional IPC channel
 * exists before McpHubChannel development.
 *
 * MECHANISM: MessageRouter integration is non-bypassable.
 * Classification: 色蘊 (Rupa/IListener) — IPC transport wiring.
 */

import type {
  ICommChannel,
  CommCapability,
  CommTopology,
  CommChannelStatus,
  CommMessage,
  CommMessageHandler,
} from "@openstarry/sdk";
import { CommCapabilityError } from "@openstarry/sdk";
import { MessageRouter } from "./message-router.js";

/**
 * PipelineChannel — in-process point-to-point channel.
 *
 * Backed by the Daemon's MessageRouter for all capability and security checks.
 * Messages sent via this channel go through:
 *   1. MessageRouter.validateMessage() — capability + SEC-005 + SEC-008
 *   2. In-process delivery to registered onMessage handlers
 */
export class PipelineChannel implements ICommChannel {
  readonly name = 'pipeline';
  readonly version = '1.0.0';
  readonly capabilities: readonly CommCapability[] = ['messaging'];
  readonly topology: CommTopology = 'pipeline';

  private status: CommChannelStatus = 'disconnected';
  private handlers: CommMessageHandler[] = [];

  constructor(private readonly messageRouter: MessageRouter) {}

  getStatus(): CommChannelStatus {
    return this.status;
  }

  async connect(_target?: string): Promise<void> {
    this.status = 'connected';
  }

  async disconnect(): Promise<void> {
    this.status = 'disconnected';
    this.handlers = [];
  }

  /**
   * Send a message — routes through MessageRouter for security enforcement.
   * MECHANISM: validation is non-bypassable (fail-closed, Rule #29).
   *
   * SEC-007: This wiring ensures PipelineChannel uses the shared MessageRouter,
   * not a stub bypass. Any message failing validation is rejected with an error.
   */
  async send(target: string, message: CommMessage): Promise<void> {
    if (this.status !== 'connected') {
      throw new Error(`PipelineChannel is not connected (status: ${this.status})`);
    }

    // Route through MessageRouter — enforces capability, traceDepth (SEC-005),
    // metadata limits (SEC-008), and canSendTo/canReceiveFrom checks.
    const result = this.messageRouter.validateMessage(message);
    if (!result.allowed) {
      throw new Error(`PipelineChannel send denied: ${result.reason}`);
    }

    // In-process delivery to registered handlers
    for (const handler of this.handlers) {
      try {
        handler(message, message.source);
      } catch {
        // Individual handler failure does not abort delivery to others
      }
    }
  }

  /**
   * Register a handler for incoming messages.
   * Returns unsubscribe function.
   */
  onMessage(handler: CommMessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const idx = this.handlers.indexOf(handler);
      if (idx !== -1) this.handlers.splice(idx, 1);
    };
  }

  async reply(msgId: string, response: CommMessage): Promise<void> {
    throw new CommCapabilityError(this.name, 'rpc', this.capabilities);
  }
}
