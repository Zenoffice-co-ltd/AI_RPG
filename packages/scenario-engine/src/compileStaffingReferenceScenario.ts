import { readFile } from "node:fs/promises";
import {
  ADECCO_MANUFACTURER_SCENARIO_ID,
  ADECCO_MANUFACTURER_SCENARIO_TITLE,
  COMPILE_SCENARIO_PROMPT_VERSION,
  compiledScenarioAssetsSchema,
  scenarioPackSchema,
  type CompiledScenarioAssets,
  type ScenarioPack,
} from "@top-performer/domain";

type ReferenceArtifact = {
  meta?: Record<string, unknown>;
  phase3?: Record<string, unknown>;
  phase4?: {
    scenarioPack?: Record<string, unknown>;
  };
};

const STAFFING_REFERENCE_PROMPT_VERSION =
  `${COMPILE_SCENARIO_PROMPT_VERSION}.staffing-reference-adecco-v1`;

const ADECCO_MUST_CAPTURE_ITEMS: Array<{
  key: string;
  label: string;
  priority: "required" | "recommended";
}> = [
  { key: "hiring_background", label: "募集背景", priority: "required" },
  {
    key: "increase_or_replacement_reason",
    label: "増員/交代と理由",
    priority: "required",
  },
  {
    key: "role_and_task_scope",
    label: "職種・業務の大枠",
    priority: "required",
  },
  {
    key: "task_details_and_daily_flow",
    label: "業務内容・1日の流れ",
    priority: "required",
  },
  {
    key: "judgement_and_exception_level",
    label: "入力/調整/例外判断の線引き",
    priority: "required",
  },
  {
    key: "internal_staff_split",
    label: "社員が持つ業務と派遣に任せる業務の線引き",
    priority: "required",
  },
  {
    key: "volume_and_peak_cycle",
    label: "業務量・繁忙サイクル",
    priority: "required",
  },
  {
    key: "handover_method_and_period",
    label: "引継ぎ方法・期間",
    priority: "required",
  },
  {
    key: "start_date_and_term",
    label: "就業開始日・期間",
    priority: "required",
  },
  {
    key: "work_days_hours_break",
    label: "就業曜日・時間・休憩",
    priority: "required",
  },
  { key: "overtime", label: "残業", priority: "required" },
  {
    key: "remote_work_frequency",
    label: "リモート有無・頻度",
    priority: "required",
  },
  {
    key: "billing_and_transportation",
    label: "請求金額・交通費",
    priority: "required",
  },
  {
    key: "direct_hire_possibility",
    label: "直接雇用の可能性",
    priority: "recommended",
  },
  {
    key: "must_best_priority",
    label: "必須条件 / ベスト要件 / 優先順位",
    priority: "required",
  },
  {
    key: "certification_and_oa_skills",
    label: "資格・OAスキル",
    priority: "required",
  },
  {
    key: "department_composition",
    label: "部署人数・男女比・派遣社員有無",
    priority: "required",
  },
  {
    key: "average_age",
    label: "平均年齢層",
    priority: "recommended",
  },
  { key: "dress_code", label: "服装", priority: "recommended" },
  {
    key: "lunch_breakroom_facilities",
    label: "昼食・休憩室・施設",
    priority: "recommended",
  },
  {
    key: "supervisor_personality",
    label: "指揮命令者の人柄",
    priority: "required",
  },
  {
    key: "team_atmosphere",
    label: "部署の雰囲気",
    priority: "required",
  },
  {
    key: "competing_agencies",
    label: "競合他社依頼状況",
    priority: "required",
  },
  {
    key: "exclusive_window_negotiation",
    label: "独占期間の設定交渉",
    priority: "required",
  },
  {
    key: "workplace_visit_timing",
    label: "職場見学日時",
    priority: "required",
  },
  {
    key: "post_visit_decision_process",
    label: "見学後の決定プロセス",
    priority: "required",
  },
  {
    key: "preferred_contact_method",
    label: "ベターな連絡方法",
    priority: "required",
  },
  {
    key: "future_schedule",
    label: "今後のスケジュール",
    priority: "required",
  },
  {
    key: "specific_next_action_due_date",
    label: "具体的なネクストアクションと期日",
    priority: "required",
  },
];

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function asString(input: unknown, fallback = "") {
  return typeof input === "string" && input.trim().length > 0
    ? input
    : fallback;
}

