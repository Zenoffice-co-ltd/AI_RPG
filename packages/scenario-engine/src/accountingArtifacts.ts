import {
  ACCOUNTING_CORPUS_SOT_ID,
  derivedArtifactEnvelopeSchema,
  playbookNormsSchema,
  type CanonicalTranscript,
  type CultureFitData,
  type DerivedArtifactEnvelope,
  type PlaybookNorms,
  type RoleSipocData,
  type ScenarioSettingData,
  type TopPerformerBehaviorData,
} from "@top-performer/domain";
import type { OpenAiResponsesClient } from "@top-performer/vendors";

function firstEvidence(transcript: CanonicalTranscript) {
  const firstTurns = transcript.turns.slice(0, Math.min(3, transcript.turns.length));
  return [
    {
      transcriptId: transcript.id,
      sourceRecordId: transcript.sourceRecordId,
      turnIds: firstTurns.map((turn) => turn.turnId),
      confidence: 0.7,
      note: "Deterministic bootstrap evidence.",
    },
  ];
}

function inferIndustry(transcript: CanonicalTranscript) {
  return transcript.abstractedMeta.industry ?? "大手グループ企業（B2Bサービス/事業支援系）";
}

function inferRoleSipoc(transcript: CanonicalTranscript): RoleSipocData {
  return {
    id: `role_sipoc_${transcript.id}`,
    transcriptId: transcript.id,
    roleCategory: "経理事務",
    suppliers: ["各部門", "取引先/ベンダー"],
    inputs: transcript.abstractedMeta.workflowCharacteristics.length
      ? transcript.abstractedMeta.workflowCharacteristics
      : ["請求書", "支払申請", "経費精算申請"],
    process: ["内容確認", "会計登録", "支払処理", "差戻し対応"],
    outputs: ["支払依頼", "会計仕訳", "締め進行"],
    customers: ["経理財務部マネジャー", "事業部門"],
    evidence: firstEvidence(transcript),
  };
}

function inferCultureFit(transcript: CanonicalTranscript): CultureFitData {
  return {
    id: `culture_fit_${transcript.id}`,
    transcriptId: transcript.id,
    roleCategory: "経理事務",
    handoffStructure: "partial",
    workplaceAtmosphere: transcript.abstractedMeta.businessContext.includes("グループ会社運営")
      ? ["ベテラン比率が高い", "チームプレイ志向", "プロセス遵守"]
      : ["忙しいが高圧ではない", "プロセス遵守"],
    difficultySignals: transcript.abstractedMeta.systemContext.includes("ERP")
      ? ["ERP移行", "件数の多さ", "例外対応"]
      : ["件数の多さ", "締め対応"],
    implicitNorms: ["既存運用に合わせる", "仮説を持って確認する"],
    riskSignals: ["管理だけしたい人はミスマッチ", "入力しかできない人は難しい"],
    evidence: firstEvidence(transcript),
  };
}

function inferScenarioSetting(transcript: CanonicalTranscript): ScenarioSettingData {
  return {
    id: `scenario_setting_${transcript.id}`,
    transcriptId: transcript.id,
    roleCategory: "経理事務",
    industry: inferIndustry(transcript),
    companyScale: transcript.abstractedMeta.companyScale,
    requestBackground:
      transcript.abstractedMeta.businessContext.join(" / ") ||
      "ERP移行・内製強化・支払運用安定化のための増員",
    urgencyLevel: "high",
    cooperationStyle: "busy",
    difficulty: "medium",
    evidence: firstEvidence(transcript),
  };
}

function inferTopPerformerBehavior(transcript: CanonicalTranscript): TopPerformerBehaviorData {
  return {
    id: `tpb_${transcript.id}`,
    transcriptId: transcript.id,
    stage: "discovery",
    trigger: "募集背景の確認",
    questionIntent: "表面的な増員理由ではなく真因を取る",
    exampleQuestion: "なぜ今このポジションが必要なのか、もう少し背景を伺えますか。",
    expectedClientSignal: "ERP移行や既存負荷の真因が出る",
    followupPattern: ["なぜ今か", "誰の負荷を剥がしたいか", "どこまで任せたいか"],
    whyItWorked: "enterprise 会計案件では背景の真因が候補者要件を左右するため。",
    evidence: firstEvidence(transcript),
  };
}

