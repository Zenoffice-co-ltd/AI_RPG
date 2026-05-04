// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  useHaikuFishConversation,
  type UseHaikuFishConversationDeps,
} from "../../lib/roleplay/useHaikuFishConversation";
import type { streamHaikuFishRespond } from "../../lib/roleplay/haiku-fish-client";
import type {
  HaikuFishSession,
  HaikuFishSseEvent,
} from "../../lib/roleplay/haiku-fish-types";
import { HaikuFishAudioQueue } from "../../lib/roleplay/haiku-fish-audio-queue";

const SESSION: HaikuFishSession = {
  sessionId: "hf_sess_test",
  scenarioId: "staffing_order_hearing_adecco_manufacturer_busy_manager_medium",
  backend: "claude-haiku-fish",
  promptVersion: "v1",
  firstMessage: "お時間ありがとうございます。",
};

function buildScriptedStream(events: HaikuFishSseEvent[]) {
  return async function* scripted() {
    for (const evt of events) {
      yield evt;
    }
  };
}

function buildStubAudioQueue() {
  // We construct a HaikuFishAudioQueue with a mocked AudioContext so we don't
  // need a real Web Audio implementation in jsdom.
  return new HaikuFishAudioQueue({
    createAudioContext: () =>
      ({
        state: "running" as AudioContextState,
        currentTime: 0,
        destination: {} as AudioDestinationNode,
        createBufferSource: () => ({
          buffer: null,
          connect: () => undefined,
          start: () => undefined,
          onended: null,
        }),
        createGain: () => ({ gain: { value: 1 }, connect: () => undefined }) as unknown as GainNode,
        decodeAudioData: async () => ({ duration: 0.1 } as AudioBuffer),
        resume: async () => undefined,
        close: async () => undefined,
      }) as unknown as AudioContext,
  });
}

describe("useHaikuFishConversation", () => {
  it("loads first message on startConversation and applies streamed events to transcript", async () => {
    const fetchSession = vi.fn(async () => SESSION);
    const streamRespond = vi.fn(
      buildScriptedStream([
        { event: "status", data: { status: "thinking" } },
        { event: "agent_text_delta", data: { text: "はい、" } },
        { event: "agent_text_delta", data: { text: "営業事務一名を" } },
        { event: "agent_first_sentence", data: { text: "はい、営業事務一名を。" } },
        {
          event: "audio_chunk",
          data: {
            format: "wav",
            sampleRateHz: 24_000,
            base64: Buffer.from("audio").toString("base64"),
          },
        },
        { event: "agent_text_final", data: { text: "はい、営業事務一名をお願いします。" } },
        {
          event: "metrics",
          data: {
            sessionId: SESSION.sessionId,
            turnIndex: 0,
            inputMode: "text",
            userTextLength: 10,
            llmFirstTokenMs: 50,
            llmFirstSentenceMs: 200,
            llmDoneMs: 600,
            ttsFirstAudioMs: 300,
            ttsDoneMs: 800,
            e2eFirstAudioMs: 350,
            e2eDoneMs: 900,
            sttFirstPartialMs: null,
            sttFinalMs: null,
            responseText: "はい、営業事務一名をお願いします。",
            audioBytes: 5,
            error: null,
          },
        },
        { event: "done", data: {} },
      ])
    );
    const deps: UseHaikuFishConversationDeps = {
      fetchSession,
      streamRespond: streamRespond as unknown as typeof streamHaikuFishRespond,
      createAudioQueue: () => buildStubAudioQueue(),
    };

    const { result } = renderHook(() => useHaikuFishConversation("live", deps));

    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.startConversation();
    });
    expect(fetchSession).toHaveBeenCalled();
    expect(result.current.session?.sessionId).toBe(SESSION.sessionId);
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe("agent");
    expect(result.current.messages[0]?.text).toContain("お時間ありがとうございます");

    await act(async () => {
      await result.current.sendTextMessage("募集背景を教えてください");
    });

    await waitFor(() => {
      expect(result.current.metricsLog).toHaveLength(1);
    });

    const userMessages = result.current.messages.filter((m) => m.role === "user");
    const agentMessages = result.current.messages.filter((m) => m.role === "agent");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.text).toBe("募集背景を教えてください");
    // Greeting + new agent reply.
    expect(agentMessages.length).toBeGreaterThanOrEqual(2);
    const finalAgent = agentMessages.find((m) => m.text.includes("お願いします"));
    expect(finalAgent?.status).toBe("final");

    expect(result.current.metricsLog[0]?.llmFirstSentenceMs).toBe(200);
  });

  it("ignores sendTextMessage when mode is not live", async () => {
    const fetchSession = vi.fn();
    const streamRespond = vi.fn();
    const deps: UseHaikuFishConversationDeps = {
      fetchSession: fetchSession as unknown as () => Promise<HaikuFishSession>,
      streamRespond: streamRespond as unknown as typeof streamHaikuFishRespond,
      createAudioQueue: () => buildStubAudioQueue(),
    };
    const { result } = renderHook(() => useHaikuFishConversation("mock", deps));
    await act(async () => {
      await result.current.sendTextMessage("hi");
    });
    expect(fetchSession).not.toHaveBeenCalled();
    expect(streamRespond).not.toHaveBeenCalled();
  });
});
