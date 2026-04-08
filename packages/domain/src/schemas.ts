import { z } from "zod";
import {
  STAFFING_ORDER_HEARING_TAXONOMY,
  STAFFING_ORDER_HEARING_TAXONOMY_VERSION,
} from "./taxonomy";

export const timestampSchema = z.string().min(1);
export const familySchema = z.enum([
  "staffing_order_hearing",
  "accounting_clerk_enterprise_ap",
]);
export const languageSchema = z.literal("ja");
export const performanceTierSchema = z.literal("top");
export const transcriptSpeakerSchema = z.enum(["sales", "client"]);
export const sessionTurnRoleSchema = z.enum(["user", "avatar"]);
export const scenarioDifficultySchema = z.enum(["easy", "medium", "hard"]);
export const sessionStatusSchema = z.enum([
  "created",
  "active",
  "ending",
  "transcript_ready",
  "analysis_queued",
  "analysis_running",
  "completed",
  "failed",
]);
export const mustCaptureStatusSchema = z.enum(["captured", "partial", "missed"]);
export const scenarioStatusSchema = z.enum(["draft", "published"]);
export const redactionStatusSchema = z.enum(["raw", "redacted"]);
export const transcriptRoleSchema = z.enum(["user", "avatar"]);
export const taxonomyKeySchema = z.enum(
  STAFFING_ORDER_HEARING_TAXONOMY.map((item) => item.key) as [
    (typeof STAFFING_ORDER_HEARING_TAXONOMY)[number]["key"],
    ...(typeof STAFFING_ORDER_HEARING_TAXONOMY)[number]["key"][]
  ]
);

export const transcriptTurnSchema = z.object({
  turnId: z.string().min(1),
  speaker: transcriptSpeakerSchema,
  text: z.string().min(1),
  timestampSec: z.number().nonnegative().optional(),
});

export const transcriptRecordSchema = z.object({
  id: z.string().min(1),
  sourceFile: z.string().min(1),
  family: familySchema,
  performanceTier: performanceTierSchema,
  language: languageSchema,
  metadata: z.object({
    industry: z.string().optional(),
    companySize: z.string().optional(),
    roleOfContact: z.string().optional(),
    outcome: z.string().optional(),
  }),
  turns: z.array(transcriptTurnSchema).min(1),
  importedAt: timestampSchema,
  redactionStatus: redactionStatusSchema,
});

export const transcriptBehaviorExtractionSchema = z.object({
  transcriptId: z.string().min(1),
  phaseSegments: z.array(
    z.object({
      phase: z.string().min(1),
      startTurnId: z.string().min(1),
      endTurnId: z.string().min(1),
    })
  ),
  capturedItems: z.array(
    z.object({
      key: taxonomyKeySchema,
      firstTurnId: z.string().min(1),
      depthScore: z.number().min(0).max(5),
      evidenceTurnIds: z.array(z.string().min(1)).min(1),
    })
  ),
  winningMoves: z.array(
    z.object({
      key: z.string().min(1),
      evidenceTurnIds: z.array(z.string().min(1)).min(1),
    })
  ),
  antiPatterns: z.array(
    z.object({
      key: z.string().min(1),
      evidenceTurnIds: z.array(z.string().min(1)).min(1),
    })
  ),
});

export const playbookNormItemSchema = z.object({
  key: taxonomyKeySchema,
  label: z.string().min(1),
  frequency: z.number().min(0).max(1),
  medianFirstTurnIndex: z.number().int().nonnegative(),
  targetDepthMedian: z.number().min(0).max(5).optional(),
  evidenceTranscriptIds: z.array(z.string().min(1)).min(1),
});

