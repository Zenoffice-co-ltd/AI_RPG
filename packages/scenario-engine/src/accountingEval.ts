import type { CompiledScenarioAssets, ScenarioPack } from "@top-performer/domain";
import { ACCOUNTING_SCENARIO_FAMILY } from "@top-performer/domain";
import type { OpenAiResponsesClient } from "@top-performer/vendors";
import { z } from "zod";

const llmEvalResponseSchema = z.object({
  evaluations: z
    .array(
      z.object({
        key: z.enum([
          "natural_japanese",
          "busy_but_not_hostile",
          "no_coaching",
          "close_quality",
          "captures_culture_fit",
          "captures_judgement_work",
        ]),
        method: z.literal("llm_based"),
        passed: z.boolean(),
        notes: z.string().min(1),
      })
    )
    .length(6),
  summary: z.string().min(1),
});

const llmEvalJsonSchema = z.toJSONSchema(llmEvalResponseSchema);

type LocalEvalItem = {
  key: string;
  method: "rule_based" | "llm_based";
  passed: boolean;
  notes: string;
};

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalize(text: string) {
  return text.toLowerCase();
}

function tokenize(text: string) {
  return Array.from(
    new Set(
      (normalize(text).match(/[a-z0-9]+|[一-龠ぁ-んァ-ヶー]{2,}/g) ?? []).filter(
        (token) => token.length >= 2
      )
    )
  );
}

function collectNonHiddenPromptText(scenario: ScenarioPack) {
  const excluded = new Set(["hidden_facts", "reveal_rules"]);
  return (scenario.promptSections ?? [])
    .filter((section) => !excluded.has(section.key))
    .map((section) => section.body)
    .join("\n");
}

function evaluateRuleBasedScenarioChecks(
  scenario: ScenarioPack,
  assets: CompiledScenarioAssets
) {
  const nonHiddenPromptText = normalize(collectNonHiddenPromptText(scenario));
  const fullPromptText = normalize(assets.agentSystemPrompt);
  const hiddenFactsText = normalize(scenario.hiddenFacts.join("\n"));
  const openingLine = normalize(scenario.openingLine);
  const publicBrief = normalize(scenario.publicBrief);

  const budgetPatterns = [/予算/, /時給/, /単価/, /緩和/, /相談余地/];
  const urgencyPatterns = [/開始時期/, /締め/, /期限/, /緊急/, /急ぎ/];
  const decisionPatterns = [/決裁/, /承認/, /部門長/, /誰が決め/];

  const hasShallowGuardrail =
    /浅い質問には浅い回答/.test(assets.agentSystemPrompt) ||
    /必要以上には.*広げません/.test(assets.agentSystemPrompt);
  const hiddenFactLeak = scenario.hiddenFacts.some((fact) => {
    const tokens = tokenize(fact);
    if (tokens.length < 2) {
      return false;
    }
    const hits = tokens.filter(
      (token) =>
        nonHiddenPromptText.includes(token) ||
        openingLine.includes(token) ||
        publicBrief.includes(token)
    ).length;
    return hits >= Math.max(2, Math.ceil(tokens.length * 0.6));
  });

  return [
    {
      key: "no_hidden_fact_leak",
      method: "rule_based" as const,
      passed: !hiddenFactLeak,
      notes: !hiddenFactLeak
        ? "hidden fact は hidden_facts / reveal_rules 以外の公開系セクションへ直接展開されていません。"
        : "hidden fact の全文が公開系 prompt section または opening/public brief に漏れています。",
    },
    {
      key: "reveal_budget_flexibility",
      method: "rule_based" as const,
      passed:
        containsAny(hiddenFactsText, budgetPatterns) ||
        containsAny(fullPromptText, budgetPatterns),
      notes:
        "予算・単価・条件緩和に関する情報が hidden facts と agent prompt の両方で保持されているかを確認しました。",
    },
    {
      key: "reveal_urgency",
      method: "rule_based" as const,
      passed:
        containsAny(hiddenFactsText, urgencyPatterns) ||
        containsAny(fullPromptText, urgencyPatterns),
      notes:
        "開始時期・締め・期限・緊急度に関する情報が reveal 対象として保持されているかを確認しました。",
    },
    {
      key: "reveal_decision_structure",
      method: "rule_based" as const,
      passed:
        containsAny(hiddenFactsText, decisionPatterns) ||
        containsAny(fullPromptText, decisionPatterns),
      notes:
        "決裁・承認構造に関する情報が prompt 上で表現されているかを確認しました。",
    },
    {
      key: "shallow_question_stays_shallow",
      method: "rule_based" as const,
      passed: hasShallowGuardrail,
      notes: hasShallowGuardrail
        ? "浅い質問に対して浅く返す guardrail が prompt に含まれています。"
        : "浅い質問で shallow response に留める guardrail が prompt から読み取れません。",
    },
  ];
}

