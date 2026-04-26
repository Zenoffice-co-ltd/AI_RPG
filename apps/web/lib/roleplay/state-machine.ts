export type RoleplayState =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "ending"
  | "ended"
  | "error";

export type RoleplayEvent =
  | "START"
  | "CONNECTED"
  | "LISTENING"
  | "THINKING"
  | "SPEAKING"
  | "MUTE"
  | "UNMUTE"
  | "END"
  | "ENDED"
  | "ERROR"
  | "RETRY";

const transitions: Record<RoleplayState, Partial<Record<RoleplayEvent, RoleplayState>>> = {
  idle: { START: "connecting", ERROR: "error" },
  connecting: { CONNECTED: "connected", ERROR: "error", END: "ending" },
  connected: {
    LISTENING: "listening",
    THINKING: "thinking",
    SPEAKING: "speaking",
    MUTE: "muted",
    END: "ending",
    ERROR: "error",
  },
  listening: {
    THINKING: "thinking",
    SPEAKING: "speaking",
    MUTE: "muted",
    END: "ending",
    ERROR: "error",
  },
  thinking: {
    LISTENING: "listening",
    SPEAKING: "speaking",
    MUTE: "muted",
    END: "ending",
    ERROR: "error",
  },
  speaking: {
    LISTENING: "listening",
    THINKING: "thinking",
    MUTE: "muted",
    END: "ending",
    ERROR: "error",
  },
  muted: {
    UNMUTE: "connected",
    END: "ending",
    ERROR: "error",
    LISTENING: "muted",
    SPEAKING: "muted",
  },
  ending: { ENDED: "ended", ERROR: "error" },
  ended: { START: "connecting", RETRY: "idle" },
  error: { RETRY: "idle", START: "connecting" },
};

export function transitionRoleplayState(
  current: RoleplayState,
  event: RoleplayEvent
): RoleplayState {
  return transitions[current][event] ?? current;
}

export function canStartSession(state: RoleplayState) {
  return state === "idle" || state === "ended" || state === "error";
}
