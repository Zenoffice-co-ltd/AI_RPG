import { scorecardSchema } from "@top-performer/domain";
import { z } from "zod";

export const gradeSessionResponseSchema = scorecardSchema;
export const gradeSessionJsonSchema = z.toJSONSchema(gradeSessionResponseSchema);