function asStringArray(input: unknown) {
  return Array.isArray(input)
    ? input.map((item) => String(item)).filter((item) => item.length > 0)
    : [];
}

function mapHiddenFacts(input: unknown) {
  if (!Array.isArray(input)) {
    return ["現行ベンダーの供給力と営業対応に不満があり、新規ベンダー比較を進めている。"];
  }

  return input
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      const record = asRecord(item);
      const value = asString(record["value"]);
      const condition = asString(record["revealCondition"]);
      const key = asString(record["key"]);
      return [
        key ? `${key}: ${value}` : value,
        condition ? `開示条件: ${condition}` : "",
      ]
        .filter(Boolean)
        .join(" / ");
    })
    .filter((item) => item.length > 0);
}

function mapRevealRules(input: unknown) {
  if (!Array.isArray(input)) {
    return [
      {
        trigger: "浅い質問のみ",
        reveals: ["聞かれた範囲だけを短く返し、hidden facts は早出ししない。"],
      },
    ];
  }

  return input
    .map((item) => {
      const record = asRecord(item);
      const mustNotLeakEarly = record["mustNotLeakEarly"] === true;
      const behavior = asString(record["behavior"]);
      return {
        trigger: asString(record["trigger"], "深掘りされた時"),
        reveals: [
          mustNotLeakEarly ? "早出し禁止" : "開示可",
          behavior,
        ].filter(Boolean),
      };
    })
    .filter((rule) => rule.trigger.length > 0 && rule.reveals.length > 0);
}

function mapRubric(input: unknown) {
  const metrics = asRecord(input)["metrics"];
  if (!Array.isArray(metrics)) {
    return [];
  }

  return metrics.map((metric) => {
    const record = asRecord(metric);
    return {
      key: asString(record["key"]),
      label: asString(record["label"]),
      weight: Number(record["weight"]),
      description: asString(record["description"]),
    };
  });
}

function mapPromptSections(input: unknown) {
  const sections = asRecord(input);
  return Object.entries(sections)
    .filter(([, body]) => typeof body === "string" && body.length > 0)
    .map(([key, body]) => ({
      key,
      title: key,
      body: rewritePromptSection(key, String(body)),
    }));
}

function rewritePromptSection(title: string, body: string) {
  if (title === "Context") {
    return "Adeccoは社名認知はあるが初回発注前です。まずは営業事務1名の相談として、要件整理の進め方を見ています。競合状況、予算、決定構造、現行ベンダー不満の詳細は、具体的に聞かれた時だけ開示してください。";
  }
  if (title === "Must Capture Items") {
    return "営業学習者から確認された範囲にだけ自然に答えてください。背景、業務分解、入力だけか調整・例外判断まで含むか、社員が持つ業務と派遣に任せる業務の線引き、繁忙、条件、優先順位、競合、見学・決定フローを段階的に返してください。自分から確認項目を一覧化したり、次に聞くべき質問を教えたりしないでください。";
  }
  return body;
}

function buildKnowledgeBaseText(input: {
  scenario: ScenarioPack;
  referenceScenarioPack: Record<string, unknown>;
}) {
  return [
    "# Scenario",
    `Title: ${input.scenario.title}`,
    `Scenario ID: ${input.scenario.id}`,
    `Family: ${input.scenario.family}`,
    "",
    "## Public Brief",
    input.scenario.publicBrief,
    "",
    "## Persona",
    `Role: ${input.scenario.persona.role}`,
    `Company Alias: ${input.scenario.persona.companyAlias}`,
    `Response Style: ${input.scenario.persona.responseStyle}`,
    "",
    "## Hidden Facts",
    ...input.scenario.hiddenFacts.map((fact) => `- ${fact}`),
    "",
    "## Reveal Rules",
    ...input.scenario.revealRules.map(
      (rule) => `- ${rule.trigger}: ${rule.reveals.join(" / ")}`
    ),
    "",
    "## Must Capture Items",
    ...input.scenario.mustCaptureItems.map(
      (item) => `- [${item.priority}] ${item.label} (#${item.canonicalOrder})`
    ),
    "",
    "## Close Criteria",
    ...input.scenario.closeCriteria.map((item) => `- ${item}`),
    "",
    "## Reference Setting",
    JSON.stringify(input.referenceScenarioPack["setting"] ?? {}, null, 2),
  ].join("\n");
}

