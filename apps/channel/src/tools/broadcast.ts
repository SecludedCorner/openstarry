/**
 * broadcast — per-target capability-checked multicast.
 * Plan38 C6d.
 * Gate: canSendTo per target (checked individually).
 * Uses Promise.allSettled for partial success reporting.
 */

import type { CommMessage, BroadcastResult } from "@openstarry/sdk";
import type { AgentRegistry } from "../registry.js";

export async function broadcastMessage(
  registry: AgentRegistry,
  senderId: string,
  message: CommMessage,
): Promise<BroadcastResult[]> {
  await registry.lock.acquireRead();
  try {
    const sender = registry.get(senderId);
    if (!sender) {
      return [{ agentId: senderId, success: false, error: "Sender not registered" }];
    }

    const senderCaps = sender.routingCapabilities;
    const targets = registry.list().filter(a => a.agentId !== senderId && a.health !== 'TERMINATED');
    const results: BroadcastResult[] = [];

    for (const target of targets) {
      const targetCaps = target.routingCapabilities;
      // Per-target canSendTo check
      if (!senderCaps.canSendTo.includes(target.agentId) && !senderCaps.canSendTo.includes('*')) {
        results.push({ agentId: target.agentId, success: false, error: "canSendTo denied" });
        continue;
      }
      // Per-target canReceiveFrom check
      if (!targetCaps.canReceiveFrom.includes(senderId) && !targetCaps.canReceiveFrom.includes('*')) {
        results.push({ agentId: target.agentId, success: false, error: "canReceiveFrom denied" });
        continue;
      }
      // Delivery (stub — actual IPC delivery deferred to runtime wiring)
      results.push({ agentId: target.agentId, success: true });
    }

    return results;
  } finally {
    registry.lock.releaseRead();
  }
}
