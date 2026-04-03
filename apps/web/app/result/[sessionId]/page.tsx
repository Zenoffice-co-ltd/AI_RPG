import { ResultClient } from "@/components/results/ResultClient";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  return (
    <main className="min-h-screen px-5 py-6 md:px-8 lg:px-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="glass-panel p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
            Result
          </p>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-950 md:text-4xl">
            トップ基準との差分 scorecard
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            overall score、alignment、must-capture coverage、rubric breakdown、missed questions、next drills を表示します。
          </p>
        </header>
        <ResultClient sessionId={sessionId} />
      </div>
    </main>
  );
}
