import { notFound } from "next/navigation";
import { ScenarioVoiceTestClient } from "@/components/scenario-voice-test/ScenarioVoiceTestClient";
import { getScenarioTestSetup } from "@/server/use-cases/scenarioTest";

export const dynamic = "force-dynamic";

export default async function ScenarioVoiceTestPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params;
  const setup = await getScenarioTestSetup(scenarioId);

  if (!setup) {
    notFound();
  }

  return (
    <ScenarioVoiceTestClient
      scenarioId={scenarioId}
      title={setup.scenario.title}
      publicBrief={setup.scenario.publicBrief}
      openingLine={setup.openingLine}
    />
  );
}