function evaluateSemanticAcceptance(scenario: ScenarioPack) {
  const promptSections = scenario.promptSections ?? [];

  return {
    requiredFieldPresence:
      scenario.hiddenFacts.length > 0 &&
      scenario.mustCaptureItems.length > 0 &&
      scenario.rubric.length > 0 &&
      promptSections.length > 0,
    personaConsistency:
      scenario.persona.demeanor === "busy" &&
      scenario.persona.responseStyle.length > 0,
    hiddenFactCoverage: scenario.hiddenFacts.length >= 3,
    mustCaptureCoverage: scenario.mustCaptureItems.length >= 8,
    revealRuleConsistency: scenario.revealRules.length >= 3,
    provenanceCompleteness:
      (scenario.provenance?.transcriptIds?.length ?? 0) > 0 ||
      Boolean(scenario.provenance?.corpusId),
  };
}

export async function runAccountingLocalEval(input: {
  client: OpenAiResponsesClient;
  model: string;
  scenario: ScenarioPack;
  assets: CompiledScenarioAssets;
}) {
  if (input.scenario.family !== ACCOUNTING_SCENARIO_FAMILY) {
    throw new Error(
      `runAccountingLocalEval only supports ${ACCOUNTING_SCENARIO_FAMILY}.`
    );
  }

  const ruleBased = evaluateRuleBasedScenarioChecks(input.scenario, input.assets);
  const semanticAcceptance = evaluateSemanticAcceptance(input.scenario);
  const llmEvalScenarioView = {
    id: input.scenario.id,
    family: input.scenario.family,
    persona: input.scenario.persona,
    publicBrief: input.scenario.publicBrief,
    openingLine: input.scenario.openingLine,
    hiddenFacts: input.scenario.hiddenFacts,
    revealRules: input.scenario.revealRules,
    mustCaptureItems: input.scenario.mustCaptureItems,
    promptSections: input.scenario.promptSections,
  };
  const llmEval = await input.client.createStructuredOutput({
    model: input.model,
    schemaName: "accounting_local_eval",
    jsonSchema: llmEvalJsonSchema,
    responseSchema: llmEvalResponseSchema,
    systemPrompt: [
      "You are reviewing a Japanese enterprise accounting roleplay scenario before publish.",
      "Judge only the user-facing behavior implied by the provided scenario view and agent prompt.",
      "Ignore internal grading, top performer guidance, provenance, and non-prompt metadata.",
      "Use llm_based checks for natural_japanese, busy_but_not_hostile, no_coaching, close_quality, captures_culture_fit, captures_judgement_work.",
      "Return strict JSON only.",
    ].join("\n"),
    userPrompt: JSON.stringify(
      {
        scenario: llmEvalScenarioView,
        assets: {
          scenarioId: input.assets.scenarioId,
          promptVersion: input.assets.promptVersion,
          agentSystemPrompt: input.assets.agentSystemPrompt,
          knowledgeBaseText: input.assets.knowledgeBaseText,
        },
      },
      null,
      2
    ),
  });

  const allChecks: LocalEvalItem[] = [...ruleBased, ...llmEval.evaluations];
  const passed =
    allChecks.every((item) => item.passed) &&
    Object.values(semanticAcceptance).every(Boolean);

  return {
    passed,
    family: input.scenario.family,
    scenarioId: input.scenario.id,
    generatedAt: new Date().toISOString(),
    semanticAcceptance,
    checks: allChecks,
    summary: llmEval.summary,
  };
}