export const playbookNormsSchema = z.object({
  version: z.string().min(1),
  family: familySchema,
  taxonomyVersion: z.string().min(1).default(STAFFING_ORDER_HEARING_TAXONOMY_VERSION),
  requiredItems: z.array(playbookNormItemSchema),
  recommendedItems: z.array(
    playbookNormItemSchema.omit({
      targetDepthMedian: true,
      evidenceTranscriptIds: true,
    })
  ),
  winningMoves: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      description: z.string().min(1),
      frequency: z.number().min(0).max(1),
    })
  ),
  antiPatterns: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      description: z.string().min(1),
    })
  ),
  canonicalOrder: z.array(taxonomyKeySchema),
  generatedAt: timestampSchema,
  thresholdPolicy: z
    .object({
      coreNorm: z.number().int().positive(),
      supportingNorm: z.number().int().positive(),
      rareButImportant: z.number().int().positive(),
    })
    .optional(),
  normItems: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        promotion: z.enum(["coreNorm", "supportingNorm", "rareButImportant"]),
        supportCount: z.number().int().positive(),
        transcriptIds: z.array(z.string().min(1)).min(1),
        applicableWhen: z.array(z.string().min(1)).default([]),
        summary: z.string().min(1),
      })
    )
    .optional(),
});

export const scenarioMustCaptureItemSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  priority: z.enum(["required", "recommended"]),
  canonicalOrder: z.number().int().nonnegative(),
});

export const scenarioPackSchema = z.object({
  id: z.string().min(1),
  family: familySchema,
  version: z.string().min(1),
  title: z.string().min(1),
  language: languageSchema,
  difficulty: scenarioDifficultySchema,
  persona: z.object({
    role: z.string().min(1),
    companyAlias: z.string().min(1),
    demeanor: z.enum(["cooperative", "busy", "skeptical"]),
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
  mustCaptureItems: z.array(scenarioMustCaptureItemSchema).min(1),
  rubric: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      weight: z.number().positive(),
      description: z.string().min(1),
    })
  ),
  closeCriteria: z.array(z.string().min(1)).min(1),
  openingLine: z.string().min(1),
  generatedFromPlaybookVersion: z.string().min(1),
  status: scenarioStatusSchema,
  scenarioSetting: z.record(z.string(), z.unknown()).optional(),
  roleSipoc: z.record(z.string(), z.unknown()).optional(),
  cultureFit: z.record(z.string(), z.unknown()).optional(),
  topPerformerPlaybook: z.array(z.record(z.string(), z.unknown())).optional(),
  promptSections: z
    .array(
      z.object({
        key: z.string().min(1),
        title: z.string().min(1),
        body: z.string().min(1),
      })
    )
    .optional(),
  provenance: z
    .object({
      corpusId: z.string().min(1),
      transcriptIds: z.array(z.string().min(1)).min(1),
      referenceArtifactPath: z.string().min(1).optional(),
      designMemoPath: z.string().min(1).optional(),
    })
    .optional(),
  publishContract: z
    .object({
      companyAliasDefault: z.string().min(1).optional(),
      runtimeVariables: z.array(z.string().min(1)).default([]),
      dictionaryRequired: z.boolean().default(false),
    })
    .optional(),
  acceptancePolicy: z
    .object({
      exactTextMatchForbidden: z.boolean(),
      semanticChecks: z.array(z.string().min(1)).min(1),
    })
    .optional(),
});

export const compiledScenarioAssetsSchema = z.object({
  scenarioId: z.string().min(1),
  promptVersion: z.string().min(1),
  knowledgeBaseText: z.string().min(1),
  agentSystemPrompt: z.string().min(1),
  generatedAt: timestampSchema,
  promptSections: z
    .array(
      z.object({
        key: z.string().min(1),
        title: z.string().min(1),
        body: z.string().min(1),
      })
    )
    .optional(),
  platformConfig: z.record(z.string(), z.unknown()).optional(),
  semanticAcceptance: z.record(z.string(), z.unknown()).optional(),
});

export const sessionTurnSchema = z.object({
  turnId: z.string().min(1),
  role: sessionTurnRoleSchema,
  text: z.string().min(1),
  relativeTimestamp: z.number().int().nonnegative(),
  absoluteTimestamp: z.number().int().nonnegative().optional(),
  source: z.enum(["plugin_event", "transcript_api", "webhook_artifact"]).default(
    "transcript_api"
  ),
  dedupeKey: z.string().min(1),
});

