import { z } from "zod";

export const ACCOUNTING_SCENARIO_FAMILY = "accounting_clerk_enterprise_ap" as const;
export const ACCOUNTING_CORPUS_SOT_ID = "enterprise_accounting_ap_gold_v1" as const;
export const ACCOUNTING_SCENARIO_ID =
  "accounting_clerk_enterprise_ap_busy_manager_medium" as const;
export const ACCOUNTING_ACCEPTANCE_REFERENCE_ARTIFACT =
  "accounting_clerk_enterprise_ap_100pt_output.json" as const;
export const ACCOUNTING_HUMAN_REFERENCE_MEMO =
  "accounting_clerk_enterprise_ap_100pt_analysis.md" as const;
export const PHASE34_MODE = "v2" as const;

export const transcriptQualityTierSchema = z.enum(["gold", "silver", "reject"]);
export const transcriptReviewStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);
export const canonicalSpeakerRoleSchema = z.enum(["seller", "client", "unknown"]);
export const evidenceRequirementSchema = z.enum(["required", "optional"]);
export const derivedArtifactKindSchema = z.enum([
  "scenario_setting",
  "role_sipoc",
  "culture_fit",
  "top_performer_behavior",
]);
export const normPromotionSchema = z.enum([
  "coreNorm",
  "supportingNorm",
  "rareButImportant",
]);

export const transcriptSourceRecordSchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
  sheetName: z.string().min(1),
  dataRow: z.number().int().positive(),
  excelRow: z.number().int().positive(),
  executedAt: z.string().min(1),
  ownerName: z.string().min(1),
  meetingType: z.string().min(1),
  companyOrCandidateName: z.string(),
  title: z.string().min(1),
  transcriptText: z.string().min(1),
  documentUrl: z.string(),
  importedAt: z.string().min(1),
});

export const corpusManifestEntrySchema = z.object({
  sourceRecordId: z.string().min(1),
  transcriptId: z.string().min(1),
  tier: transcriptQualityTierSchema,
  reviewStatus: transcriptReviewStatusSchema.default("approved"),
  humanApproved: z.boolean().default(false),
  sellerLabelHints: z.array(z.string().min(1)).default([]),
  clientLabelHints: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
});

export const corpusManifestSchema = z.object({
  corpusId: z.string().min(1),
  family: z.literal(ACCOUNTING_SCENARIO_FAMILY),
  sourcePath: z.string().min(1),
  sheetName: z.string().min(1),
  version: z.string().min(1),
  createdAt: z.string().min(1),
  entries: z.array(corpusManifestEntrySchema).min(1),
});

export const evidenceRefSchema = z.object({
  transcriptId: z.string().min(1),
  sourceRecordId: z.string().min(1),
  turnIds: z.array(z.string().min(1)).min(1).default([]),
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().optional(),
});

export const textRedactionSchema = z.object({
  type: z.enum([
    "person",
    "company",
    "email",
    "phone",
    "url",
    "address",
    "other",
  ]),
  originalHash: z.string().min(1),
  replacement: z.string().min(1),
});

export const canonicalParticipantSchema = z.object({
  speakerId: z.string().min(1),
  label: z.string().min(1),
  role: canonicalSpeakerRoleSchema,
});

export const canonicalTurnSchema = z.object({
  turnId: z.string().min(1),
  index: z.number().int().nonnegative(),
  speakerId: z.string().min(1),
  speakerLabel: z.string().min(1),
  role: canonicalSpeakerRoleSchema,
  startedAtMs: z.number().int().nonnegative().optional(),
  endedAtMs: z.number().int().nonnegative().optional(),
  text: z.string().min(1),
  normalizedText: z.string().min(1),
  provenanceLineRange: z
    .object({
      start: z.number().int().positive(),
      end: z.number().int().positive(),
    })
    .optional(),
  redactions: z.array(textRedactionSchema).default([]),
});

export const canonicalAbstractedMetaSchema = z.object({
  industry: z.string().optional(),
  companyScale: z.enum(["enterprise", "mid", "startup", "unknown"]).default(
    "unknown"
  ),
  businessContext: z.array(z.string().min(1)).default([]),
  systemContext: z.array(z.string().min(1)).default([]),
  workflowCharacteristics: z.array(z.string().min(1)).default([]),
});

