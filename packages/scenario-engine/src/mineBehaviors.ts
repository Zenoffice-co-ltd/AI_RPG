import type {
  TranscriptBehaviorExtraction,
  TranscriptRecord,
} from "@top-performer/domain";
import { PLAYBOOK_PROMPT_VERSION } from "@top-performer/domain";
import type { OpenAiResponsesClient } from "@top-performer/vendors";
import { loadPromptAsset } from "@top-performer/scoring";
import {
  transcriptBehaviorExtractionJsonSchema,
  transcriptBehaviorExtractionResponseSchema,
} from "@top-performer/scoring";

export async function mineTranscriptBehaviors(input: {
  client: OpenAiResponsesClient;
  model: string;
  transcript: TranscriptRecord;
}): Promise<TranscriptBehaviorExtraction> {
  const prompt = await loadPromptAsset("extract-behaviors.md");

  return input.client.createStructuredOutput({
    model: input.model,
    schemaName: "transcript_behavior_extraction",
    jsonSchema: transcriptBehaviorExtractionJsonSchema,
    responseSchema: transcriptBehaviorExtractionResponseSchema,
    systemPrompt: prompt,
    userPrompt: JSON.stringify(
      {
        promptVersion: PLAYBOOK_PROMPT_VERSION,
        transcript: input.transcript,
      },
      null,
      2
    ),
  });
}
