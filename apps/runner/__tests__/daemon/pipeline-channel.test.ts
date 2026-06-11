/**
 * PipelineChannel tests — Plan38 C12 (SEC-007).
 *
 * SEC-007: PipelineChannel must route messages through MessageRouter (not a stub).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PipelineChannel } from "../../src/daemon/pipeline-channel.js";
import { MessageRouter } from "../../src/daemon/message-router.js";
import type { CommMessage } from "@openstarry/sdk";
import { MAX_COMM_METADATA_ENTRIES, MAX_COMM_METADATA_VALUE_SIZE } from "@openstarry/sdk";

function makeMessage(source: string, target: string, overrides?: Partial<CommMessage>): CommMessage {
  return {
    id: `msg-${source}-${target}`,
    timestamp: Date.now(),
    source,
    target,
    payload: { text: 'hello' },
    performative: 'inform',
    ...overrides,
  };
}

describe("PipelineChannel (Plan38 C12 — SEC-007)", () => {
  let router: MessageRouter;
  let channel: PipelineChannel;

  beforeEach(async () => {
    router = new MessageRouter();
    channel = new PipelineChannel(router);
    await channel.connect();
  });

  it("has correct static metadata", () => {
    expect(channel.name).toBe('pipeline');
    expect(channel.topology).toBe('pipeline');
    expect(channel.capabilities).toContain('messaging');
  });

  it("connect() sets status to connected", () => {
    expect(channel.getStatus()).toBe('connected');
  });

  it("disconnect() sets status to disconnected", async () => {
    await channel.disconnect();
    expect(channel.getStatus()).toBe('disconnected');
  });

  describe("SEC-007: routes through MessageRouter", () => {
    it("delivers message to registered handler when capabilities allow", async () => {
      router.registerAgent('sender', { canSendTo: ['*'], canReceiveFrom: ['*'], exposedTools: [] });
      router.registerAgent('receiver', { canSendTo: [], canReceiveFrom: ['*'], exposedTools: [] });

      const received: CommMessage[] = [];
      channel.onMessage((msg) => received.push(msg));

      await channel.send('receiver', makeMessage('sender', 'receiver'));

      expect(received).toHaveLength(1);
      expect(received[0].source).toBe('sender');
    });

    it("rejects send when sender not registered (fail-closed)", async () => {
      router.registerAgent('receiver', { canSendTo: [], canReceiveFrom: ['*'], exposedTools: [] });

      await expect(
        channel.send('receiver', makeMessage('unregistered', 'receiver'))
      ).rejects.toThrow(/denied/);
    });

    it("rejects send when sender lacks canSendTo permission (fail-closed)", async () => {
      router.registerAgent('sender', { canSendTo: [], canReceiveFrom: [], exposedTools: [] });
      router.registerAgent('receiver', { canSendTo: [], canReceiveFrom: ['sender'], exposedTools: [] });

      await expect(
        channel.send('receiver', makeMessage('sender', 'receiver'))
      ).rejects.toThrow(/denied/);
    });

    it("rejects send when receiver lacks canReceiveFrom permission (fail-closed)", async () => {
      router.registerAgent('sender', { canSendTo: ['receiver'], canReceiveFrom: [], exposedTools: [] });
      router.registerAgent('receiver', { canSendTo: [], canReceiveFrom: [], exposedTools: [] });

      await expect(
        channel.send('receiver', makeMessage('sender', 'receiver'))
      ).rejects.toThrow(/denied/);
    });

    it("SEC-005: rejects message with invalid traceDepth (negative)", async () => {
      router.registerAgent('sender', { canSendTo: ['*'], canReceiveFrom: ['*'], exposedTools: [] });
      router.registerAgent('receiver', { canSendTo: [], canReceiveFrom: ['*'], exposedTools: [] });

      await expect(
        channel.send('receiver', makeMessage('sender', 'receiver', { traceDepth: -1 }))
      ).rejects.toThrow(/denied/);
    });

    it("SEC-008: rejects message with too many metadata entries", async () => {
      router.registerAgent('sender', { canSendTo: ['*'], canReceiveFrom: ['*'], exposedTools: [] });
      router.registerAgent('receiver', { canSendTo: [], canReceiveFrom: ['*'], exposedTools: [] });

      const oversizedMetadata: Record<string, string> = {};
      for (let i = 0; i < MAX_COMM_METADATA_ENTRIES + 1; i++) {
        oversizedMetadata[`key${i}`] = 'value';
      }

      await expect(
        channel.send('receiver', makeMessage('sender', 'receiver', { metadata: oversizedMetadata }))
      ).rejects.toThrow(/denied/);
    });

    it("SEC-008: rejects message with oversized metadata value", async () => {
      router.registerAgent('sender', { canSendTo: ['*'], canReceiveFrom: ['*'], exposedTools: [] });
      router.registerAgent('receiver', { canSendTo: [], canReceiveFrom: ['*'], exposedTools: [] });

      await expect(
        channel.send('receiver', makeMessage('sender', 'receiver', {
          metadata: { key: 'x'.repeat(MAX_COMM_METADATA_VALUE_SIZE + 1) },
        }))
      ).rejects.toThrow(/denied/);
    });
  });

  describe("onMessage handler management", () => {
    it("unsubscribe removes handler", async () => {
      router.registerAgent('sender', { canSendTo: ['*'], canReceiveFrom: ['*'], exposedTools: [] });
      router.registerAgent('receiver', { canSendTo: [], canReceiveFrom: ['*'], exposedTools: [] });

      const received: CommMessage[] = [];
      const unsub = channel.onMessage((msg) => received.push(msg));

      unsub();

      await channel.send('receiver', makeMessage('sender', 'receiver'));
      expect(received).toHaveLength(0);
    });
  });

  it("rejects send when not connected", async () => {
    await channel.disconnect();
    router.registerAgent('sender', { canSendTo: ['*'], canReceiveFrom: ['*'], exposedTools: [] });
    router.registerAgent('receiver', { canSendTo: [], canReceiveFrom: ['*'], exposedTools: [] });

    await expect(
      channel.send('receiver', makeMessage('sender', 'receiver'))
    ).rejects.toThrow(/not connected/);
  });
});