export const sessionRecordSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1),
  status: sessionStatusSchema,
  liveavatarSessionId: z.string().min(1),
  livekitRoomUrl: z.string().min(1),
  livekitToken: z.string().min(1),
  avatarId: z.string().min(1),
  elevenAgentId: z.string().min(1),
  startedAt: timestampSchema,
  endedAt: timestampSchema.optional(),
  transcriptCursor: z.number().int().nonnegative().optional(),
  analysisVersion: z.string().min(1),
  error: z.string().optional(),
});

export const scorecardSchema = z.object({
  sessionId: z.string().min(1),
  scenarioId: z.string().min(1),
  overallScore: z.number().min(0).max(100),
  topPerformerAlignmentScore: z.number().min(0).max(100),
  rubricScores: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      score: z.number().min(0).max(100),
      weight: z.number().positive(),
      evidenceTurnIds: z.array(z.string().min(1)),
      rationale: z.string().min(1),
    })
  ),
  mustCaptureResults: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      status: mustCaptureStatusSchema,
      evidenceTurnIds: z.array(z.string().min(1)),
    })
  ),
  strengths: z.array(z.string().min(1)),
  misses: z.array(z.string().min(1)),
  missedQuestions: z.array(z.string().min(1)),
  nextDrills: z.array(z.string().min(1)),
  summary: z.string().min(1),
  generatedAt: timestampSchema,
  promptVersion: z.string().min(1),
  evaluationMode: z.enum(["legacy", "accounting_v2"]).optional(),
  qualitySignals: z
    .object({
      requiredQuestions: z.number().min(0).max(100),
      deepDiveQuality: z.number().min(0).max(100),
      judgementWorkCapture: z.number().min(0).max(100),
      cultureFitCapture: z.number().min(0).max(100),
      conditionsStructuring: z.number().min(0).max(100),
      revealEfficiency: z.number().min(0).max(100),
      closeQuality: z.number().min(0).max(100),
    })
    .optional(),
  evaluationBreakdown: z
    .array(
      z.object({
        key: z.string().min(1),
        method: z.enum(["rule_based", "llm_based"]),
        passed: z.boolean(),
        notes: z.string().min(1),
      })
    )
    .optional(),
});

export const agentBindingSchema = z.object({
  scenarioId: z.string().min(1),
  elevenAgentId: z.string().min(1),
  elevenBranchId: z.string().min(1).optional(),
  elevenVersionId: z.string().min(1).optional(),
  voiceProfileId: z.string().min(1).optional(),
  voiceId: z.string().min(1),
  publishedAt: timestampSchema,
});

export const sessionArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    "scorecard",
    "full_transcript",
    "behavior_extraction",
    "compiled_scenario_assets",
    "eleven_webhook_payload",
  ]),
  sessionId: z.string().min(1),
  createdAt: timestampSchema,
  payload: z.record(z.string(), z.unknown()),
});

export const transcriptDeltaSchema = z.object({
  sessionId: z.string().min(1),
  cursor: z.number().int().nonnegative(),
  turns: z.array(sessionTurnSchema),
  sessionActive: z.boolean().default(true),
});

export const startSessionInputSchema = z.object({
  scenarioId: z.string().min(1),
  avatarId: z.string().min(1).optional(),
  userLabel: z.string().min(1).optional(),
});

export const startSessionOutputSchema = z.object({
  sessionId: z.string().min(1),
  liveavatarSessionId: z.string().min(1),
  roomUrl: z.string().min(1),
  roomToken: z.string().min(1),
  avatarId: z.string().min(1),
});

export const stopSessionOutputSchema = z.object({
  stoppedAt: timestampSchema,
});

