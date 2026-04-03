import { RoleplayClient } from "@/components/roleplay/RoleplayClient";
import { getScenarioById } from "@/server/use-cases/scenarios";

export const dynamic = "force-dynamic";

export default async function RoleplayPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params;
  const scenario = await getScenarioById(scenarioId);

  return (
    <RoleplayClient
      scenario={{
        id: scenarioId,
        title: scenario?.title ?? "Roleplay Scenario",
        difficulty: scenario?.difficulty ?? "medium",
        openingLine:
          scenario?.openingLine ??
          "本日はありがとうございます。まず今回の募集背景からご相談させてください。",
        publicBrief:
          scenario?.publicBrief ??
          "トップ基準との差分を測るオーダーヒアリング用シナリオです。",
      }}
    />
  );
}
