import { notFound } from "next/navigation";
import { ScenarioAudioPreviewClient } from "@/components/audio-preview/ScenarioAudioPreviewClient";
import { getScenarioAudioPreviewData } from "@/server/use-cases/audioPreview";

export const dynamic = "force-dynamic";

export default async function AudioPreviewPage({
  params,
}: {
  params: Promise<{ scenarioId: string }>;
}) {
  const { scenarioId } = await params;
  const preview = await getScenarioAudioPreviewData(scenarioId);

  if (!preview) {
    notFound();
  }

  return <ScenarioAudioPreviewClient preview={preview} />;
}
