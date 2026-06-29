/**
 * CommTransport — real cross-daemon delivery of CommMessages.
 *
 * Fractal Society C/T1 (Spec Addendum C). Generalizes the proven alaya
 * daemon↔daemon transport (distributed-alaya's IpcRemotePeer): one daemon opens
 * a connection to a peer agent's daemon socket and calls the `comm.deliver` RPC.
 * Because this lives in the runner (not a plugin), it REUSES the runner's own
 * IPCClientImpl (the same line-delimited JSON-RPC client) rather than
 * re-implementing the wire — no plugin→runner layering concern here.
 *
 * Each message is HMAC-signed with the cluster key; the signature travels in the
 * RPC envelope (not inside the frozen CommMessage). The receiving daemon
 * verifies the signature, runs MessageRouter.validateMessage (fail-closed), then
 * delivers to its local agent.
 *
 * T1 connects per-deliver (connect → call → close) — simple and free of stale-
 * connection bugs. Connection pooling is a later optimization. Honest scope:
 * same-host (named pipe / UDS); cross-host is future.
 */

import { IPCClientImpl } from "./ipc-client.js";
import { getDefaultSocketPath } from "./platform.js";
import { signCommMessage, signCanonical } from "./comm-signature.js";
import type { CommMessage, DaemonPeerEndpoint } from "@openstarry/sdk";
import type { CoordinationMessage } from "./event-bridge.js";

export interface ICommTransport {
  /**
   * Sign + deliver `message` to `target`'s daemon over `comm.deliver`.
   * Resolves with the receiver's ack; rejects on connect/RPC/timeout error or a
   * receiver-side denial (HMAC / capability / replay), surfaced as the RPC error.
   */
  deliver(target: string, message: CommMessage): Promise<{ delivered: boolean }>;
  /**
   * Register `subscriber` for `eventTypes` on `target`'s daemon EventBridge
   * over `comm.subscribe` (C/T2). The subscription is signed so the publisher
   * can trust who asked to receive its events. Resolves on ack.
   */
  subscribe(target: string, subscriber: string, eventTypes: string[]): Promise<{ subscribed: boolean }>;
  /**
   * Sign + deliver a coordination `event` to a subscriber `target`'s daemon
   * over `comm.event` (C/T2). Resolves on ack; rejects on connect/HMAC error.
   */
  deliverEvent(target: string, event: CoordinationMessage): Promise<{ received: boolean }>;
  /**
   * Register `self` as a provider of `serviceName` on the `registry` hub's
   * GlobalServiceRegistry over `comm.register` (C/T3, signed). Resolves on ack.
   */
  registerService(
    registry: string,
    serviceName: string,
    self: string,
    selfSocketPath: string,
  ): Promise<{ registered: boolean }>;
  /**
   * Resolve `serviceName` to its provider endpoint(s) via the `registry` hub
   * over `comm.lookup` (C/T3, signed). Resolves with the providers (possibly []).
   */
  lookupService(
    registry: string,
    serviceName: string,
    requester: string,
  ): Promise<DaemonPeerEndpoint[]>;
}

export class CommTransport implements ICommTransport {
  constructor(
    private readonly home: string,
    private readonly keyHex: string,
    private readonly timeoutMs = 10_000,
    /** Resolve an agentId → socket path. Defaults to the platform convention. */
    private readonly resolveSocketPath: (agentId: string) => string = (id) =>
      getDefaultSocketPath(id, home),
  ) {}

  async deliver(target: string, message: CommMessage): Promise<{ delivered: boolean }> {
    const signature = signCommMessage(message, this.keyHex);
    const res = (await this.callPeer(target, "comm.deliver", { message, signature })) as
      | { delivered?: boolean }
      | undefined;
    return { delivered: res?.delivered === true };
  }

  async subscribe(
    target: string,
    subscriber: string,
    eventTypes: string[],
  ): Promise<{ subscribed: boolean }> {
    const subscription = { subscriber, eventTypes };
    const signature = signCanonical(subscription, this.keyHex);
    const res = (await this.callPeer(target, "comm.subscribe", { subscription, signature })) as
      | { subscribed?: boolean }
      | undefined;
    return { subscribed: res?.subscribed === true };
  }

  async deliverEvent(target: string, event: CoordinationMessage): Promise<{ received: boolean }> {
    const signature = signCanonical(event, this.keyHex);
    const res = (await this.callPeer(target, "comm.event", { event, signature })) as
      | { received?: boolean }
      | undefined;
    return { received: res?.received === true };
  }

  async registerService(
    registry: string,
    serviceName: string,
    self: string,
    selfSocketPath: string,
  ): Promise<{ registered: boolean }> {
    const registration = { serviceName, agentId: self, socketPath: selfSocketPath };
    const signature = signCanonical(registration, this.keyHex);
    const res = (await this.callPeer(registry, "comm.register", { registration, signature })) as
      | { registered?: boolean }
      | undefined;
    return { registered: res?.registered === true };
  }

  async lookupService(
    registry: string,
    serviceName: string,
    requester: string,
  ): Promise<DaemonPeerEndpoint[]> {
    const request = { serviceName, requester };
    const signature = signCanonical(request, this.keyHex);
    const res = (await this.callPeer(registry, "comm.lookup", { request, signature })) as
      | { providers?: DaemonPeerEndpoint[] }
      | undefined;
    return Array.isArray(res?.providers) ? res!.providers : [];
  }

  /** Connect-per-call JSON-RPC to a peer daemon's socket (T1 simplicity). */
  private async callPeer(target: string, method: string, params: unknown): Promise<unknown> {
    const socketPath = this.resolveSocketPath(target);
    const client = new IPCClientImpl({ socketPath, timeoutMs: this.timeoutMs });
    await client.connect();
    try {
      return await client.call(method, params);
    } finally {
      client.close();
    }
  }
}
