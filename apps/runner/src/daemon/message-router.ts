import type { CommMessage } from "@openstarry/sdk";
import {
  MAX_TRACE_DEPTH,
  MAX_COMM_METADATA_ENTRIES,
  MAX_COMM_METADATA_VALUE_SIZE,
  MAX_MESSAGE_AGE_MS,
  MAX_CLOCK_SKEW_MS,
} from "@openstarry/sdk";
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

  /**
   * Replay-defense cache: message id -> timestamp (ms). An id is recorded only
   * when a message is fully ACCEPTED, and pruned once older than
   * MAX_MESSAGE_AGE_MS. A repeat of a recorded id is rejected as a replay
   * (AT-1b / AT-5a). The freshness window bounds this map's size.
   */
  private seenMessageIds: Map<string, number> = new Map();

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

    // AT-1b / AT-5a: message replay + freshness defense (fail-closed).
    // Reject stale / future-dated / duplicate-id messages BEFORE the broadcast
    // short-circuit so broadcasts are protected too. Does not record yet —
    // an accepted id is recorded at the allow point so denied messages do not
    // pollute the cache.
    const replay = this.checkReplay(message);
    if (!replay.allowed) {
      return replay;
    }

    // No target = broadcast (allowed if sender is registered).
    if (!receiverId) {
      this.markSeen(message);
      return { allowed: true };
    }

    // SEC-005 traceDepth + SEC-008 metadata limits (shared envelope checks).
    const envelope = this.checkEnvelopeLimits(message);
    if (!envelope.allowed) return envelope;

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

    this.markSeen(message);
    return { allowed: true };
  }

  /**
   * Cross-daemon OUTBOUND check (sender side, Fractal Society C/T1). The local
   * SOURCE agent must be registered and its canSendTo must permit the target.
   * The receiver's acceptance policy + replay/freshness are enforced
   * independently by the receiving daemon (validateInbound) — in the
   * 1-daemon-per-agent model each daemon only knows its own agent's caps.
   */
  validateOutbound(source: string, target: string): MessageRouteResult {
    const caps = this.capabilities.get(source);
    if (!caps) {
      return { allowed: false, reason: `Sender ${source} not registered` };
    }
    if (!caps.canSendTo.includes(target) && !caps.canSendTo.includes('*')) {
      return { allowed: false, reason: `Sender ${source} not allowed to send to ${target}` };
    }
    return { allowed: true };
  }

  /**
   * Cross-daemon INBOUND check (receiver side, Fractal Society C/T1), run AFTER
   * the caller has HMAC-verified the message (so `source` is unforgeable). The
   * remote sender is NOT locally registered — its identity comes from the HMAC,
   * and its canSendTo was enforced by the sending daemon (validateOutbound).
   * Here we enforce: replay + freshness (AT-1b/5a) + envelope limits + the local
   * RECEIVER agent's canReceiveFrom. Records the id on accept (replay defense).
   */
  validateInbound(message: CommMessage): MessageRouteResult {
    const replay = this.checkReplay(message);
    if (!replay.allowed) return replay;

    const envelope = this.checkEnvelopeLimits(message);
    if (!envelope.allowed) return envelope;

    const receiverId = message.target;
    if (!receiverId) {
      return { allowed: false, reason: `inbound message has no target (T1 is point-to-point)` };
    }
    const receiverCaps = this.capabilities.get(receiverId);
    if (!receiverCaps) {
      return { allowed: false, reason: `Receiver ${receiverId} not registered` };
    }
    if (
      !receiverCaps.canReceiveFrom.includes(message.source) &&
      !receiverCaps.canReceiveFrom.includes('*')
    ) {
      return { allowed: false, reason: `Receiver ${receiverId} does not accept from ${message.source}` };
    }

    this.markSeen(message);
    return { allowed: true };
  }

  /**
   * SEC-005 traceDepth + SEC-008 metadata size limits (shared by validateMessage
   * and validateInbound). Pure — does not record anything.
   */
  private checkEnvelopeLimits(message: CommMessage): MessageRouteResult {
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
    return { allowed: true };
  }

  /**
   * AT-1b / AT-5a replay + freshness check (pure lookup — does not record).
   * Fail-closed: a malformed timestamp/id, a stale or future-dated message, or
   * a previously-seen id is rejected.
   */
  private checkReplay(message: CommMessage): MessageRouteResult {
    const now = Date.now();
    this.pruneSeen(now);

    const ts = message.timestamp;
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      return { allowed: false, reason: `message.timestamp must be a finite number, got ${ts}` };
    }
    if (now - ts > MAX_MESSAGE_AGE_MS) {
      return {
        allowed: false,
        reason: `message is stale (age ${now - ts}ms exceeds MAX_MESSAGE_AGE_MS ${MAX_MESSAGE_AGE_MS}ms)`,
      };
    }
    if (ts - now > MAX_CLOCK_SKEW_MS) {
      return {
        allowed: false,
        reason: `message timestamp is ${ts - now}ms in the future, exceeds MAX_CLOCK_SKEW_MS ${MAX_CLOCK_SKEW_MS}ms`,
      };
    }

    const id = message.id;
    if (typeof id !== 'string' || id.length === 0) {
      return { allowed: false, reason: `message.id must be a non-empty string for replay defense` };
    }
    if (this.seenMessageIds.has(id)) {
      return { allowed: false, reason: `replayed message id '${id}' rejected (AT-1b/AT-5a)` };
    }

    return { allowed: true };
  }

  /** Record an accepted message id for replay defense. */
  private markSeen(message: CommMessage): void {
    this.seenMessageIds.set(message.id, message.timestamp);
  }

  /** Drop seen ids older than the freshness window to bound memory. */
  private pruneSeen(now: number): void {
    for (const [id, ts] of this.seenMessageIds) {
      if (now - ts > MAX_MESSAGE_AGE_MS) {
        this.seenMessageIds.delete(id);
      }
    }
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
