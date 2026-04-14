"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { Room, RoomEvent, Track } from "livekit-client";
import { cn } from "@/lib/utils";

type ScenarioDetails = {
  id: string;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  openingLine: string;
  publicBrief: string;
};

type TranscriptTurn = {
  turnId: string;
  role: "user" | "avatar";
  text: string;
  relativeTimestamp: number;
};

type SessionState = {
  sessionId: string;
  liveavatarSessionId: string;
  roomUrl: string;
  roomToken: string;
};

export function RoleplayClient({ scenario }: { scenario: ScenarioDetails }) {
  const [session, setSession] = useState<SessionState | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [cursor, setCursor] = useState(0);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localPreviewRef = useRef<HTMLVideoElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!session) {
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;

    const connectRoom = async () => {
      try {
        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (!remoteVideoRef.current) {
            return;
          }

          if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) {
            track.attach(remoteVideoRef.current);
          }
        });

        await room.connect(session.roomUrl, session.roomToken);
        await room.localParticipant.setMicrophoneEnabled(micOn);
        await room.localParticipant.setCameraEnabled(cameraOn);
      } catch (connectError) {
        if (!cancelled) {
          setError(
            connectError instanceof Error
              ? connectError.message
              : "LiveKit 接続に失敗しました"
          );
        }
      }
    };

    void connectRoom();

    return () => {
      cancelled = true;
      void roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, [cameraOn, micOn, session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/sessions/${session.sessionId}/transcript?cursor=${cursor}`
          );
          const raw: unknown = await response.json();
          const data = raw as {
            cursor: number;
            turns: TranscriptTurn[];
          };
          setTurns((current) => {
            const merged = new Map(current.map((turn) => [turn.turnId, turn]));
            for (const turn of data.turns) {
              merged.set(turn.turnId, turn);
            }
            return [...merged.values()].sort(
              (left, right) => left.relativeTimestamp - right.relativeTimestamp
            );
          });
          setCursor(data.cursor);
        } catch (pollError) {
          setError(
            pollError instanceof Error
              ? pollError.message
              : "transcript 取得に失敗しました"
          );
        }
      })();
    }, 1300);

    return () => {
      window.clearInterval(interval);
    };
  }, [cursor, session]);

  useEffect(() => {
    if (!cameraOn) {
      localPreviewRef.current?.pause();
      if (localPreviewRef.current) {
        localPreviewRef.current.srcObject = null;
      }
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      return;
    }

    let cancelled = false;
    const startPreview = async () => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      localStreamRef.current = stream;
      if (localPreviewRef.current) {
        localPreviewRef.current.srcObject = stream;
        await localPreviewRef.current.play();
      }
    };

    void startPreview().catch((previewError) => {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "カメラプレビューを開始できませんでした"
      );
      setCameraOn(false);
    });

    return () => {
      cancelled = true;
    };
  }, [cameraOn]);

  const latestTurnId = turns.at(-1)?.turnId;
  const audioPreviewHref =
    scenario.id === "staffing_order_hearing_busy_manager_medium"
      ? ("/audio-preview/staffing_order_hearing_busy_manager_medium.html" as Route)
      : (`/audio-preview/${scenario.id}` as Route);
  const elapsedLabel = useMemo(() => {
    const minutes = Math.floor(elapsedSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (elapsedSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [elapsedSeconds]);

  async function handleStart() {
    setIsStarting(true);
    setError(null);

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: scenario.id,
        }),
      });
      const data = (await response.json()) as SessionState;
      if (!response.ok) {
        throw new Error("error" in data ? String(data.error) : "セッション開始に失敗しました");
      }
      setSession(data);
      setTurns([
        {
          turnId: "opening_line",
          role: "avatar",
          text: scenario.openingLine,
          relativeTimestamp: 0,
        },
      ]);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "セッション開始に失敗しました"
      );
    } finally {
      setIsStarting(false);
    }
  }

  async function handleEnd() {
    if (!session) {
      return;
    }

    setIsEnding(true);
    try {
      await fetch(`/api/sessions/${session.sessionId}/end`, {
        method: "POST",
      });
      window.location.href = `/result/${session.sessionId}`;
    } catch (endError) {
      setError(
        endError instanceof Error ? endError.message : "セッション終了に失敗しました"
      );
      setIsEnding(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden px-5 py-6 md:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="glass-panel flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
              Roleplay Session
            </p>
            <h1 className="mt-2 text-3xl font-extrabold text-slate-950 md:text-4xl">
              {scenario.title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 md:text-base">
              {scenario.publicBrief}
            </p>
            <div className="mt-4">
              <div className="flex flex-wrap gap-2">
                <Link
                  href={(`/scenario-voice-test/${scenario.id}`) as Route}
                  className="inline-flex rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
                >
                  ボイス会話テスト
                </Link>
                <Link
                  href={(`/scenario-test/${scenario.id}`) as Route}
                  className="inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  テキスト会話テスト
                </Link>
                <Link
                  href={audioPreviewHref}
                  className="inline-flex rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                >
                  音声だけ確認する
                </Link>
              </div>
            </div>
          </div>
          <div className="rounded-[1.6rem] border border-white/70 bg-white/75 px-5 py-4 text-right shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Elapsed
            </div>
            <div className="mt-2 text-3xl font-extrabold text-slate-900">
              {elapsedLabel}
            </div>
          </div>
        </header>

        <section className="grid min-h-[72vh] gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="glass-panel relative overflow-hidden p-5 md:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_16%,rgba(255,255,255,0.75),transparent_25%),radial-gradient(circle_at_76%_10%,rgba(14,165,233,0.18),transparent_22%),radial-gradient(circle_at_80%_88%,rgba(15,23,42,0.08),transparent_24%)]" />
            <div className="relative grid h-full gap-4 lg:grid-cols-[1fr_0.44fr]">
              <div className="rounded-[2rem] border border-white/70 bg-white/60 p-4 shadow-[0_30px_60px_rgba(15,23,42,0.12)] backdrop-blur">
                <div className="relative flex h-full min-h-[34rem] items-center justify-center overflow-hidden rounded-[1.8rem] bg-[linear-gradient(180deg,#edf6ff_0%,#ceddea_100%)]">
                  <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="h-full w-full object-cover"
                  />
                  {!session ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.55),rgba(255,255,255,0.18)_40%,transparent_75%)] px-8 text-center">
                      <div className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-white">
                        Ready
                      </div>
                      <h2 className="text-2xl font-bold text-slate-900">
                        アバター会話を開始できます
                      </h2>
                      <p className="max-w-xl text-sm leading-7 text-slate-600">
                        開始後は LiveAvatar remote video と transcript bubble を同時に更新し、
                        終了後にトップ基準との差分 scorecard を返します。
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void handleStart();
                        }}
                        disabled={isStarting}
                        className="rounded-full bg-sky-600 px-7 py-3 text-sm font-semibold text-white shadow-[0_18px_30px_rgba(2,132,199,0.32)] transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isStarting ? "開始中..." : "このシナリオで開始"}
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setMicOn((current) => !current)}
                    className={cn(
                      "rounded-full px-5 py-3 text-sm font-semibold transition",
                      micOn
                        ? "bg-slate-950 text-white"
                        : "bg-white text-slate-700"
                    )}
                  >
                    {micOn ? "Mic ON" : "Mic OFF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCameraOn((current) => !current)}
                    className={cn(
                      "rounded-full px-5 py-3 text-sm font-semibold transition",
                      cameraOn
                        ? "bg-slate-950 text-white"
                        : "bg-white text-slate-700"
                    )}
                  >
                    {cameraOn ? "Camera ON" : "Camera OFF"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleEnd();
                    }}
                    disabled={!session || isEnding}
                    className="rounded-full bg-rose-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isEnding ? "終了処理中..." : "End"}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-[1.75rem] border border-white/70 bg-white/76 p-4 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
                  <div className="mb-3 flex items-center justify-between">
                    <strong className="text-sm text-slate-900">あなた</strong>
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Preview
                    </span>
                  </div>
                  <div className="aspect-video overflow-hidden rounded-[1.3rem] bg-slate-100">
                    {cameraOn ? (
                      <video
                        ref={localPreviewRef}
                        autoPlay
                        playsInline
                        muted
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] text-sm font-semibold text-slate-500">
                        カメラはオフです
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex min-h-[26rem] flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/78 p-4 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
                  <div className="mb-3 flex items-center justify-between">
                    <strong className="text-sm text-slate-900">Live Transcript</strong>
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-[11px] font-semibold text-sky-700">
                      cursor {cursor}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-1">
                    {turns.map((turn) => (
                      <article
                        key={turn.turnId}
                        className={cn(
                          "max-w-[90%] rounded-[1.4rem] px-4 py-3 text-sm leading-7 shadow-[0_14px_32px_rgba(15,23,42,0.08)]",
                          turn.role === "user"
                            ? "self-end rounded-br-md bg-slate-950 text-white"
                            : "self-start rounded-bl-md bg-slate-100 text-slate-700",
                          latestTurnId === turn.turnId && "ring-2 ring-sky-300"
                        )}
                      >
                        {turn.text}
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="glass-panel border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>
    </main>
  );
}