export const canonicalTranscriptSchema = z.object({
  id: z.string().min(1),
  sourceRecordId: z.string().min(1),
  corpusId: z.string().min(1),
  family: z.literal(ACCOUNTING_SCENARIO_FAMILY),
  language: z.literal("ja"),
  qualityTier: transcriptQualityTierSchema,
  createdAt: z.string().min(1),
  importedAt: z.string().min(1),
  redactVersion: z.string().min(1),
  normalizationVersion: z.string().min(1),
  sourceMeta: z.object({
    executedAt: z.string().min(1),
    ownerName: z.string().min(1),
    meetingType: z.string().min(1),
    title: z.string().min(1),
    documentUrl: z.string(),
  }),
  abstractedMeta: canonicalAbstractedMetaSchema,
  participants: z.array(canonicalParticipantSchema).min(1),
  turns: z.array(canonicalTurnSchema).min(1),
  quality: z.object({
    completenessScore: z.number().min(0).max(1),
    noiseScore: z.number().min(0).max(1),
    unknownSpeakerRatio: z.number().min(0).max(1),
    sellerResolved: z.boolean(),
    clientResolved: z.boolean(),
    usableForMvp: z.boolean(),
    speakerQuality: z.enum(["gold_eligible", "silver_only", "reject"]),
    rejectReasons: z
      .array(
        z.enum([
          "speaker_mapping_failed",
          "unknown_ratio_too_high",
          "redaction_failed",
          "provenance_incomplete",
        ])
      )
      .default([]),
  }),
});

export const scenarioSettingDataSchema = z.object({
  id: z.string().min(1),
  transcriptId: z.string().min(1),
  roleCategory: z.string().min(1),
  industry: z.string().min(1),
  companyScale: z.enum(["enterprise", "mid", "startup", "unknown"]),
  requestBackground: z.string().min(1),
  urgencyLevel: z.enum(["low", "medium", "high"]).optional(),
  cooperationStyle: z.enum(["cooperative", "busy", "skeptical"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  evidence: z.array(evidenceRefSchema).min(1),
});

export const roleSipocDataSchema = z.object({
  id: z.string().min(1),
  transcriptId: z.string().min(1),
  roleCategory: z.string().min(1),
  suppliers: z.array(z.string().min(1)).default([]),
  inputs: z.array(z.string().min(1)).default([]),
  process: z.array(z.string().min(1)).default([]),
  outputs: z.array(z.string().min(1)).default([]),
  customers: z.array(z.string().min(1)).default([]),
  evidence: z.array(evidenceRefSchema).min(1),
});

export const cultureFitDataSchema = z.object({
  id: z.string().min(1),
  transcriptId: z.string().min(1),
  roleCategory: z.string().optional(),
  handoffStructure: z.enum(["clear", "partial", "none", "unknown"]),
  workplaceAtmosphere: z.array(z.string().min(1)).default([]),
  difficultySignals: z.array(z.string().min(1)).default([]),
  implicitNorms: z.array(z.string().min(1)).default([]),
  riskSignals: z.array(z.string().min(1)).default([]),
  evidence: z.array(evidenceRefSchema).min(1),
});

export const topPerformerBehaviorDataSchema = z.object({
  id: z.string().min(1),
  transcriptId: z.string().min(1),
  stage: z.enum([
    "opening",
    "rapport",
    "discovery",
    "deep_dive",
    "culture_fit",
    "qualification",
    "closing",
    "follow_up",
  ]),
  trigger: z.string().min(1),
  questionIntent: z.string().min(1),
  exampleQuestion: z.string().min(1),
  expectedClientSignal: z.string().min(1),
  followupPattern: z.array(z.string().min(1)).default([]),
  whyItWorked: z.string().min(1),
  evidence: z.array(evidenceRefSchema).min(1),
});

export const derivedArtifactEnvelopeSchema = z.object({
  transcriptId: z.string().min(1),
  sourceRecordId: z.string().min(1),
  kind: derivedArtifactKindSchema,
  status: z.enum(["completed", "failed"]),
  requirementMode: z.object({
    requiredFields: z.array(z.string().min(1)).default([]),
    optionalFields: z.array(z.string().min(1)).default([]),
  }),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  model: z.string().min(1),
  responseId: z.string().optional(),
  retryCount: z.number().int().nonnegative().default(0),
  validationFailure: z.string().optional(),
  createdAt: z.string().min(1),
  payload: z.union([
    scenarioSettingDataSchema,
    roleSipocDataSchema,
    cultureFitDataSchema,
    topPerformerBehaviorDataSchema,
  ]),
});

export const normEvidenceSchema = z.object({
  transcriptIds: z.array(z.string().min(1)).min(1),
  supportingCount: z.number().int().positive(),
  humanApproved: z.boolean().default(false),
  applicableWhen: z.array(z.string().min(1)).default([]),
});

export const playbookNormItemV2Schema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  promotion: normPromotionSchema,
  description: z.string().min(1),
  evidence: normEvidenceSchema,
});

