import {
  ACCOUNTING_GRADE_SESSION_PROMPT_VERSION,
  scorecardSchema,
  type PlaybookNorms,
  type ScenarioPack,
  type Scorecard,
  type SessionTurn,
} from "@top-performer/domain";
import type { OpenAiResponsesClient } from "@top-performer/vendors";
import { z } from "zod";
import { buildDrills } from "./buildDrills";
import { loadPromptAsset } from "./promptLoader";

type GradeAccountingSessionInput = {
  client: OpenAiResponsesClient;
  model: string;
  sessionId: string;
  scenario: ScenarioPack;
  playbook: PlaybookNorms;
  turns: SessionTurn[];
};

const llmEvaluationKeySchema = z.enum([
  "natural_japanese",
  "busy_but_not_hostile",
  "no_coaching",
  "close_quality",
  "captures_culture_fit",
  "captures_judgement_work",
]);

const llmEvaluationSchema = z.object({
  key: llmEvaluationKeySchema,
  passed: z.boolean(),
  notes: z.string().min(1),
  score: z.number().min(0).max(100),
});

const accountingAssessmentResponseSchema = z.object({
  summary: z.string().min(1),
  strengths: z.array(z.string().min(1)).default([]),
  misses: z.array(z.string().min(1)).default([]),
  missedQuestions: z.array(z.string().min(1)).default([]),
  evaluations: z.array(llmEvaluationSchema),
  qualitySignals: z.object({
    deepDiveQuality: z.number().min(0).max(100),
    judgementWorkCapture: z.number().min(0).max(100),
    cultureFitCapture: z.number().min(0).max(100),
    revealEfficiency: z.number().min(0).max(100),
    closeQuality: z.number().min(0).max(100),
  }),
});

const accountingAssessmentJsonSchema = z.toJSONSchema(
  accountingAssessmentResponseSchema
);

type RuleCheck = {
  key:
    | "no_hidden_fact_leak"
    | "reveal_budget_flexibility"
    | "reveal_urgency"
    | "reveal_decision_structure"
    | "shallow_question_stays_shallow";
  passed: boolean;
  notes: string;
};

type MustCapturePattern = {
  strong: RegExp[];
  partial: RegExp[];
};

const mustCapturePatterns: Record<string, MustCapturePattern> = {
  true_hiring_background: {
    strong: [/ERP|移行|再編|内製|体制強化/i, /背景|真因|なぜ|理由/i],
    partial: [/背景|理由|なぜ/i, /体制強化|増員|欠員/i],
  },
  scope_split: {
    strong: [/AP|支払|経費精算|請求書|固定資産|月次/i],
    partial: [/業務範囲|担当|どこまで/i, /支払|経費精算|請求書/i],
  },
  judgement_level: {
    strong: [/判断|一次判断|税区分|勘定科目|差戻し|例外/i],
    partial: [/入力だけ|レベル|判断/i],
  },
  team_structure: {
    strong: [/体制|人数|チーム|ユニット|誰と働/i],
    partial: [/人数|チーム/i],
  },
  internal_external_split: {
    strong: [/BPO|外注|アウトソース|社内|内製/i],
    partial: [/外部|社内|分担/i],
  },
  volume_and_peaks: {
    strong: [/件数|月末|月初|締め|繁忙/i],
    partial: [/ボリューム|忙しい|ピーク/i],
  },
  system_environment: {
    strong: [/ERP|Oracle|SAP|OBIC|システム|経費精算ツール/i],
    partial: [/会計システム|ツール/i],
  },
  onboarding_and_manual: {
    strong: [/OJT|マニュアル|立ち上がり|引継ぎ|初期出社/i],
    partial: [/オンボーディング|フォロー/i],
  },
  workstyle_conditions: {
    strong: [/在宅|出社|残業|日数|時間/i],
    partial: [/働き方|条件/i],
  },
  culture_fit: {
    strong: [/カルチャー|雰囲気|合わない|馴染|ベテラン|女性/i],
    partial: [/相性|チームプレイ/i],
  },
  flexibility_range: {
    strong: [/緩和|相談余地|優先順位|必須|歓迎/i],
    partial: [/調整|相談/i],
  },
  next_step_alignment: {
    strong: [/要約|まとめると|候補者像|次回|ご提案/i],
    partial: [/次の進め方|次回/i],
  },
};

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function turnIdsMatchingPatterns(turns: SessionTurn[], patterns: RegExp[]) {
  return turns
    .filter((turn) => patterns.some((pattern) => pattern.test(turn.text)))
    .map((turn) => turn.turnId);
}

