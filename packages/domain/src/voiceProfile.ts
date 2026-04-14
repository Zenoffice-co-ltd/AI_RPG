import { z } from "zod";

export const voiceProfileLanguageSchema = z.literal("ja");

export const textNormalisationTypeSchema = z.enum([
  "system_prompt",
  "elevenlabs",
]);

export const voiceVariationSourceSchema = z.enum([
  "workspace",
  "shared",
  "designed",
  "control",
]);

export const voiceVariationGenderSchema = z.enum([
  "female",
  "male",
  "unknown",
]);

export const voiceVariationStageSchema = z.enum([
  "control",
  "inventory",
  "round1",
  "shortlist",
  "finalist",
  "live",
  "primary",
  "fallback",
]);

export const voiceSettingsSchema = z
  .object({
    stability: z.number().min(0).max(1).optional(),
    similarityBoost: z.number().min(0).max(1).optional(),
    speed: z.number().positive().optional(),
    style: z.number().min(0).max(1).optional(),
    useSpeakerBoost: z.boolean().optional(),
  })
  .strict();

export const pronunciationDictionaryLocatorSchema = z
  .object({
    pronunciationDictionaryId: z.string().min(1),
    versionId: z.string().min(1),
  })
  .strict();

export const voiceProfileSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    language: voiceProfileLanguageSchema,
    model: z.string().min(1),
    voiceId: z.string().min(1),
    firstMessageJa: z.string().min(1).optional(),
    textNormalisationType: textNormalisationTypeSchema,
    voiceSettings: voiceSettingsSchema,
    pronunciationDictionaryLocators: z
      .array(pronunciationDictionaryLocatorSchema)
      .max(3)
      .optional(),
    metadata: z
      .object({
        personaKey: z.string().min(1).optional(),
        scenarioIds: z.array(z.string().min(1)).optional(),
        benchmarkStatus: z
          .enum(["candidate", "approved", "deprecated"])
          .optional(),
        candidateId: z.string().min(1).optional(),
        source: voiceVariationSourceSchema.optional(),
        gender: voiceVariationGenderSchema.optional(),
        voiceName: z.string().min(1).optional(),
        cohortId: z.string().min(1).optional(),
        stage: voiceVariationStageSchema.optional(),
        controlGroup: z.boolean().optional(),
        rescueFallback: z.boolean().optional(),
        notes: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const voiceVariationCandidateSchema = z
  .object({
    candidateId: z.string().min(1),
    profileId: z.string().min(1),
    source: voiceVariationSourceSchema,
    gender: voiceVariationGenderSchema,
    voiceId: z.string().min(1),
    voiceName: z.string().min(1),
    stage: voiceVariationStageSchema,
    controlGroup: z.boolean().default(false),
    finalist: z.boolean().default(false),
    liveCandidate: z.boolean().default(false),
    rescueFallback: z.boolean().optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const voiceVariationCohortSchema = z
  .object({
    id: z.string().min(1).optional(),
    cohortId: z.string().min(1).optional(),
    scenarioId: z.string().min(1),
    personaKey: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    language: voiceProfileLanguageSchema.optional(),
    firstMessageJa: z.string().min(1).optional(),
    textNormalisationType: textNormalisationTypeSchema.optional(),
    voiceSettings: voiceSettingsSchema.optional(),
    controlProfileIds: z.array(z.string().min(1)),
    candidates: z.array(voiceVariationCandidateSchema),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.id && !value.cohortId) {
      ctx.addIssue({
        code: "custom",
        path: ["id"],
        message: "Either id or cohortId is required.",
      });
    }
  })
  .transform((value) => ({
    id: value.id ?? value.cohortId!,
    cohortId: value.cohortId ?? value.id!,
    scenarioId: value.scenarioId,
    ...(value.personaKey ? { personaKey: value.personaKey } : {}),
    ...(value.model ? { model: value.model } : {}),
    ...(value.language ? { language: value.language } : {}),
    ...(value.firstMessageJa ? { firstMessageJa: value.firstMessageJa } : {}),
    ...(value.textNormalisationType
      ? { textNormalisationType: value.textNormalisationType }
      : {}),
    ...(value.voiceSettings ? { voiceSettings: value.voiceSettings } : {}),
    controlProfileIds: value.controlProfileIds,
    candidates: value.candidates,
  }));

export const scenarioVoiceProfileMapSchema = z
  .object({
    activeProfiles: z.record(z.string().min(1), z.string().min(1)),
    previewProfiles: z
      .record(z.string().min(1), z.string().min(1))
      .default({}),
    benchmarkProfiles: z
      .record(z.string().min(1), z.string().min(1))
      .default({}),
  })
  .strict();

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;
export type PronunciationDictionaryLocator = z.infer<
  typeof pronunciationDictionaryLocatorSchema
>;
export type VoiceVariationSource = z.infer<typeof voiceVariationSourceSchema>;
export type VoiceVariationGender = z.infer<typeof voiceVariationGenderSchema>;
export type VoiceVariationStage = z.infer<typeof voiceVariationStageSchema>;
export type TextNormalisationType = z.infer<
  typeof textNormalisationTypeSchema
>;
export type VoiceProfile = z.infer<typeof voiceProfileSchema>;
export type ScenarioVoiceProfileMap = z.infer<
  typeof scenarioVoiceProfileMapSchema
>;
export type VoiceVariationCandidate = z.infer<
  typeof voiceVariationCandidateSchema
>;
export type VoiceVariationCohort = z.infer<
  typeof voiceVariationCohortSchema
>;