export const playbookNormsV2Schema = z.object({
  version: z.string().min(1),
  family: z.literal(ACCOUNTING_SCENARIO_FAMILY),
  corpusId: z.string().min(1),
  generatedAt: z.string().min(1),
  thresholdPolicy: z.object({
    coreNorm: z.number().int().positive(),
    supportingNorm: z.number().int().positive(),
    rareButImportant: z.number().int().positive(),
  }),
  questionFlowPatterns: z.array(playbookNormItemV2Schema).default([]),
  mustCapturePatterns: z.array(playbookNormItemV2Schema).default([]),
  cultureFitPatterns: z.array(playbookNormItemV2Schema).default([]),
  topPerformerPatterns: z.array(playbookNormItemV2Schema).default([]),
});

export const scenarioPackV2Schema = z.object({
  id: z.string().min(1),
  family: z.literal(ACCOUNTING_SCENARIO_FAMILY),
  version: z.string().min(1),
  title: z.string().min(1),
  language: z.literal("ja"),
  setting: scenarioSettingDataSchema,
  sipoc: roleSipocDataSchema,
  cultureFit: cultureFitDataSchema,
  topPerformerPlaybook: z.array(topPerformerBehaviorDataSchema).default([]),
  persona: z.object({
    role: z.string().min(1),
    demeanor: z.enum(["cooperative", "busy", "skeptical"]),
    companyAlias: z.string().min(1).optional(),
    responseStyle: z.string().min(1),
  }),
  publicBrief: z.string().min(1),
  hiddenFacts: z.array(z.string().min(1)).min(1),
  revealRules: z.array(
    z.object({
      trigger: z.string().min(1),
      reveals: z.array(z.string().min(1)).min(1),
    })
  ),
  mustCapture: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      priority: z.enum(["required", "recommended"]),
    })
  ),
  scoringRubric: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      weight: z.number().positive(),
      description: z.string().min(1),
    })
  ),
  openingLine: z.string().min(1),
  provenance: z.array(evidenceRefSchema).default([]),
  publishContract: z.object({
    companyAliasDefault: z.string().min(1).optional(),
    optionalRuntimeVariables: z.array(z.string().min(1)).default([]),
  }),
  acceptancePolicy: z.object({
    exactTextMatchForbidden: z.boolean().default(true),
    semanticChecks: z
      .array(
        z.enum([
          "required_field_presence",
          "persona_consistency",
          "hidden_fact_coverage",
          "must_capture_coverage",
          "reveal_rule_consistency",
          "provenance_completeness",
        ])
      )
      .min(1),
  }),
  promptSections: z
    .array(
      z.object({
        key: z.enum([
          "role",
          "context",
          "objective",
          "persona",
          "conversation_policy",
          "hidden_facts",
          "reveal_rules",
          "must_capture",
          "guardrails",
          "style",
          "closing",
        ]),
        title: z.string().min(1),
        body: z.string().min(1),
      })
    )
    .default([]),
});

export const scorecardV2Schema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1),
  generatedAt: z.string().min(1),
  metrics: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      score: z.number().min(0).max(100),
      rationale: z.string().min(1),
      evidenceTurnIds: z.array(z.string().min(1)).default([]),
    })
  ),
  summary: z.string().min(1),
  evaluationBreakdown: z
    .array(
      z.object({
        key: z.string().min(1),
        method: z.enum(["rule_based", "llm_based"]),
        passed: z.boolean(),
        notes: z.string().min(1),
      })
    )
    .default([]),
});

export type TranscriptSourceRecord = z.infer<typeof transcriptSourceRecordSchema>;
export type CorpusManifest = z.infer<typeof corpusManifestSchema>;
export type CorpusManifestEntry = z.infer<typeof corpusManifestEntrySchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type CanonicalTranscript = z.infer<typeof canonicalTranscriptSchema>;
export type ScenarioSettingData = z.infer<typeof scenarioSettingDataSchema>;
export type RoleSipocData = z.infer<typeof roleSipocDataSchema>;
export type CultureFitData = z.infer<typeof cultureFitDataSchema>;
export type TopPerformerBehaviorData = z.infer<typeof topPerformerBehaviorDataSchema>;
export type DerivedArtifactEnvelope = z.infer<typeof derivedArtifactEnvelopeSchema>;
export type PlaybookNormsV2 = z.infer<typeof playbookNormsV2Schema>;
export type ScenarioPackV2 = z.infer<typeof scenarioPackV2Schema>;
export type ScorecardV2 = z.infer<typeof scorecardV2Schema>;