function evaluateMustCapture(turns: SessionTurn[], key: string) {
  const pattern = mustCapturePatterns[key];
  if (!pattern) {
    return {
      status: "missed" as const,
      evidenceTurnIds: [],
      score: 0,
    };
  }

  const strongTurnIds = turnIdsMatchingPatterns(turns, pattern.strong);
  if (strongTurnIds.length > 0) {
    return {
      status: "captured" as const,
      evidenceTurnIds: strongTurnIds,
      score: 100,
    };
  }

  const partialTurnIds = turnIdsMatchingPatterns(turns, pattern.partial);
  if (partialTurnIds.length > 0) {
    return {
      status: "partial" as const,
      evidenceTurnIds: partialTurnIds,
      score: 55,
    };
  }

  return {
    status: "missed" as const,
    evidenceTurnIds: [],
    score: 0,
  };
}

function hasQuestion(turns: SessionTurn[], patterns: RegExp[]) {
  return turns.some((turn) => patterns.some((pattern) => pattern.test(turn.text)));
}

function countHiddenFactMentions(text: string, hiddenFacts: string[]) {
  const lowered = text.toLowerCase();
  const lexemes = hiddenFacts
    .flatMap((fact) => normalizeText(fact).split(/[、。,・/\s]+/))
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3);

  return new Set(lexemes.filter((token) => lowered.includes(token))).size;
}

function evaluateRuleChecks(input: {
  scenario: ScenarioPack;
  userTurns: SessionTurn[];
  avatarTurns: SessionTurn[];
}): RuleCheck[] {
  const firstAvatarTurns = input.avatarTurns.slice(0, 2);
  const earlyLeak = firstAvatarTurns.some(
    (turn) => countHiddenFactMentions(turn.text, input.scenario.hiddenFacts) >= 4
  );

  const askedBudget = hasQuestion(input.userTurns, [
    /予算|時給|単価|相談余地|緩和/i,
  ]);
  const revealedBudget = askedBudget
    ? hasQuestion(input.avatarTurns, [/相談余地|調整|厳し|柔軟|上限/i])
    : true;

  const askedUrgency = hasQuestion(input.userTurns, [
    /いつまで|開始時期|充足期限|急ぎ|締め/i,
  ]);
  const revealedUrgency = askedUrgency
    ? hasQuestion(input.avatarTurns, [/今月末|来月|早め|急ぎ|影響/i])
    : true;

  const askedDecision = hasQuestion(input.userTurns, [/決裁|承認|誰が決め|選考/i]);
  const revealedDecision = askedDecision
    ? hasQuestion(input.avatarTurns, [/部門長|承認|決裁|マネジャー|上長/i])
    : true;

  const shallowUserTurn = input.userTurns.find((turn) =>
    /人数|何名|経理事務|支払|経費精算/i.test(turn.text)
  );
  const shallowReply = shallowUserTurn
    ? input.avatarTurns.find(
        (turn) => turn.relativeTimestamp >= shallowUserTurn.relativeTimestamp
      )
    : undefined;
  const shallowReplyLeakCount = shallowReply
    ? countHiddenFactMentions(shallowReply.text, input.scenario.hiddenFacts)
    : 0;

  return [
    {
      key: "no_hidden_fact_leak",
      passed: !earlyLeak,
      notes: earlyLeak
        ? "冒頭の返答で hidden facts が過剰に開示されています。"
        : "冒頭では公開情報中心に留まっています。",
    },
    {
      key: "reveal_budget_flexibility",
      passed: revealedBudget,
      notes: askedBudget
        ? revealedBudget
          ? "予算や条件緩和の質問に対し、相談余地が自然に返されています。"
          : "予算・条件緩和の質問があったのに、柔軟性の返答が不足しています。"
        : "予算柔軟性に関する直接質問がありませんでした。",
    },
    {
      key: "reveal_urgency",
      passed: revealedUrgency,
      notes: askedUrgency
        ? revealedUrgency
          ? "開始時期や期限の確認に対し、実務上の緊急度が返されています。"
          : "緊急度を問われた場面で十分な具体化がありません。"
        : "緊急度に踏み込む質問は見当たりませんでした。",
    },
    {
      key: "reveal_decision_structure",
      passed: revealedDecision,
      notes: askedDecision
        ? revealedDecision
          ? "決裁構造に関する質問で承認経路が返されています。"
          : "決裁構造を聞いているのに承認経路が曖昧です。"
        : "決裁構造を問う質問は見当たりませんでした。",
    },
    {
      key: "shallow_question_stays_shallow",
      passed: shallowReplyLeakCount <= 3,
      notes:
        shallowReply && shallowReplyLeakCount > 3
          ? "浅い質問に対して hidden facts が過剰に返されています。"
          : "浅い質問に対しては情報量が適切に抑えられています。",
    },
  ];
}