function buildAgentPrompt(input: {
  scenario: ScenarioPack;
  promptSections: Array<{ title: string; body: string }>;
}) {
  const sectionText = input.promptSections
    .map((section) => `# ${section.title}\n${section.body}`)
    .join("\n\n");

  return [
    "# Critical Live Behavior",
    "あなたは営業学習者を助けるコーチではなく、住宅設備メーカーの人事課主任です。",
    "『何を聞けばよいですか？』と聞かれても、確認項目を列挙せず『気になる点から順番にご確認ください』または『どの点についてですか』と短く返してください。",
    "『今回の募集について概要を教えてください』と聞かれたら『営業事務を1名お願いする相談です。まずは要件を整理したいです。』程度に留め、競合、予算、決定構造、ベンダー不満は出さないでください。",
    "業務を深掘りされたら、enterprise ERP案件と同じく、職種名で止めずに、入力作業と納期調整・在庫不足・品番不一致などの例外対応の線引き、社員側に残す判断業務を段階的に開示してください。",
    "『次はどのように進めましょうか？』と聞かれたら、顧客側として『条件に近い方を何名かご提案ください。こちらでも確認するので、まずはメールで候補者を見せていただけると助かります。』のように自然な次アクションだけを返してください。",
    "営業学習者が要件要約とネクストアクションを提示したら、営業の要約後に必ず一度だけ『Adeccoさんの派遣の特徴や強み、他社との違いはどこですか』と顧客側から逆質問してください。",
    "人数だけを聞かれたら『まずは1名です。』程度で止め、業務内容、競合、予算、決定構造を続けて説明しないでください。",
    "",
    sectionText,
    "",
    "# Runtime Guardrails",
    "あなたは派遣オーダーヒアリングに登場する住宅設備メーカーの人事課主任です。",
    "営業学習者を採点したり、営業をコーチしないでください。",
    "浅い質問には浅く返し、聞かれていない hidden facts を早出ししないでください。",
    "概要だけを聞かれたら、営業事務1名の相談であることと初回取引前に要件整理したいことだけを短く返し、競合、予算、決定構造、ベンダー不満の詳細は出さないでください。",
    "深掘りされた時だけ、reference の reveal rules に従って制約や本音を段階開示してください。",
    "人事窓口として即答できない現場詳細は、現場確認が必要と自然に返してください。",
    "営業学習者の要約後、終盤で要件整理とネクストアクションが進んだら、Adecco の派遣の特徴や強み、他社との違いを必ず一度逆質問してください。",
    "一問一答の箇条書きではなく、自然な日本語のビジネス会話で1〜3文を基本に返してください。",
    "",
    "# Opening Line",
    input.scenario.openingLine,
  ]
    .filter((item) => item.length > 0)
    .join("\n");
}

async function loadReferenceArtifact(referencePath: string) {
  const raw = await readFile(referencePath, "utf8");
  return JSON.parse(raw) as ReferenceArtifact;
}

