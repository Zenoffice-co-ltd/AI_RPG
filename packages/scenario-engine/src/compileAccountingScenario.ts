import { readFile } from "node:fs/promises";
import {
  ACCOUNTING_ACCEPTANCE_REFERENCE_ARTIFACT,
  ACCOUNTING_CORPUS_SOT_ID,
  ACCOUNTING_HUMAN_REFERENCE_MEMO,
  ACCOUNTING_SCENARIO_FAMILY,
  ACCOUNTING_SCENARIO_ID,
  compiledScenarioAssetsSchema,
  scenarioPackSchema,
  scenarioPackV2Schema,
  type CompiledScenarioAssets,
  type EvidenceRef,
  type PlaybookNorms,
  type ScenarioPack,
  type ScenarioPackV2,
} from "@top-performer/domain";

type ReferenceEvidence = {
  transcriptId: string;
  confidence?: number;
  note?: string;
};

type ReferenceArtifact = {
  meta?: { createdAt?: string };
  phase3?: {
    scenarioSetting?: Record<string, unknown> & { evidence?: ReferenceEvidence[] };
    roleSipoc?: Record<string, unknown> & { evidence?: ReferenceEvidence[] };
    cultureFit?: Record<string, unknown> & { evidence?: ReferenceEvidence[] };
  };
  phase4?: {
    scenarioPack?: Record<string, unknown>;
  };
};

