"use client";

import type { NegativeGuardDecision } from "./types";

export const TAIL_GUARD_NORMAL_HOLD_MS = 300;
export const TAIL_GUARD_RISK_HOLD_MS = 800;
export const TAIL_GUARD_MAX_HOLD_MS = 1000;
export const FULL_TURN_BUFFER_FORBIDDEN = true;
export const REPLACEMENT_TTS_FORBIDDEN = true;

export type TailGuardChunk = {
  base64: string;
  bytes: number;
  durationMs: number;
};

export type TailGuardRelease = {
  chunks: TailGuardChunk[];
  droppedBytes: number;
};

export class TailOnlyAudioGuard {
  private held: TailGuardChunk[] = [];
  private heldDurationMs = 0;
  private droppedBytes = 0;
  private maxObservedHoldMs = 0;

  push(base64: string, holdMs: number): TailGuardRelease {
    const chunk = toChunk(base64);
    this.held.push(chunk);
    this.heldDurationMs += chunk.durationMs;
    this.maxObservedHoldMs = Math.max(
      this.maxObservedHoldMs,
      Math.min(this.heldDurationMs, TAIL_GUARD_MAX_HOLD_MS)
    );

    const release: TailGuardChunk[] = [];
    const boundedHoldMs = Math.min(Math.max(0, holdMs), TAIL_GUARD_MAX_HOLD_MS);
    while (this.heldDurationMs > boundedHoldMs && this.held.length > 1) {
      const next = this.held.shift();
      if (!next) break;
      this.heldDurationMs -= next.durationMs;
      release.push(next);
    }
    return { chunks: release, droppedBytes: 0 };
  }

  finalize(decision: NegativeGuardDecision): TailGuardRelease {
    if (
      decision.action === "strip_tail" ||
      decision.action === "drop_sentence" ||
      decision.action === "cancel" ||
      decision.action === "suppress"
    ) {
      const dropped = this.held.reduce((sum, chunk) => sum + chunk.bytes, 0);
      this.droppedBytes += dropped;
      this.held = [];
      this.heldDurationMs = 0;
      return { chunks: [], droppedBytes: dropped };
    }
    const chunks = this.held;
    this.held = [];
    this.heldDurationMs = 0;
    return { chunks, droppedBytes: 0 };
  }

  clear(): TailGuardRelease {
    const dropped = this.held.reduce((sum, chunk) => sum + chunk.bytes, 0);
    this.droppedBytes += dropped;
    this.held = [];
    this.heldDurationMs = 0;
    return { chunks: [], droppedBytes: dropped };
  }

  getDroppedBytes(): number {
    return this.droppedBytes;
  }

  getMaxObservedHoldMs(): number {
    return Math.min(this.maxObservedHoldMs, TAIL_GUARD_MAX_HOLD_MS);
  }
}

export function selectTailHoldMs(input: { risky: boolean }): 300 | 800 {
  return input.risky ? TAIL_GUARD_RISK_HOLD_MS : TAIL_GUARD_NORMAL_HOLD_MS;
}

function toChunk(base64: string): TailGuardChunk {
  const bytes = Math.floor((base64.length * 3) / 4);
  return {
    base64,
    bytes,
    durationMs: Math.round((bytes / 2 / 24_000) * 1000),
  };
}
