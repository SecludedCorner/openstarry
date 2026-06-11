/**
 * VedanaEmergency — pure stateful function for sustained dukkha detection.
 *
 * When vedana intensity stays above threshold for sustained ticks,
 * produces a threshold boost that ManoAggregator adds to effectiveBaseThreshold.
 *
 * @skandha vedana (受蘊)
 * @see Plan28: VedanaEmergency wiring to ManoAggregator
 */

import type { ChannelVedana, VedanaEmergencyConfig } from "@openstarry/sdk";
import { DEFAULT_VEDANA_EMERGENCY_CONFIG } from "@openstarry/sdk";

export interface VedanaEmergencyState {
  consecutiveDukkhaTicks: number;
  cooldownRemaining: number;
}

export function createVedanaEmergencyState(): VedanaEmergencyState {
  return { consecutiveDukkhaTicks: 0, cooldownRemaining: 0 };
}

export function checkVedanaEmergency(
  vedana: ChannelVedana,
  state: VedanaEmergencyState,
  config: VedanaEmergencyConfig = DEFAULT_VEDANA_EMERGENCY_CONFIG,
): { thresholdBoost: number; updatedState: VedanaEmergencyState } {
  // During cooldown, decrement and return no boost
  if (state.cooldownRemaining > 0) {
    return {
      thresholdBoost: 0,
      updatedState: {
        consecutiveDukkhaTicks: 0,
        cooldownRemaining: state.cooldownRemaining - 1,
      },
    };
  }

  // Check if current vedana is sustained dukkha
  const isDukkha = vedana.type === 'dukkha' && vedana.intensity >= config.intensityThreshold;

  if (isDukkha) {
    const newTicks = state.consecutiveDukkhaTicks + 1;
    if (newTicks >= config.sustainedTicks) {
      // Trigger emergency: apply boost and enter cooldown
      return {
        thresholdBoost: config.maxThresholdBoost,
        updatedState: {
          consecutiveDukkhaTicks: 0,
          cooldownRemaining: config.cooldownTicks,
        },
      };
    }
    return {
      thresholdBoost: 0,
      updatedState: {
        consecutiveDukkhaTicks: newTicks,
        cooldownRemaining: 0,
      },
    };
  }

  // Not dukkha: reset counter
  return {
    thresholdBoost: 0,
    updatedState: { consecutiveDukkhaTicks: 0, cooldownRemaining: 0 },
  };
}