export async function compileStaffingReferenceScenario(input: {
  referenceArtifactPath: string;
}) {
  const reference = await loadReferenceArtifact(input.referenceArtifactPath);
  const referenceScenarioPack = asRecord(reference.phase4?.scenarioPack);
  const publish = asRecord(referenceScenarioPack["publish"]);
  const promptSections = mapPromptSections(publish["systemPromptSections"]);
  const provenance = asRecord(referenceScenarioPack["provenance"]);
  const transcriptIds = asStringArray(provenance["transcriptIds"]);

  const scenario = scenarioPackSchema.parse({
    id: ADECCO_MANUFACTURER_SCENARIO_ID,
    family: "staffing_order_hearing",
    version: asString(referenceScenarioPack["version"], "v1.0.0"),
    title: asString(referenceScenarioPack["title"], ADECCO_MANUFACTURER_SCENARIO_TITLE),
    language: "ja",
    difficulty: "medium",
    persona: {
      role: "人事課主任",
      companyAlias: "Adecco_Manufacturer_Client",
      demeanor: "busy",
      responseStyle: [
        "ニュートラルで落ち着いたビジネス口調。",
        "聞かれた範囲で端的に答え、浅い質問には浅く返す。",
        "人事窓口のため現場詳細は即答できない場合がある。",
        "終盤で Adecco の強みと他社との違いを逆質問する。",
      ].join(""),
    },
    publicBrief:
      "住宅設備メーカーの人事課主任として、営業事務1名の派遣オーダーについて初回発注前に要件整理をしたい。",
    hiddenFacts: mapHiddenFacts(referenceScenarioPack["hiddenFacts"]),
    revealRules: mapRevealRules(referenceScenarioPack["revealRules"]),
    mustCaptureItems: ADECCO_MUST_CAPTURE_ITEMS.map((item, index) => ({
      ...item,
      canonicalOrder: index,
    })),
    rubric: mapRubric(referenceScenarioPack["scoringRubric"]),
    closeCriteria: asStringArray(referenceScenarioPack["closeCriteria"]),
    openingLine: asString(
      referenceScenarioPack["openingLine"],
      "お時間ありがとうございます。今回は新しい派遣会社さんとして一度お話を伺いたいと思っています。"
    ),
    generatedFromPlaybookVersion: "adecco_manufacturer_reference_phase4_v1",
    status: "draft",
    scenarioSetting: asRecord(referenceScenarioPack["setting"]),
    roleSipoc: asRecord(referenceScenarioPack["sipoc"]),
    cultureFit: asRecord(referenceScenarioPack["cultureFit"]),
    topPerformerPlaybook: Array.isArray(referenceScenarioPack["topPerformerPlaybook"])
      ? (referenceScenarioPack["topPerformerPlaybook"] as Record<string, unknown>[])
      : [],
    promptSections,
    provenance: {
      corpusId: "adecco_manufacturer_order_hearing_reference_v1",
      transcriptIds: transcriptIds.length > 0 ? transcriptIds : ["manual_request_only"],
      referenceArtifactPath: input.referenceArtifactPath,
    },
    publishContract: {
      companyAliasDefault: "Adecco_Manufacturer_Client",
      runtimeVariables: asStringArray(publish["runtimeVariables"]),
      dictionaryRequired: false,
    },
    acceptancePolicy: {
      exactTextMatchForbidden: true,
      semanticChecks: [
        "required_field_presence",
        "hidden_fact_coverage",
        "must_capture_coverage",
        "reveal_rule_consistency",
      ],
    },
  });

  const assets: CompiledScenarioAssets = compiledScenarioAssetsSchema.parse({
    scenarioId: scenario.id,
    promptVersion: STAFFING_REFERENCE_PROMPT_VERSION,
    knowledgeBaseText: buildKnowledgeBaseText({
      scenario,
      referenceScenarioPack,
    }),
    agentSystemPrompt: buildAgentPrompt({
      scenario,
      promptSections,
    }),
    generatedAt: new Date().toISOString(),
    promptSections,
    platformConfig: {
      language: "ja",
      dictionaryRequired: false,
      optionalRuntimeVariables: scenario.publishContract?.runtimeVariables ?? [],
      companyAliasDefault: scenario.publishContract?.companyAliasDefault,
      dynamicVariables: {
        learnerDisplayName: "",
        sessionId: "",
        scenarioId: scenario.id,
        scenarioVersion: scenario.version,
        testMode: "false",
      },
    },
    semanticAcceptance: {
      referenceArtifactPath: input.referenceArtifactPath,
      requiredFieldPresence: true,
      exactTextMatchForbidden: true,
    },
  });

  return {
    scenario,
    assets,
  };
}
