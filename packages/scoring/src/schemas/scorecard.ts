import { scorecardSchema } from "@top-performer/domain";
import { z } from "zod";

export const gradeSessionResponseSchema = scorecardSchema.omit({
  sessionId: true,
  scenarioId: true,
  nextDrills: true,
  generatedAt: true,
  promptVersion: true,
  evaluationMode: true,
  qualitySignals: true,
  evaluationBreakdown: true,
});
export const gradeSessionJsonSchema = z.toJSONSchema(gradeSessionResponseSchema);
