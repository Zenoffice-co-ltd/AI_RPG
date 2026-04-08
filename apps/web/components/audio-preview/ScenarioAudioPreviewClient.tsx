"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ScenarioAudioPreviewData } from "@/server/use-cases/audioPreview";

export function ScenarioAudioPreviewClient({
  preview,
}: {
  preview: ScenarioAudioPreviewData;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string>(
    `/api/audio-preview/${preview.scenarioId}?sample=opening`
  );
  const [activeKey, setActiveKey] = useState<string>("opening");
  const [customText, setCustomText] = useState<string>(preview.samples[0]?.text ?? "");
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!audioRef.current || !audioSrc) {
      return;
    }

    audioRef.current.load();
    void audioRef.current.play().catch(() => {
      // Ignore autoplay rejections. Controls remain available.
    });
  }, [audioSrc]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  function handlePlaySample(key: string, text: string) {
    setError(null);
    setActiveKey(key);
    setCustomText(text);
    setAudioSrc(`/api/audio-preview/${preview.scenarioId}?sample=${encodeURIComponent(key)}`);
  }

  async function handleRenderCustom() {
    const text = customText.trim();
    if (!text) {
      setError("再生したい文面を入力してください。");
      return;
    }

    setIsRendering(true);
    setError(null);

    try {
      const response = await fetch(`/api/audio-preview/${preview.scenarioId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const raw: unknown = await response.json().catch(() => ({}));
        const message =
          typeof raw === "object" && raw && "error" in raw
            ? String(raw.error)
            : "音声の生成に失敗しました。";
        throw new Error(message);
      }

      const blob = await response.blob();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      objectUrlRef.current = URL.createObjectURL(blob);
      setActiveKey("custom");
      setAudioSrc(objectUrlRef.current);
    } catch (renderError) {
      setError(
        renderError instanceof Error ? renderError.message : "音声の生成に失敗しました。"
      );
    } finally {
      setIsRendering(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden px-5 py-6 md:px-8 lg:px-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header className="glass-panel flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
              Audio Preview
            </p>
            <h1 className="mt-2 text-3xl font-extrabold text-slate-950 md:text-4xl">
              {preview.title}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 md:text-base">
              {preview.publicBrief}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/roleplay/${preview.scenarioId}`}
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              ロープレ画面へ
            </Link>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="glass-panel p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                {preview.voiceMode === "profile" ? "Voice Profile" : "Legacy Voice"}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {preview.voiceLabel}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {preview.voiceName}
              </span>
              {preview.voiceProfileId ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {preview.voiceProfileId}
                </span>
              ) : null}
            </div>

            <div className="mt-5 rounded-[1.8rem] border border-white/70 bg-white/70 p-5 shadow-[0_18px_44px_rgba(15,23,42,0.08)]">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-950">音声だけ確認</h2>
                  <p className="mt-1 text-sm leading-7 text-slate-600">
                    サンプル文を選ぶか、任意の文面を流してシナリオ音声だけを確認できます。
                  </p>
                </div>
                <span className="rounded-full bg-slate-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
                  {activeKey === "custom" ? "Custom" : activeKey}
                </span>
              </div>

              <audio
                ref={audioRef}
                controls
                preload="none"
                className="mt-5 w-full"
              >
                <source src={audioSrc} type="audio/mpeg" />
              </audio>

              {error ? (
                <div className="mt-4 rounded-[1rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <div className="glass-panel p-6">
            <h2 className="text-lg font-bold text-slate-950">サンプル文</h2>
            <div className="mt-4 flex flex-col gap-3">
              {preview.samples.map((sample) => (
                <button
                  key={sample.key}
                  type="button"
                  onClick={() => handlePlaySample(sample.key, sample.text)}
                  className={cn(
                    "rounded-[1.4rem] border px-4 py-4 text-left transition",
                    activeKey === sample.key
                      ? "border-sky-300 bg-sky-50 shadow-[0_16px_36px_rgba(14,165,233,0.16)]"
                      : "border-white/70 bg-white/75 hover:border-slate-200"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-slate-950">{sample.label}</strong>
                    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                      Play
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-6 text-slate-500">
                    {sample.description}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">{sample.text}</p>
                </button>
              ))}
            </div>

            <div className="mt-5 rounded-[1.4rem] border border-white/70 bg-white/75 p-4">
              <label className="text-sm font-semibold text-slate-900" htmlFor="custom-text">
                任意の文面
              </label>
              <textarea
                id="custom-text"
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                rows={6}
                maxLength={500}
                className="mt-3 w-full rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-800 outline-none transition focus:border-sky-400"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-500">最大 500 文字まで音声確認できます。</p>
                <button
                  type="button"
                  onClick={() => {
                    void handleRenderCustom();
                  }}
                  disabled={isRendering}
                  className="rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isRendering ? "生成中..." : "この文面で再生"}
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