function toEvidenceRef(input: ReferenceEvidence): EvidenceRef {
  return {
    transcriptId: input.transcriptId,
    sourceRecordId: input.transcriptId,
    turnIds: ["reference_only"],
    ...(typeof input.confidence === "number" ? { confidence: input.confidence } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
}

function stringArray(input: unknown) {
  return Array.isArray(input) ? input.map((item) => String(item)) : [];
}

function ensureDecisionStructureHiddenFact(hiddenFacts: string[]) {
  if (hiddenFacts.some((item) => /決裁|承認|最終判断|部門長/i.test(item))) {
    return hiddenFacts;
  }
  return [
    ...hiddenFacts,
    "最終的な採用可否や条件調整は部門責任者の承認が必要で、現場判断だけでは確定しない。",
  ];
}

function ensureDecisionStructureRevealRule(
  revealRules: Array<{ trigger: string; reveals: string[] }>
) {
  if (revealRules.some((item) => /決裁|承認|最終判断/i.test(item.trigger))) {
    return revealRules;
  }
  return [
    ...revealRules,
    {
      trigger: "承認フローや誰が最終判断するかを聞かれた",
      reveals: [
        "現場だけでは確定せず、部門責任者の承認が必要と答える。",
      ],
    },
  ];
}

function rewritePromptSectionBody(title: string, body: string) {
  if (title === "Objective") {
    return "enterprise 経理案件のオーダーヒアリングに対して、現実的なクライアント役として振る舞ってください。";
  }
  if (title === "Reveal Rules") {
    return "募集背景は最初は体制強化とだけ言い、深掘りされた時に ERP 移行や内製強化を出してください。業務内容も最初は支払・経費精算寄りと答え、詳細分解された時に固定資産や判断レベルを出してください。開始時期だけを聞かれたら表向きの時期だけ答え、充足期限や現場影響まで深掘りされた時に『実務上は今月末までに初回候補を固めたい』と答えてください。承認フローを聞かれたら、現場だけでは確定せず部門責任者の承認が必要と答えてください。カルチャーリスクや優先順位は、比較質問や相性確認があった時のみ出してください。";
  }
  if (title === "Must Capture Items") {
    return "深掘りされた論点に対してだけ、背景の真因、業務の範囲、判断レベル、体制、ボリューム、システム、立ち上がり、働き方、カルチャー、条件調整余地に関する情報を自然に返してください。自分から確認項目を一覧化したり、質問の進め方を教えたりしないでください。";
  }
  if (title === "Closing") {
    return "進め方や次のアクションを聞かれたら、営業の要約に不足や修正があれば短く返したうえで、候補者提案や社内確認につながる自然で具体的な次アクションを一文から二文で返してください。会話が浅くても、相手に質問項目を教えるのではなく、会話相手として自然な次の進め方だけを返してください。";
  }
  return body;
}

function mapPromptSectionKey(title: string): ScenarioPackV2["promptSections"][number]["key"] {
  const normalized = title.toLowerCase();
  if (normalized.includes("role")) return "role";
  if (normalized.includes("objective")) return "objective";
  if (normalized.includes("persona")) return "persona";
  if (normalized.includes("conversation")) return "conversation_policy";
  if (normalized.includes("hidden")) return "hidden_facts";
  if (normalized.includes("reveal")) return "reveal_rules";
  if (normalized.includes("must capture")) return "must_capture";
  if (normalized.includes("guardrail")) return "guardrails";
  if (normalized.includes("closing")) return "closing";
  if (normalized.includes("style")) return "style";
  return "context";
}

function buildKnowledgeBase(scenario: ReturnType<typeof scenarioPackV2Schema.parse>) {
  return [
    `# Scenario`,
    `Title: ${scenario.title}`,
    "",
    "## Public Brief",
    scenario.publicBrief,
    "",
    "## Hidden Facts",
    ...scenario.hiddenFacts.map((item) => `- ${item}`),
    "",
    "## Must Capture",
    ...scenario.mustCapture.map((item) => `- [${item.priority}] ${item.label}`),
  ].join("\n");
}

function buildPrompt(scenario: ReturnType<typeof scenarioPackV2Schema.parse>) {
  return scenario.promptSections
    .map((section) => `# ${section.title}\n${section.body}`)
    .join("\n\n");
}

async function loadReferenceArtifact(referencePath: string) {
  const raw = await readFile(referencePath, "utf8");
  return JSON.parse(raw) as ReferenceArtifact;
}

function evaluateAccountingScenarioAcceptance(input: {
  scenario: ScenarioPack;
  scenarioV2: ScenarioPackV2;
  assets: CompiledScenarioAssets;
  reference: ReferenceArtifact;
  referencePath: string;
  designMemoPath?: string;
}) {
  const referenceScenarioPack =
    (input.reference.phase4?.scenarioPack ?? {}) as any;
  const referenceMustCapture = Array.isArray(referenceScenarioPack.mustCaptureItems)
    ? referenceScenarioPack.mustCaptureItems
    : [];
  const referenceMustCaptureKeys = referenceMustCapture
    .map((item: unknown) => String((item as { key?: unknown }).key ?? ""))
    .filter(Boolean);
  const referenceHiddenFacts = Array.isArray(referenceScenarioPack.hiddenFacts)
    ? referenceScenarioPack.hiddenFacts
    : [];
  const referenceRevealRules = Array.isArray(referenceScenarioPack.revealRules)
    ? referenceScenarioPack.revealRules
    : [];

  const mustCaptureCoverage =
    referenceMustCaptureKeys.length === 0
      ? input.scenario.mustCaptureItems.length > 0
      : referenceMustCaptureKeys.every((key: string) =>
          input.scenario.mustCaptureItems.some((item) => item.key === key)
        );
  const hiddenFactCoverage =
    input.scenario.hiddenFacts.length >= Math.max(1, Math.floor(referenceHiddenFacts.length * 0.6));
  const revealRuleConsistency =
    input.scenario.revealRules.length >= Math.max(1, Math.floor(referenceRevealRules.length * 0.6));
  const provenanceCompleteness = Boolean(
    input.scenario.provenance?.corpusId &&
      input.scenario.provenance.transcriptIds.length > 0 &&
      input.assets.semanticAcceptance
  );
  const requiredFieldPresence = Boolean(
    input.scenario.title &&
      input.scenario.publicBrief &&
      input.scenario.persona.responseStyle &&
      input.scenario.mustCaptureItems.length > 0 &&
      input.scenario.rubric.length > 0
  );
  const personaConsistency =
    input.scenario.persona.demeanor === "busy" &&
    /忙しい/.test(input.scenario.persona.responseStyle);

  return {
    requiredFieldPresence,
    personaConsistency,
    hiddenFactCoverage,
    mustCaptureCoverage,
    revealRuleConsistency,
    provenanceCompleteness,
    exactTextMatchForbidden: true,
    semanticAcceptancePassed:
      requiredFieldPresence &&
      personaConsistency &&
      hiddenFactCoverage &&
      mustCaptureCoverage &&
      revealRuleConsistency &&
      provenanceCompleteness,
    referenceArtifact: ACCOUNTING_ACCEPTANCE_REFERENCE_ARTIFACT,
    referenceArtifactPath: input.referencePath,
    designMemo: input.designMemoPath ?? ACCOUNTING_HUMAN_REFERENCE_MEMO,
    corpusId: ACCOUNTING_CORPUS_SOT_ID,
  };
}

export async function compileAccountingScenarioFromReference(input: {
  referencePath: string;
  designMemoPath?: string;
}) {
  const reference = await loadReferenceArtifact(input.referencePath);
  const scenarioPack = (reference.phase4?.scenarioPack ?? {}) as any;
  const phase3Setting = (reference.phase3?.scenarioSetting ??
    scenarioPack.setting ??
    {}) as any;
  const phase3Sipoc = (reference.phase3?.roleSipoc ??
    scenarioPack.sipoc ??
    {}) as any;
  const phase3Culture = (reference.phase3?.cultureFit ??
    scenarioPack.cultureFit ??
    {}) as any;
  const provenance = (scenarioPack.provenance ?? {}) as any;
  const publish = (scenarioPack.publish ?? {}) as any;
  const promptSections = (publish.systemPromptSections ?? {}) as Record<string, unknown>;

  const scenarioV2 = scenarioPackV2Schema.parse({
    id: String(scenarioPack.scenarioId ?? ACCOUNTING_SCENARIO_ID),
    family: ACCOUNTING_SCENARIO_FAMILY,
    version: String(scenarioPack.version ?? "accounting_reference_v1"),
    title: String(scenarioPack.title ?? "経理事務 AP"),
    language: "ja",
    setting: {
      id: String(phase3Setting.id ?? "scenario_setting_reference_v1"),
      transcriptId: "aggregate",
      roleCategory: String(
        phase3Setting.roleCategory ?? scenarioPack.roleCategory ?? "経理事務"
      ),
      industry: String(phase3Setting.industry ?? "unknown"),
      companyScale: String(phase3Setting.companyScale ?? "unknown"),
      requestBackground: String(phase3Setting.requestBackground ?? ""),
      urgencyLevel:
        typeof phase3Setting.urgencyLevel === "string"
          ? phase3Setting.urgencyLevel
          : undefined,
      cooperationStyle:
        typeof phase3Setting.cooperationStyle === "string"
          ? phase3Setting.cooperationStyle
          : undefined,
      difficulty:
        typeof phase3Setting.difficulty === "string"
          ? phase3Setting.difficulty
          : undefined,
      evidence:
        (phase3Setting.evidence ?? []).length > 0
          ? (phase3Setting.evidence ?? []).map(toEvidenceRef)
          : [toEvidenceRef({ transcriptId: "aggregate" })],
    },
    sipoc: {
      id: String(phase3Sipoc.id ?? "role_sipoc_reference_v1"),
      transcriptId: "aggregate",
      roleCategory: String(phase3Sipoc.roleCategory ?? "経理事務"),
      suppliers: stringArray(phase3Sipoc.suppliers),
      inputs: stringArray(phase3Sipoc.inputs),
      process: stringArray(phase3Sipoc.process),
      outputs: stringArray(phase3Sipoc.outputs),
      customers: stringArray(phase3Sipoc.customers),
      evidence:
        (phase3Sipoc.evidence ?? []).length > 0
          ? (phase3Sipoc.evidence ?? []).map(toEvidenceRef)
          : [toEvidenceRef({ transcriptId: "aggregate" })],
    },
    cultureFit: {
      id: String(phase3Culture.id ?? "culture_fit_reference_v1"),
      transcriptId: "aggregate",
      roleCategory:
        typeof phase3Culture.roleCategory === "string"
          ? phase3Culture.roleCategory
          : undefined,
      handoffStructure: String(phase3Culture.handoffStructure ?? "unknown"),
      workplaceAtmosphere: stringArray(phase3Culture.workplaceAtmosphere),
      difficultySignals: stringArray(phase3Culture.difficultySignals),
      implicitNorms: stringArray(phase3Culture.implicitNorms),
      riskSignals: stringArray(phase3Culture.riskSignals),
      evidence:
        (phase3Culture.evidence ?? []).length > 0
          ? (phase3Culture.evidence ?? []).map(toEvidenceRef)
          : [toEvidenceRef({ transcriptId: "aggregate" })],
    },
    topPerformerPlaybook: Array.isArray(scenarioPack.topPerformerPlaybook)
      ? (scenarioPack.topPerformerPlaybook as any[]).map(
          (item: any, index) => ({
            id: `tpb_${String(index + 1).padStart(2, "0")}`,
            transcriptId: "aggregate",
            stage: String(item["stage"] ?? "discovery"),
            trigger: stringArray(item["preferredQuestionAngles"]).join(" / "),
            questionIntent: stringArray(item["preferredQuestionAngles"]).join(" / "),
            exampleQuestion:
              stringArray(item["followupPatterns"])[0] ??
              stringArray(item["preferredQuestionAngles"])[0] ??
              String(item["stage"] ?? "discovery"),
            expectedClientSignal: stringArray(item["signalsToLookFor"]).join(" / "),
            followupPattern: stringArray(item["followupPatterns"]),
            whyItWorked: stringArray(item["signalsToLookFor"]).join(" / "),
            evidence:
              (phase3Setting.evidence ?? []).length > 0
                ? (phase3Setting.evidence ?? []).slice(0, 1).map(toEvidenceRef)
                : [toEvidenceRef({ transcriptId: "aggregate" })],
          })
        )
      : [],
    persona: {
      role: "経理財務部マネジャー",
      demeanor: "busy",
      companyAlias: "Enterprise_Group_Co",
      responseStyle: String(
        (scenarioPack.persona as { summary?: unknown } | undefined)?.summary ??
          "忙しいが高圧ではなく、浅い質問には浅く返す。"
      ),
    },
    publicBrief: String(
      scenarioPack.publicBrief ??
        phase3Setting.requestBackground ??
        "支払・経費精算寄りの人材を探している。"
    ),
    hiddenFacts: ensureDecisionStructureHiddenFact(
      Array.isArray(scenarioPack.hiddenFacts)
        ? scenarioPack.hiddenFacts.map((item: unknown) =>
            typeof item === "string"
              ? item
              : String((item as { value?: unknown }).value ?? "")
          )
        : ["背景の真因は通常運用負荷の集中にある。"]
    ),
    revealRules: ensureDecisionStructureRevealRule(
      Array.isArray(scenarioPack.revealRules)
        ? scenarioPack.revealRules.map((rule: unknown) => ({
            trigger: String((rule as { trigger?: unknown }).trigger ?? ""),
            reveals: [
              String((rule as { behavior?: unknown }).behavior ?? "").trim(),
            ].filter(Boolean),
          }))
        : []
    ),
    mustCapture: Array.isArray(scenarioPack.mustCaptureItems)
      ? scenarioPack.mustCaptureItems.map((item: unknown) => ({
          key: String((item as { key?: unknown }).key ?? ""),
          label: String((item as { description?: unknown }).description ?? ""),
          priority: "required" as const,
        }))
      : [],
    scoringRubric: Array.isArray(
      (scenarioPack.scoringRubric as { metrics?: unknown } | undefined)?.metrics
    )
      ? (
          (scenarioPack.scoringRubric as { metrics: any[] })
            .metrics
        ).map((metric: any) => ({
          key: String(metric["key"] ?? ""),
          label: String(metric["label"] ?? ""),
          weight: Number(metric["weight"] ?? 0) / 100,
          description: String(metric["description"] ?? ""),
        }))
      : [],
    openingLine: String(scenarioPack.openingLine ?? "要点だけでお願いします。"),
    provenance: Array.isArray(provenance.transcriptIds)
      ? (provenance.transcriptIds as string[]).map((transcriptId) =>
          toEvidenceRef({ transcriptId })
        )
      : [],
    publishContract: {
      companyAliasDefault: "Enterprise_Group_Co",
      optionalRuntimeVariables: stringArray(publish.runtimeVariables).length
        ? stringArray(publish.runtimeVariables)
        : [
            "learnerDisplayName",
            "sessionId",
            "scenarioId",
            "scenarioVersion",
            "testMode",
            "companyAlias",
          ],
    },
    acceptancePolicy: {
      exactTextMatchForbidden: true,
      semanticChecks: [
        "required_field_presence",
        "persona_consistency",
        "hidden_fact_coverage",
        "must_capture_coverage",
        "reveal_rule_consistency",
        "provenance_completeness",
      ],
    },
    promptSections: Object.entries(promptSections).map(([key, value]) => ({
      key: mapPromptSectionKey(key),
      title: key,
      body: rewritePromptSectionBody(key, String(value)),
    })),
  });

  const scenario = scenarioPackSchema.parse({
    id: scenarioV2.id,
    family: scenarioV2.family,
    version: scenarioV2.version,
    title: scenarioV2.title,
    language: "ja",
    difficulty: "medium",
    persona: {
      role: scenarioV2.persona.role,
      companyAlias:
        scenarioV2.publishContract.companyAliasDefault ?? "Enterprise_Group_Co",
      demeanor: scenarioV2.persona.demeanor,
      responseStyle: scenarioV2.persona.responseStyle,
    },
    publicBrief: scenarioV2.publicBrief,
    hiddenFacts: scenarioV2.hiddenFacts,
    revealRules: scenarioV2.revealRules,
    mustCaptureItems: scenarioV2.mustCapture.map((item, index) => ({
      key: item.key,
      label: item.label,
      priority: item.priority,
      canonicalOrder: index,
    })),
    rubric: scenarioV2.scoringRubric,
    closeCriteria: stringArray(scenarioPack.closeCriteria),
    openingLine: scenarioV2.openingLine,
    generatedFromPlaybookVersion: "reference_artifact_phase4_v1",
    status: "draft",
    scenarioSetting: scenarioV2.setting,
    roleSipoc: scenarioV2.sipoc,
    cultureFit: scenarioV2.cultureFit,
    topPerformerPlaybook: scenarioV2.topPerformerPlaybook,
    promptSections: scenarioV2.promptSections,
    provenance: {
      corpusId: ACCOUNTING_CORPUS_SOT_ID,
      transcriptIds: scenarioV2.provenance.map((item) => item.transcriptId),
      referenceArtifactPath: input.referencePath,
      designMemoPath: input.designMemoPath ?? ACCOUNTING_HUMAN_REFERENCE_MEMO,
    },
    publishContract: {
      companyAliasDefault: scenarioV2.publishContract.companyAliasDefault,
      runtimeVariables: scenarioV2.publishContract.optionalRuntimeVariables,
      dictionaryRequired: true,
    },
    acceptancePolicy: scenarioV2.acceptancePolicy,
  });

  const acceptance = evaluateAccountingScenarioAcceptance({
    scenario,
    scenarioV2,
    assets: compiledScenarioAssetsSchema.parse({
      scenarioId: scenarioV2.id,
      promptVersion: "accounting-compile@2026-04-08.v1",
      knowledgeBaseText: buildKnowledgeBase(scenarioV2),
      agentSystemPrompt: buildPrompt(scenarioV2),
      generatedAt: new Date().toISOString(),
      promptSections: scenarioV2.promptSections,
      platformConfig: {
        language: "ja",
        dictionaryRequired: true,
        optionalRuntimeVariables: scenarioV2.publishContract.optionalRuntimeVariables,
      },
      semanticAcceptance: {
        semanticChecks: scenarioV2.acceptancePolicy.semanticChecks,
      },
    }),
    reference,
    referencePath: input.referencePath,
  });

  const assets: CompiledScenarioAssets = compiledScenarioAssetsSchema.parse({
    scenarioId: scenarioV2.id,
    promptVersion: "accounting-compile@2026-04-08.v1",
    knowledgeBaseText: buildKnowledgeBase(scenarioV2),
    agentSystemPrompt: buildPrompt(scenarioV2),
    generatedAt: new Date().toISOString(),
    promptSections: scenarioV2.promptSections,
    platformConfig: {
      language: "ja",
      dictionaryRequired: true,
      optionalRuntimeVariables: scenarioV2.publishContract.optionalRuntimeVariables,
      companyAliasDefault: scenarioV2.publishContract.companyAliasDefault,
      dynamicVariables: {
        learnerDisplayName: "",
        sessionId: "",
        scenarioId: scenarioV2.id,
        scenarioVersion: scenarioV2.version,
        testMode: "false",
        companyAlias:
          scenarioV2.publishContract.companyAliasDefault ?? "Enterprise_Group_Co",
      },
    },
    semanticAcceptance: acceptance,
  });

  return {
    scenarioV2,
    scenario,
    assets,
    acceptance,
  };
}

export async function compileAccountingScenario(input: {
  playbook: PlaybookNorms | null;
  referenceArtifactPath: string;
  designMemoPath?: string;
}) {
  void input.playbook;
  return compileAccountingScenarioFromReference({
    referencePath: input.referenceArtifactPath,
    ...(input.designMemoPath ? { designMemoPath: input.designMemoPath } : {}),
  });
}

export async function evaluateCompiledAccountingScenario(input: {
  scenario: ScenarioPack;
  assets: CompiledScenarioAssets;
  referenceArtifactPath: string;
}) {
  const reference = await loadReferenceArtifact(input.referenceArtifactPath);
  const scenarioV2 = scenarioPackV2Schema.parse({
    id: input.scenario.id,
    family: ACCOUNTING_SCENARIO_FAMILY,
    version: input.scenario.version,
    title: input.scenario.title,
    language: "ja",
    setting: input.scenario.scenarioSetting ?? {},
    sipoc: input.scenario.roleSipoc ?? {},
    cultureFit: input.scenario.cultureFit ?? {},
    topPerformerPlaybook: input.scenario.topPerformerPlaybook ?? [],
    persona: input.scenario.persona,
    publicBrief: input.scenario.publicBrief,
    hiddenFacts: input.scenario.hiddenFacts,
    revealRules: input.scenario.revealRules,
    mustCapture: input.scenario.mustCaptureItems.map((item) => ({
      key: item.key,
      label: item.label,
      priority: item.priority,
    })),
    scoringRubric: input.scenario.rubric,
    openingLine: input.scenario.openingLine,
    provenance: (input.scenario.provenance?.transcriptIds ?? []).map((transcriptId) => ({
      transcriptId,
      sourceRecordId: transcriptId,
      turnIds: ["reference_only"],
    })),
    publishContract: {
      companyAliasDefault: input.scenario.publishContract?.companyAliasDefault,
      optionalRuntimeVariables: input.scenario.publishContract?.runtimeVariables ?? [],
    },
    acceptancePolicy:
      input.scenario.acceptancePolicy ?? {
        exactTextMatchForbidden: true,
        semanticChecks: [
          "required_field_presence",
          "persona_consistency",
          "hidden_fact_coverage",
          "must_capture_coverage",
          "reveal_rule_consistency",
          "provenance_completeness",
        ],
      },
    promptSections: (input.scenario.promptSections ?? []).map((section) => ({
      key: mapPromptSectionKey(section.title),
      title: section.title,
      body: section.body,
    })),
  });

  return evaluateAccountingScenarioAcceptance({
    scenario: input.scenario,
    scenarioV2,
    assets: input.assets,
    reference,
    referencePath: input.referenceArtifactPath,
  });
}
