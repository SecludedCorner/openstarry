import type { CommMessage } from "@openstarry/sdk";
import { MAX_TRACE_DEPTH, MAX_COMM_METADATA_ENTRIES, MAX_COMM_METADATA_VALUE_SIZE } from "@openstarry/sdk";
import { createLogger } from "@openstarry/shared";

const logger = createLogger("MessageRouter");

export interface MessageRouteResult {
  allowed: boolean;
  reason?: string;
}

export interface AgentCommCapabilities {
  canSendTo: string[];
  canReceiveFrom: string[];
  exposedTools: string[];
}

/**
 * MessageRouter — capability enforcement for inter-agent messaging.
 *
 * Mechanism (fail-closed): If any check fails, the message is rejected.
 * Policy: The canSendTo/canReceiveFrom/exposedTools lists are configured per-agent.
 *
 * Plan37 C11, D2-R5.
 */
export class MessageRouter {
  private capabilities: Map<string, AgentCommCapabilities> = new Map();

  /** Register an agent's communication capabilities (called at agent start). */
  registerAgent(agentId: string, caps: AgentCommCapabilities): void {
    this.capabilities.set(agentId, caps);
  }

  /** Deregister an agent (called at agent stop/terminate). */
  deregisterAgent(agentId: string): void {
    this.capabilities.delete(agentId);
  }

  /** Get registered capabilities for an agent (undefined if not registered). */
  getAgentCapabilities(agentId: string): AgentCommCapabilities | undefined {
    return this.capabilities.get(agentId);
  }

  /**
   * Validate whether a message is allowed.
   * Fail-closed: any missing capability -> reject.
   */
  validateMessage(message: CommMessage): MessageRouteResult {
    const senderId = message.source;
    const receiverId = message.target;

    // SEC-004: Always verify sender is registered (fail-closed) before any
    // short-circuit — prevents unregistered senders from broadcasting.
    const senderCaps = this.capabilities.get(senderId);
    if (!senderCaps) {
      logger.warn(`Sender ${senderId} not registered`);
      return { allowed: false, reason: `Sender ${senderId} not registered` };
    }

    // No target = broadcast (allowed if sender is registered).
    if (!receiverId) {
      return { allowed: true };
    }

    // SEC-005 traceDepth enforcement (Plan38 C3):
    // Validate traceDepth is a non-negative integer when defined. Reject malformed
    // values (negative, float, NaN) to prevent bypass. Undefined = first hop (allowed).
    if (message.traceDepth !== undefined) {
      if (!Number.isInteger(message.traceDepth) || message.traceDepth < 0) {
        return {
          allowed: false,
          reason: `traceDepth must be a non-negative integer, got ${message.traceDepth}`,
        };
      }
      if (message.traceDepth > MAX_TRACE_DEPTH) {
        return {
          allowed: false,
          reason: `traceDepth ${message.traceDepth} exceeds MAX_TRACE_DEPTH (${MAX_TRACE_DEPTH})`,
        };
      }
    }

    // SEC-008 (Plan38 C13): Metadata size limit.
    // MECHANISM: fail-closed validation of metadata entries and value sizes.
    if (message.metadata !== undefined) {
      const entries = Object.entries(message.metadata);
      if (entries.length > MAX_COMM_METADATA_ENTRIES) {
        return {
          allowed: false,
          reason: `metadata has ${entries.length} entries, max ${MAX_COMM_METADATA_ENTRIES}`,
        };
      }
      for (const [key, value] of entries) {
        if (typeof value === 'string' && value.length > MAX_COMM_METADATA_VALUE_SIZE) {
          return {
            allowed: false,
            reason: `metadata["${key}"] value size ${value.length} exceeds max ${MAX_COMM_METADATA_VALUE_SIZE}`,
          };
        }
      }
    }

    const receiverCaps = this.capabilities.get(receiverId);
    if (!receiverCaps) {
      logger.warn(`Receiver ${receiverId} not registered`);
      return { allowed: false, reason: `Receiver ${receiverId} not registered` };
    }

    // Check 1: sender canSendTo receiver
    if (!senderCaps.canSendTo.includes(receiverId) && !senderCaps.canSendTo.includes('*')) {
      return { allowed: false, reason: `Sender ${senderId} not allowed to send to ${receiverId}` };
    }

    // Check 2: receiver canReceiveFrom sender
    if (!receiverCaps.canReceiveFrom.includes(senderId) && !receiverCaps.canReceiveFrom.includes('*')) {
      return { allowed: false, reason: `Receiver ${receiverId} does not accept from ${senderId}` };
    }

    return { allowed: true };
  }

  /** Validate child ⊆ parent capability constraint at spawn time (MECHANISM). */
  validateChildCapabilities(
    parentCaps: AgentCommCapabilities,
    childCaps: AgentCommCapabilities,
  ): MessageRouteResult {
    for (const target of childCaps.canSendTo) {
      if (!parentCaps.canSendTo.includes(target) && !parentCaps.canSendTo.includes('*')) {
        return { allowed: false, reason: `Child canSendTo '${target}' not in parent's canSendTo` };
      }
    }
    for (const source of childCaps.canReceiveFrom) {
      if (!parentCaps.canReceiveFrom.includes(source) && !parentCaps.canReceiveFrom.includes('*')) {
        return { allowed: false, reason: `Child canReceiveFrom '${source}' not in parent's canReceiveFrom` };
      }
    }
    for (const tool of childCaps.exposedTools) {
      if (!parentCaps.exposedTools.includes(tool)) {
        return { allowed: false, reason: `Child exposedTools '${tool}' not in parent's exposedTools` };
      }
    }
    return { allowed: true };
  }
}
