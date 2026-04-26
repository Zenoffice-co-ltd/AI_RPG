"use client";

import type { NormalizedConversationEvent } from "./normalize-conversation-event";

export type FakeLiveAdapter = {
  start: (generation: number) => Promise<void>;
  end: () => Promise<void>;
  sendText: (text: string, generation: number) => Promise<void>;
  setMuted: (muted: boolean) => Promise<void>;
  getInputVolume: () => number;
  getOutputVolume: () => number;
  getMuteCallCount: () => number;
};

type FakeLiveAdapterOptions = {
  onConnect: (generation: number) => void;
  onDisconnect: (generation: number) => void;
  onMessage: (event: NormalizedConversationEvent, generation: number) => void;
};

export function createFakeLiveAdapter({
  onConnect,
  onDisconnect,
  onMessage,
}: FakeLiveAdapterOptions): FakeLiveAdapter {
  let muted = false;
  let muteCallCount = 0;
  const timers = new Set<number>();

  function schedule(callback: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  }

  function clearTimers() {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
    timers.clear();
  }

  return {
    start(generation) {
      schedule(() => onConnect(generation), 40);
      schedule(() => {
        onMessage(
          {
            role: "agent",
            text: "お時間ありがとうございます。まずは、御社の進め方も含めてご相談させていただけますか。",
            isFinal: true,
            channel: "voice",
            sdkMessageId: `fake-agent-start-${generation}`,
          },
          generation
        );
      }, 100);
      schedule(() => {
        if (muted) {
          return;
        }
        onMessage(
          {
            role: "user",
            text: "募集背景を確認したいです。",
            isFinal: true,
            channel: "voice",
            sdkMessageId: `fake-user-voice-${generation}`,
          },
          generation
        );
      }, 1_500);
      return Promise.resolve();
    },
    end() {
      clearTimers();
      onDisconnect(-1);
      return Promise.resolve();
    },
    sendText(text, generation) {
      schedule(() => {
        onMessage(
          {
            role: "agent",
            text: text.includes("背景")
              ? "現行ベンダーの供給が安定せず、新規比較も含めて相談を始めています。"
              : "ありがとうございます。要件を整理して進めましょう。",
            isFinal: true,
            channel: "chat",
            sdkMessageId: `fake-agent-chat-${generation}-${Date.now()}`,
          },
          generation
        );
      }, 120);
      return Promise.resolve();
    },
    setMuted(nextMuted) {
      muted = nextMuted;
      muteCallCount += 1;
      window.dispatchEvent(
        new CustomEvent("roleplay:fake-live-mute", {
          detail: { muted, muteCallCount },
        })
      );
      return Promise.resolve();
    },
    getInputVolume() {
      return muted ? 0 : 0.32;
    },
    getOutputVolume() {
      return 0.56;
    },
    getMuteCallCount() {
      return muteCallCount;
    },
  };
}