export const avatarProviderStartInputSchema = z.object({
  avatarId: z.string().min(1),
  elevenAgentId: z.string().min(1),
  sandbox: z.boolean().default(false),
  sessionNamespace: z.string().min(1).optional(),
});

export const avatarProviderStartOutputSchema = z.object({
  liveavatarSessionId: z.string().min(1),
  roomUrl: z.string().min(1),
  roomToken: z.string().min(1),
  avatarId: z.string().min(1),
});

export const analyzeSessionRequestSchema = z.object({
  sessionId: z.string().min(1),
});

export const transcriptImportRequestSchema = z.object({
  path: z.string().min(1),
  family: familySchema.optional(),
  mode: z.enum(["legacy", "v2"]).optional(),
  manifestPath: z.string().min(1).optional(),
});

export const playbookBuildRequestSchema = z.object({
  family: familySchema,
  mode: z.enum(["legacy", "v2"]).optional(),
});

export const compileScenariosRequestSchema = z.object({
  playbookVersion: z.string().min(1).optional(),
  family: familySchema.optional(),
  mode: z.enum(["legacy", "v2"]).optional(),
  referenceArtifactPath: z.string().min(1).optional(),
  designMemoPath: z.string().min(1).optional(),
});

export const publishScenarioRequestSchema = z.object({
  scenarioId: z.string().min(1),
  avatarId: z.string().min(1).optional(),
});

export const getSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  status: sessionStatusSchema,
  scenarioId: z.string().min(1),
});

export const endSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  status: sessionStatusSchema,
});

export const resultResponseSchema = z.object({
  sessionId: z.string().min(1),
  status: sessionStatusSchema,
  scorecard: scorecardSchema.optional(),
});

export const publicScenarioSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  difficulty: scenarioDifficultySchema,
  publicBrief: z.string().min(1),
  status: scenarioStatusSchema,
});

export const runtimeSettingsSchema = z.object({
  defaultAvatarId: z.string().min(1),
  defaultElevenModel: z.string().min(1),
  defaultElevenVoiceId: z.string().min(1),
  liveavatarSandbox: z.boolean(),
  liveAvatarElevenSecretId: z.string().min(1).optional(),
});

export const jobRecordSchema = z.object({
  jobId: z.string().min(1),
  type: z.enum([
    "transcript_import",
    "playbook_build",
    "scenario_compile",
    "scenario_publish",
    "session_analysis",
  ]),
  status: z.enum(["queued", "running", "completed", "failed"]),
  family: familySchema.optional(),
  scenarioId: z.string().min(1).optional(),
  playbookVersion: z.string().min(1).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type TranscriptRecord = z.infer<typeof transcriptRecordSchema>;
export type TranscriptBehaviorExtraction = z.infer<
  typeof transcriptBehaviorExtractionSchema
>;
export type PlaybookNorms = z.infer<typeof playbookNormsSchema>;
export type ScenarioPack = z.infer<typeof scenarioPackSchema>;
export type CompiledScenarioAssets = z.infer<typeof compiledScenarioAssetsSchema>;
export type SessionTurn = z.infer<typeof sessionTurnSchema>;
export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type Scorecard = z.infer<typeof scorecardSchema>;
export type AgentBinding = z.infer<typeof agentBindingSchema>;
export type SessionArtifact = z.infer<typeof sessionArtifactSchema>;
export type TranscriptDelta = z.infer<typeof transcriptDeltaSchema>;
export type StartSessionInput = z.infer<typeof startSessionInputSchema>;
export type StartSessionOutput = z.infer<typeof startSessionOutputSchema>;
export type StopSessionOutput = z.infer<typeof stopSessionOutputSchema>;
export type AvatarProviderStartInput = z.infer<typeof avatarProviderStartInputSchema>;
export type AvatarProviderStartOutput = z.infer<
  typeof avatarProviderStartOutputSchema
>;
export type PublicScenarioSummary = z.infer<typeof publicScenarioSummarySchema>;
export type JobRecord = z.infer<typeof jobRecordSchema>;
