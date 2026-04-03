"use client";

import { useEffect, useMemo, useState } from "react";

type ResultPayload = {
  sessionId: string;
  status: string;
  scorecard?: {
    overallScore: number;
    topPerformerAlignmentScore: number;
    summary: string;
    strengths: string[];
    misses: string[];
    missedQuestions: string[];
    nextDrills: string[];
    rubricScores: Array<{
      key: string;
      label: string;
      score: number;
      rationale: string;
      evidenceTurnIds: string[];
    }>;
    mustCaptureResults: Array<{
      key: string;
      label: string;
      status: "captured" | "partial" | "missed";
      evidenceTurnIds: string[];
    }>;
  };
};

function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-[1.2rem] bg-white/75 px-4 py-3 text-sm leading-7 text-slate-500">
      {text}
    </p>
  );
}

export function ResultClient({ sessionId }: { sessionId: string }) {
  const [result, setResult] = useState<ResultPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchResult = async () => {
      try {
        const response = await fetch(`/api/results/${sessionId}`);
        const payload = (await response.json()) as ResultPayload;
        if (cancelled) {
          return;
        }
        setResult(payload);

        if (payload.status !== "completed") {
          window.setTimeout(() => {
            void fetchResult();
          }, 2200);
        }
      } catch (fetchError) {
        setError(
          fetchError instanceof Error ? fetchError.message : "結果取得に失敗しました"
        );
      }
    };

    void fetchResult();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const coverageSummary = useMemo(() => {
    if (!result?.scorecard) {
      return { captured: 0, total: 0 };
    }
    return {
      captured: result.scorecard.mustCaptureResults.filter(
        (item) => item.status === "captured"
      ).length,
      total: result.scorecard.mustCaptureResults.length,
    };
  }, [result]);

  if (error) {
    return (
      <div className="glass-panel p-6 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!result || !result.scorecard) {
    return (
      <div className="glass-panel p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
          Analyzing
        </p>
        <h2 className="mt-3 text-2xl font-bold text-slate-950">
          トップ基準との差分を計算しています
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          transcript と scenario pack、playbook norms を照合しながら scorecard を生成しています。
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <section className="glass-panel grid gap-5 p-6 md:grid-cols-[0.45fr_0.55fr]">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="soft-card">
            <span className="metric-label">Overall Score</span>
            <strong className="metric-value text-4xl">
              {result.scorecard.overallScore}
            </strong>
          </div>
          <div className="soft-card">
            <span className="metric-label">Top Alignment</span>
            <strong className="metric-value text-4xl">
              {result.scorecard.topPerformerAlignmentScore}
            </strong>
          </div>
          <div className="soft-card">
            <span className="metric-label">Must Capture</span>
            <strong className="metric-value text-3xl">
              {coverageSummary.captured}/{coverageSummary.total}
            </strong>
          </div>
          <div className="soft-card">
            <span className="metric-label">Session</span>
            <strong className="metric-value text-base">{sessionId}</strong>
          </div>
        </div>
        <div className="rounded-[1.75rem] border border-white/70 bg-slate-950 p-5 text-white">
          <p className="text-xs uppercase tracking-[0.24em] text-sky-200">
            Summary
          </p>
          <p className="mt-3 text-base leading-8">{result.scorecard.summary}</p>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="glass-panel p-6">
          <h2 className="text-lg font-bold text-slate-950">Must Capture Coverage</h2>
          <div className="mt-4 grid gap-3">
            {result.scorecard.mustCaptureResults.length === 0 ? (
              <EmptyState text="must-capture 判定はまだありません。" />
            ) : (
              result.scorecard.mustCaptureResults.map((item) => (
                <div
                  key={item.key}
                  className="rounded-[1.2rem] border border-white/70 bg-white/80 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-900">{item.label}</span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        item.status === "captured"
                          ? "bg-emerald-100 text-emerald-700"
                          : item.status === "partial"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Evidence:{" "}
                    {item.evidenceTurnIds.length > 0
                      ? item.evidenceTurnIds.join(", ")
                      : "該当 turn なし"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="glass-panel p-6">
          <h2 className="text-lg font-bold text-slate-950">Rubric Breakdown</h2>
          <div className="mt-4 grid gap-3">
            {result.scorecard.rubricScores.length === 0 ? (
              <EmptyState text="rubric breakdown はまだありません。" />
            ) : (
              result.scorecard.rubricScores.map((rubric) => (
                <div
                  key={rubric.key}
                  className="rounded-[1.2rem] border border-white/70 bg-white/80 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-slate-900">{rubric.label}</span>
                    <span className="text-sm font-bold text-slate-900">
                      {rubric.score}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {rubric.rationale}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Evidence:{" "}
                    {rubric.evidenceTurnIds.length > 0
                      ? rubric.evidenceTurnIds.join(", ")
                      : "該当 turn なし"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-4">
        <div className="glass-panel p-6">
          <h2 className="text-lg font-bold text-slate-950">Strengths</h2>
          {result.scorecard.strengths.length === 0 ? (
            <div className="mt-4">
              <EmptyState text="strengths はまだありません。" />
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
              {result.scorecard.strengths.map((item) => (
                <li
                  key={item}
                  className="rounded-[1.2rem] bg-white/80 px-4 py-3"
                >
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="glass-panel p-6">
          <h2 className="text-lg font-bold text-slate-950">Misses</h2>
          {result.scorecard.misses.length === 0 ? (
            <div className="mt-4">
              <EmptyState text="top 基準との差分 miss はまだありません。" />
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
              {result.scorecard.misses.map((item) => (
                <li
                  key={item}
                  className="rounded-[1.2rem] bg-white/80 px-4 py-3"
                >
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="glass-panel p-6">
          <h2 className="text-lg font-bold text-slate-950">Missed Questions</h2>
          {result.scorecard.missedQuestions.length === 0 ? (
            <div className="mt-4">
              <EmptyState text="次に聞くべき質問はまだありません。" />
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
              {result.scorecard.missedQuestions.map((item) => (
                <li
                  key={item}
                  className="rounded-[1.2rem] bg-white/80 px-4 py-3"
                >
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="glass-panel p-6">
          <h2 className="text-lg font-bold text-slate-950">Next Drills</h2>
          {result.scorecard.nextDrills.length === 0 ? (
            <div className="mt-4">
              <EmptyState text="next drill はまだありません。" />
            </div>
          ) : (
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-slate-600">
              {result.scorecard.nextDrills.map((item) => (
                <li
                  key={item}
                  className="rounded-[1.2rem] bg-white/80 px-4 py-3"
                >
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