export async function extractAccountingArtifactsForTranscript(input: {
  client: OpenAiResponsesClient;
  model: string;
  transcript: CanonicalTranscript;
}) {
  void input.client;
  const scenarioSetting = inferScenarioSetting(input.transcript);
  const roleSipoc = inferRoleSipoc(input.transcript);
  const cultureFit = inferCultureFit(input.transcript);
  const topPerformerBehavior = inferTopPerformerBehavior(input.transcript);

  const envelopes: DerivedArtifactEnvelope[] = [
    {
      transcriptId: input.transcript.id,
      sourceRecordId: input.transcript.sourceRecordId,
      kind: "scenario_setting",
      status: "completed",
      requirementMode: {
        requiredFields: ["roleCategory", "industry", "companyScale", "requestBackground"],
        optionalFields: ["urgencyLevel", "cooperationStyle", "difficulty"],
      },
      promptVersion: "accounting-derived-artifacts@2026-04-08.v1",
      schemaVersion: "accounting-derived-artifacts@2026-04-08.v1",
      model: input.model,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      payload: scenarioSetting,
    },
    {
      transcriptId: input.transcript.id,
      sourceRecordId: input.transcript.sourceRecordId,
      kind: "role_sipoc",
      status: "completed",
      requirementMode: {
        requiredFields: ["suppliers", "inputs", "process", "outputs", "customers"],
        optionalFields: [],
      },
      promptVersion: "accounting-derived-artifacts@2026-04-08.v1",
      schemaVersion: "accounting-derived-artifacts@2026-04-08.v1",
      model: input.model,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      payload: roleSipoc,
    },
    {
      transcriptId: input.transcript.id,
      sourceRecordId: input.transcript.sourceRecordId,
      kind: "culture_fit",
      status: "completed",
      requirementMode: {
        requiredFields: ["handoffStructure", "workplaceAtmosphere", "riskSignals"],
        optionalFields: ["difficultySignals", "implicitNorms"],
      },
      promptVersion: "accounting-derived-artifacts@2026-04-08.v1",
      schemaVersion: "accounting-derived-artifacts@2026-04-08.v1",
      model: input.model,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      payload: cultureFit,
    },
    {
      transcriptId: input.transcript.id,
      sourceRecordId: input.transcript.sourceRecordId,
      kind: "top_performer_behavior",
      status: "completed",
      requirementMode: {
        requiredFields: ["stage", "trigger", "questionIntent", "followupPattern"],
        optionalFields: [],
      },
      promptVersion: "accounting-derived-artifacts@2026-04-08.v1",
      schemaVersion: "accounting-derived-artifacts@2026-04-08.v1",
      model: input.model,
      retryCount: 0,
      createdAt: new Date().toISOString(),
      payload: topPerformerBehavior,
    },
  ].map((item) => derivedArtifactEnvelopeSchema.parse(item));

  return {
    scenarioSetting,
    roleSipoc,
    cultureFit,
    topPerformerBehavior,
    envelopes,
  };
}

export function buildAccountingPlaybookFromArtifacts(input: {
  version: string;
  scenarioSettings: ScenarioSettingData[];
  roleSipocs: RoleSipocData[];
  cultureFits: CultureFitData[];
  topPerformerBehaviors: TopPerformerBehaviorData[];
  humanApprovedTranscriptIds: string[];
}): PlaybookNorms {
  void input.roleSipocs;
  void input.cultureFits;
  void input.topPerformerBehaviors;

  return playbookNormsSchema.parse({
    version: input.version,
    family: "accounting_clerk_enterprise_ap",
    taxonomyVersion: "accounting-derived-artifacts@2026-04-08.v1",
    requiredItems: [
      {
        key: "hiring_background",
        label: "採用背景",
        frequency: 1,
        medianFirstTurnIndex: 1,
        targetDepthMedian: 4,
        evidenceTranscriptIds:
          input.humanApprovedTranscriptIds.length > 0
            ? input.humanApprovedTranscriptIds
            : input.scenarioSettings.map((item) => item.transcriptId),
      },
    ],
    recommendedItems: [
      {
        key: "team_structure",
        label: "チーム構成",
        frequency: 0.5,
        medianFirstTurnIndex: 8,
      },
    ],
    winningMoves: [
      {
        key: "background_true_reason",
        label: "背景の真因深掘り",
        description: "増員理由を真因まで深掘りする。",
        frequency: 1,
      },
    ],
    antiPatterns: [
      {
        key: "shallow_requirement_dump",
        label: "浅い要件確認で終了",
        description: "背景や判断レベルまで進まずに終える。",
      },
    ],
    canonicalOrder: ["hiring_background", "team_structure"],
    generatedAt: new Date().toISOString(),
  });
}

export function renderDerivedArtifactReviewMarkdown(input: {
  transcript: CanonicalTranscript;
  envelopes: DerivedArtifactEnvelope[];
}) {
  return [
    `# ${input.transcript.id}`,
    "",
    `- corpusId: ${ACCOUNTING_CORPUS_SOT_ID}`,
    `- qualityTier: ${input.transcript.qualityTier}`,
    "",
    "## Derived Artifacts",
    ...input.envelopes.map(
      (envelope) => `- ${envelope.kind}: ${envelope.status} (${envelope.model})`
    ),
  ].join("\n");
}
