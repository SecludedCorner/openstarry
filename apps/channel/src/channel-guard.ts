/**
 * withChannelGuard — DRAINING state guard HOF.
 * Plan39 W4. AC-W4-1: returns typed error, does not throw.
 *
 * FROZEN: Architecture_Spec Plan39, Cycle 20260404_cycle03-3.
 */

import type { ChannelProcessState, ChannelGuardError } from "@openstarry/sdk";

/**
 * Wraps a channel operation with DRAINING state protection.
 *
 * If the channel is in DRAINING state, returns a ChannelGuardError without
 * calling fn() and without throwing. In all other states, delegates to fn().
 *
 * AC-W4-1: Tool registration during DRAINING returns typed error, does not throw.
 */
export async function withChannelGuard<T>(
  getState: () => ChannelProcessState,
  fn: () => Promise<T>,
): Promise<T | ChannelGuardError> {
  const currentState = getState();
  if (currentState === 'DRAINING') {
    return {
      code: 'CHANNEL_DRAINING',
      message: 'Channel is draining; operation rejected to allow graceful shutdown.',
      currentState,
    };
  }
  return fn();
}
