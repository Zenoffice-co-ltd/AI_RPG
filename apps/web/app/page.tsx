import { listScenarios } from "../server/use-cases/scenarios";

const difficultyLabel: Record<string, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export default async function HomePage() {
  const scenarioCards = (await listScenarios()).map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    difficulty: difficultyLabel[scenario.difficulty] ?? scenario.difficulty,
    description: scenario.publicBrief,
  }));

  return (
    <main className="min-h-screen overflow-hidden px-6 py-8 md:px-10 lg:px-14">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl flex-col gap-8">
        <header className="glass-panel flex flex-col gap-6 p-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">
              Staffing Sales Order Hearing MVP
            </p>
            <h1 className="max-w-2xl text-4xl font-extrabold tracking-tight text-slate-950 md:text-6xl">
              トップ営業の再現性を、
              <span className="text-sky-700">会話体験</span>
              とスコアで可視化する
            </h1>
            <p className="max-w-2xl text-base leading-8 text-slate-600 md:text-lg">
              transcript から Playbook Norms を抽出し、Scenario / Rubric に変換。
              LiveAvatar と ElevenLabs で自然な相手役を生成し、会話後はトップ基準との差分を evidence 付きで返します。
            </p>
          </div>
            <div className="grid w-full max-w-sm grid-cols-2 gap-4 text-sm md:w-80">
              <div className="soft-card">
                <span className="metric-label">Scenarios</span>
                <strong className="metric-value">{scenarioCards.length}</strong>
              </div>
            <div className="soft-card">
              <span className="metric-label">Transcript SoT</span>
              <strong className="metric-value">LiveAvatar</strong>
            </div>
            <div className="soft-card">
              <span className="metric-label">Scoring</span>
              <strong className="metric-value">OpenAI</strong>
            </div>
            <div className="soft-card">
              <span className="metric-label">Runtime</span>
              <strong className="metric-value">API-first</strong>
            </div>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="glass-panel relative overflow-hidden p-6 md:p-8">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(255,255,255,0.8),transparent_35%),radial-gradient(circle_at_85%_15%,rgba(110,177,255,0.26),transparent_25%),radial-gradient(circle_at_80%_75%,rgba(17,24,39,0.08),transparent_32%)]" />
            <div className="relative z-10 grid gap-6 lg:grid-cols-[0.82fr_1.18fr]">
              <div className="rounded-[2rem] border border-white/65 bg-white/70 p-4 shadow-[0_20px_50px_rgba(15,23,42,0.12)] backdrop-blur">
                <div className="mb-4 rounded-[1.6rem] bg-[linear-gradient(180deg,#edf6ff_0%,#cadff3_100%)] p-4">
                  <div className="aspect-[4/5] rounded-[1.4rem] bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.95),rgba(255,255,255,0.25)_30%,transparent_45%),linear-gradient(180deg,#dbeafe_0%,#cbd5e1_52%,#d8e4ec_100%)] shadow-inner">
                    <div className="flex h-full items-end justify-center p-6">
                      <div className="flex h-4/5 w-4/5 items-center justify-center rounded-[2rem] border border-white/50 bg-white/35 text-center text-sm font-semibold text-slate-600 backdrop-blur-sm">
                        LiveAvatar Remote Video Placeholder
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs text-slate-500">
                  <div className="rounded-2xl bg-slate-950 px-3 py-2 text-center font-medium text-white">
                    Mic
                  </div>
                  <div className="rounded-2xl bg-white px-3 py-2 text-center font-medium text-slate-700">
                    Camera
                  </div>
                  <div className="rounded-2xl bg-rose-500 px-3 py-2 text-center font-medium text-white">
                    End
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-[1.75rem] border border-white/70 bg-white/78 p-5 shadow-[0_18px_44px_rgba(15,23,42,0.09)] backdrop-blur">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-800">
                      セッションの流れ
                    </span>
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                      transcript → scorecard
                    </span>
                  </div>
                  <ol className="grid gap-3 text-sm text-slate-600">
                    <li className="rounded-2xl bg-slate-50 px-4 py-3">
                      1. シナリオを選択し、相手役の persona と hidden facts を runtime へ反映
                    </li>
                    <li className="rounded-2xl bg-slate-50 px-4 py-3">
                      2. 会話中は LiveAvatar transcript を差分取得し、turn ごとに Firestore へ保存
                    </li>
                    <li className="rounded-2xl bg-slate-50 px-4 py-3">
                      3. 終了後 60 秒以内にトップ基準との差分 scorecard を返却
                    </li>
                  </ol>
                </div>
                <div className="rounded-[1.75rem] border border-slate-200/70 bg-slate-950 p-5 text-white shadow-[0_18px_44px_rgba(15,23,42,0.18)]">
                  <p className="text-xs uppercase tracking-[0.24em] text-sky-200">
                    Demo Focus
                  </p>
                  <p className="mt-3 text-lg font-semibold">
                    「何を・いつ・どの深さで聞くか」を、音声体験より上位の設計原則として固定
                  </p>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="glass-panel p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">シナリオ一覧</h2>
                <span className="text-sm font-medium text-slate-500">MVP</span>
              </div>
              <div className="space-y-4">
                {scenarioCards.map((scenario) => (
                  <div
                    key={scenario.id}
                    className="rounded-[1.4rem] border border-white/65 bg-white/85 p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <strong className="text-base text-slate-900">
                        {scenario.title}
                      </strong>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                        {scenario.difficulty}
                      </span>
                    </div>
                    <p className="text-sm leading-7 text-slate-600">
                      {scenario.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <a
                        href={`/roleplay/${scenario.id}`}
                        className="rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white"
                      >
                        ロープレ
                      </a>
                      <a
                        href={`/scenario-test/${scenario.id}`}
                        className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                      >
                        テキスト会話テスト
                      </a>
                      <a
                        href={`/scenario-voice-test/${scenario.id}`}
                        className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
                      >
                        ボイス会話テスト
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-panel p-6">
              <h2 className="text-base font-bold text-slate-900">管理フロー</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                transcript import、playbook build、scenario compile、agent publish を
                `/admin` から順番に操作できる構成で実装します。
              </p>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
