import { notFound } from "next/navigation";
import { ScenarioTestClient } from "@/components/scenario-test/ScenarioTestClient";
import { getScenarioTestSetup } from "@/server/use-cases/scenarioTest";

export const dynamic = "force-dynamic";

export default async function ScenarioTestPage({
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
    <ScenarioTestClient
      scenarioId={scenarioId}
      title={setup.scenario.title}
      publicBrief={setup.scenario.publicBrief}
      openingLine={setup.openingLine}
    />
  );
}
