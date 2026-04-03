"use client";

import { useState } from "react";

export function AdminActionCard({
  title,
  description,
  endpoint,
  payload,
  buttonLabel,
}: {
  title: string;
  description: string;
  endpoint: string;
  payload: Record<string, unknown>;
  buttonLabel: string;
}) {
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function handleAction() {
    setLoading(true);
    setResult("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data: unknown = await response.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass-panel p-6">
      <h2 className="text-lg font-bold text-slate-950">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>
      <pre className="mt-4 overflow-x-auto rounded-[1.2rem] bg-slate-950 p-4 text-xs text-slate-100">
        {JSON.stringify(payload, null, 2)}
      </pre>
      <button
        type="button"
        onClick={() => {
          void handleAction();
        }}
        disabled={loading}
        className="mt-4 rounded-full bg-sky-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:opacity-60"
      >
        {loading ? "実行中..." : buttonLabel}
      </button>
      {result ? (
        <pre className="mt-4 overflow-x-auto rounded-[1.2rem] bg-white/80 p-4 text-xs text-slate-700">
          {result}
        </pre>
      ) : null}
    </section>
  );
}
