"use client";

export type RoleplayMode = "live" | "mock" | "visualTest" | "fakeLive";

export type RoleplayStatus =
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

export type TranscriptRole = "agent" | "user" | "system";
export type TranscriptChannel = "voice" | "chat" | "system";
export type TranscriptStatus = "interim" | "final" | "sending" | "sent" | "failed";
export type TranscriptSource = "sdk" | "local" | "mock" | "system";

export type TranscriptMessage = {
  id: string;
  role: TranscriptRole;
  channel: TranscriptChannel;
  text: string;
  status: TranscriptStatus;
  source: TranscriptSource;
  createdAt: number;
  clientMessageId?: string | undefined;
  sdkMessageId?: string | undefined;
};

export type UseRoleplayConversationReturn = {
  status: RoleplayStatus;
  messages: TranscriptMessage[];
  isConnected: boolean;
  isConnecting: boolean;
  isMuted: boolean;
  isAgentSpeaking: boolean;
  isAwaitingAgentResponse: boolean;
  errorMessage: string | null;
  startConversation: () => Promise<void>;
  endConversation: () => Promise<void>;
  startNewConversation: () => Promise<void>;
  sendTextMessage: (text: string, retryClientMessageId?: string) => Promise<void>;
  toggleMute: () => Promise<void>;
  setOutputVolume: (volume: number) => Promise<void>;
  changeInputDevice: (deviceId: string) => Promise<void>;
  getInputVolume: () => number;
  getOutputVolume: () => number;
};

export type RoleplayHistoryItem = {
  id: string;
  title: string;
  endedAt: string;
  turns: number;
};

export function isActiveStatus(status: RoleplayStatus) {
  return (
    status === "connected" ||
    status === "listening" ||
    status === "thinking" ||
    status === "speaking" ||
    status === "muted"
  );
}
