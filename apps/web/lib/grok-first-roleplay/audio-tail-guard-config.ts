export const TAIL_GUARD_NORMAL_HOLD_MS = 300;
export const TAIL_GUARD_RISK_HOLD_MS = 800;
export const TAIL_GUARD_MAX_HOLD_MS = 1000;
export const FULL_TURN_BUFFER_FORBIDDEN = true;
export const REPLACEMENT_TTS_FORBIDDEN = true;

export function selectTailHoldMs(input: { risky: boolean }): 300 | 800 {
  return input.risky ? TAIL_GUARD_RISK_HOLD_MS : TAIL_GUARD_NORMAL_HOLD_MS;
}
