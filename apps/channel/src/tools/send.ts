/**
 * send_message — 7-step routing validation chain.
 * Plan38 C6c.
 *
 * MECHANISM: fail-closed at each step (Rule #29).
 * Error codes in -33xxx range.
 */

import type { CommMessage } from "@openstarry/sdk";
import { MAX_TRACE_DEPTH } from "@openstarry/sdk";
import type { AgentRegistry } from "../registry.js";

/** Maximum message payload size in bytes. */
const MAX_MESSAGE_SIZE = 1_048_576; // 1 MB

export interface SendResult {
  delivered: boolean;
  reason?: string;
  errorCode?: number;
}

/**
 * 7-step routing validation chain:
 * 1. L1: Sender registered?
 * 2. L2: Target registered?
 * 3. L3: Sender has canSendTo for target?
 * 4. L4: Target has canReceiveFrom for sender?
 * 5. L5: traceDepth <= MAX_TRACE_DEPTH?
 * 6. L6: Message size <= MAX_MESSAGE_SIZE?
 * 7. L7: Payload schema validation (basic — not null/undefined)
 */
export async function sendMessage(
  registry: AgentRegistry,
  senderId: string,
  message: CommMessage,
): Promise<SendResult> {
  await registry.lock.acquireRead();
  try {
    // L1: Sender registered?
    const sender = registry.get(senderId);
    if (!sender) {
      return { delivered: false, reason: `Sender "${senderId}" not registered`, errorCode: -33001 };
    }

    const targetId = message.target;
    if (!targetId) {
      return { delivered: false, reason: "Target required for send_message (use broadcast for no target)", errorCode: -33002 };
    }

    // L2: Target registered?
    const target = registry.get(targetId);
    if (!target) {
      return { delivered: false, reason: `Target "${targetId}" not registered`, errorCode: -33003 };
    }

    const senderCaps = sender.routingCapabilities;
    const targetCaps = target.routingCapabilities;

    // L3: Sender canSendTo target?
    if (!senderCaps.canSendTo.includes(targetId) && !senderCaps.canSendTo.includes('*')) {
      return { delivered: false, reason: `Sender "${senderId}" not allowed to send to "${targetId}"`, errorCode: -33004 };
    }

    // L4: Target canReceiveFrom sender?
    if (!targetCaps.canReceiveFrom.includes(senderId) && !targetCaps.canReceiveFrom.includes('*')) {
      return { delivered: false, reason: `Target "${targetId}" does not accept from "${senderId}"`, errorCode: -33005 };
    }

    // L5: traceDepth check
    if (message.traceDepth !== undefined) {
      if (!Number.isInteger(message.traceDepth) || message.traceDepth < 0) {
        return { delivered: false, reason: `traceDepth must be non-negative integer`, errorCode: -33006 };
      }
      if (message.traceDepth > MAX_TRACE_DEPTH) {
        return { delivered: false, reason: `traceDepth ${message.traceDepth} exceeds MAX_TRACE_DEPTH (${MAX_TRACE_DEPTH})`, errorCode: -33007 };
      }
    }

    // L6: Message size check
    const msgSize = JSON.stringify(message).length;
    if (msgSize > MAX_MESSAGE_SIZE) {
      return { delivered: false, reason: `Message size ${msgSize} exceeds MAX_MESSAGE_SIZE (${MAX_MESSAGE_SIZE})`, errorCode: -33008 };
    }

    // L7: Payload validation
    if (message.payload === null || message.payload === undefined) {
      return { delivered: false, reason: "payload must not be null or undefined", errorCode: -33009 };
    }

    // All checks passed — deliver (actual IPC delivery deferred to runtime wiring)
    return { delivered: true };
  } finally {
    registry.lock.releaseRead();
  }
}