function toRubricKeySignalMap(input: {
  requiredQuestions: number;
  deepDiveQuality: number;
  judgementWorkCapture: number;
  cultureFitCapture: number;
  conditionsStructuring: number;
  revealEfficiency: number;
  closeQuality: number;
}) {
  return {
    required_questions: input.requiredQuestions,
    deep_dive_quality: input.deepDiveQuality,
    judgement_work_capture: input.judgementWorkCapture,
    culture_fit_capture: input.cultureFitCapture,
    conditions_structuring: input.conditionsStructuring,
    reveal_efficiency: input.revealEfficiency,
    close_quality: input.closeQuality,
  } as const;
}

export async function gradeAccountingSession(
  input: GradeAccountingSessionInput
): Promise<Scorecard> {
  if (input.scenario.family !== "accounting_clerk_enterprise_ap") {
    throw new Error(
      "gradeAccountingSession only supports accounting_clerk_enterprise_ap."
    );
  }

  const prompt = await loadPromptAsset("grade-accounting-session.md");
  const userTurns = input.turns.filter((turn) => turn.role === "user");
  const avatarTurns = input.turns.filter((turn) => turn.role === "avatar");

  const mustCaptureResults = input.scenario.mustCaptureItems.map((item) => {
    const evaluated = evaluateMustCapture(userTurns, item.key);
    return {
      key: item.key,
      label: item.label,
      status: evaluated.status,
      evidenceTurnIds: evaluated.evidenceTurnIds,
      score: evaluated.score,
    };
  });

  const requiredMustCaptures = mustCaptureResults.filter(
    (_, index) => input.scenario.mustCaptureItems[index]?.priority === "required"
  );
  const requiredQuestions = Math.round(
    average(requiredMustCaptures.map((item) => item.score))
  );
  const judgementWorkCapture =
    mustCaptureResults.find((item) => item.key === "judgement_level")?.score ?? 0;
  const cultureFitByRules =
    mustCaptureResults.find((item) => item.key === "culture_fit")?.score ?? 0;
  const conditionsStructuring = Math.round(
    average(
      mustCaptureResults
        .filter((item) =>
          ["workstyle_conditions", "onboarding_and_manual", "flexibility_range"].includes(
            item.key
          )
        )
        .map((item) => item.score)
    )
  );

  const ruleChecks = evaluateRuleChecks({
    scenario: input.scenario,
    userTurns,
    avatarTurns,
  });
  const ruleRevealEfficiency = Math.round(
    average(ruleChecks.map((item) => (item.passed ? 100 : 35)))
  );

  const llmAssessment = await input.client.createStructuredOutput({
    model: input.model,
    schemaName: "accounting_scorecard_v2",
    jsonSchema: accountingAssessmentJsonSchema,
    responseSchema: accountingAssessmentResponseSchema,
    systemPrompt: prompt,
    userPrompt: JSON.stringify(
      {
        promptVersion: ACCOUNTING_GRADE_SESSION_PROMPT_VERSION,
        sessionId: input.sessionId,
        scenario: input.scenario,
        playbook: input.playbook,
        turns: input.turns,
        ruleChecks,
        mustCaptureSeed: mustCaptureResults.map((item) => ({
          key: item.key,
          label: item.label,
          status: item.status,
          evidenceTurnIds: item.evidenceTurnIds,
        })),
      },
      null,
      2
    ),
  });

  const evaluationBreakdown = [
    ...ruleChecks.map((check) => ({
      key: check.key,
      method: "rule_based" as const,
      passed: check.passed,
      notes: check.notes,
    })),
    ...llmAssessment.evaluations.map((evaluation) => ({
      key: evaluation.key,
      method: "llm_based" as const,
      passed: evaluation.passed,
      notes: evaluation.notes,
    })),
  ];

  const qualitySignals = {
    requiredQuestions,
    deepDiveQuality: llmAssessment.qualitySignals.deepDiveQuality,
    judgementWorkCapture: Math.round(
      average([
        judgementWorkCapture,
        llmAssessment.qualitySignals.judgementWorkCapture,
      ])
    ),
    cultureFitCapture: Math.round(
      average([cultureFitByRules, llmAssessment.qualitySignals.cultureFitCapture])
    ),
    conditionsStructuring,
    revealEfficiency: Math.round(
      average([ruleRevealEfficiency, llmAssessment.qualitySignals.revealEfficiency])
    ),
    closeQuality: llmAssessment.qualitySignals.closeQuality,
  };

  const rubricSignalMap = toRubricKeySignalMap(qualitySignals);
  const rubricScores = input.scenario.rubric.map((rubric) => ({
    key: rubric.key,
    label: rubric.label,
    score: Math.round(rubricSignalMap[rubric.key as keyof typeof rubricSignalMap] ?? 0),
    weight: rubric.weight,
    evidenceTurnIds:
      rubric.key === "required_questions"
        ? mustCaptureResults.flatMap((item) => item.evidenceTurnIds).slice(0, 6)
        : rubric.key === "close_quality"
          ? input.turns.slice(-3).map((turn) => turn.turnId)
          : userTurns.slice(0, 6).map((turn) => turn.turnId),
    rationale:
      rubric.key === "required_questions"
        ? "must-capture の取得状況と evidence を基に算出。"
        : rubric.key === "deep_dive_quality"
          ? "真因・判断レベル・分担まで掘れているかを総合評価。"
          : rubric.key === "judgement_work_capture"
            ? "入力作業を超える判断業務の把握度を評価。"
            : rubric.key === "culture_fit_capture"
              ? "チームの雰囲気、NG人物像、enterprise 会計の相性確認を評価。"
              : rubric.key === "conditions_structuring"
                ? "働き方や条件の優先順位を整理できているかを評価。"
                : rubric.key === "reveal_efficiency"
                  ? "浅い質問と深い質問への返答差を踏まえた情報引き出し力を評価。"
                  : "要約と次アクションの自然さを評価。",
  }));

  const overallScore = Math.round(
    rubricScores.reduce((sum, rubric) => sum + rubric.score * rubric.weight, 0)
  );
  const topPerformerAlignmentScore = Math.round(
    average(Object.values(qualitySignals))
  );

  const parsed = scorecardSchema.parse({
    sessionId: input.sessionId,
    scenarioId: input.scenario.id,
    overallScore,
    topPerformerAlignmentScore,
    rubricScores,
    mustCaptureResults: mustCaptureResults.map((item) => ({
      key: item.key,
      label: item.label,
      status: item.status,
      evidenceTurnIds: item.evidenceTurnIds,
    })),
    strengths: llmAssessment.strengths,
    misses: llmAssessment.misses,
    missedQuestions: llmAssessment.missedQuestions,
    nextDrills: [],
    summary: llmAssessment.summary,
    generatedAt: new Date().toISOString(),
    promptVersion: ACCOUNTING_GRADE_SESSION_PROMPT_VERSION,
    evaluationMode: "accounting_v2",
    qualitySignals,
    evaluationBreakdown,
  });

  return {
    ...parsed,
    nextDrills: buildDrills({
      scenario: input.scenario,
      scorecard: parsed,
    }),
  };
}
