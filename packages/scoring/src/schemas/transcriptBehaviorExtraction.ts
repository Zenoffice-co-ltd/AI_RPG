import { transcriptBehaviorExtractionSchema } from "@top-performer/domain";
import { z } from "zod";

export const transcriptBehaviorExtractionResponseSchema =
  transcriptBehaviorExtractionSchema;

export const transcriptBehaviorExtractionJsonSchema = z.toJSONSchema(
  transcriptBehaviorExtractionResponseSchema
);
