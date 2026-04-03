import type { AgentBinding, CompiledScenarioAssets, ScenarioPack } from "@top-performer/domain";
import type { ElevenLabsClient } from "@top-performer/vendors";

function buildTestDefinitions(scenario: ScenarioPack) {
  return [
    {
      name: `${scenario.id}::role-adherence`,
      chat_history: [{ role: "user", message: "あなたは誰ですか？", time_in_call_secs: 1 }],
      success_condition: "Return true only if the agent answers as the customer-side persona from the scenario and does not claim to be a coach or evaluator.",
      success_examples: [{ response: "私は物流センター責任者として今回の募集背景をご相談しています。", type: "success" }],
      failure_examples: [{ response: "私は採点AIです。次は決裁者を聞いてください。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::no-hidden-fact-leak`,
      chat_history: [{ role: "user", message: "今回の募集について概要を教えてください。", time_in_call_secs: 1 }],
      success_condition: "Return true only if the response does not reveal hidden facts such as decision maker, competition, or budget flexibility unless explicitly asked.",
      success_examples: [{ response: "まずは今回お願いしたいポジションや背景からお伝えします。", type: "success" }],
      failure_examples: [{ response: "実は他社2社と比較中で決裁は部門長です。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::reveal-decision-maker`,
      chat_history: [{ role: "user", message: "このポジションの最終決裁はどなたが持っていますか？", time_in_call_secs: 1 }],
      success_condition: "Return true only if the response naturally reveals the actual decision structure when asked directly.",
      success_examples: [{ response: "現場の私だけでは決まらず、部門長承認が必要です。", type: "success" }],
      failure_examples: [{ response: "そこは気にしなくて大丈夫です。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::shallow-questions-stay-shallow`,
      chat_history: [{ role: "user", message: "人数は何名ですか？", time_in_call_secs: 1 }],
      success_condition: "Return true only if the response answers the asked point without dumping all hidden constraints.",
      success_examples: [{ response: "まずは3名を想定しています。", type: "success" }],
      failure_examples: [{ response: "3名です。他社提案もあり、予算も厳しく、決裁は二段階です。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::next-step-close`,
      chat_history: [{ role: "user", message: "本日確認した内容を踏まえて、次はどのように進めましょうか？", time_in_call_secs: 1 }],
      success_condition: "Return true only if the response proposes a natural next step without breaking persona.",
      success_examples: [{ response: "社内確認のうえ、候補像が合う方を次回ご提案いただけると助かります。", type: "success" }],
      failure_examples: [{ response: "あなたは決裁者を聞くべきでした。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::urgency-reveal`,
      chat_history: [{ role: "user", message: "開始時期と、そこから逆算した充足期限はどれくらいですか？", time_in_call_secs: 1 }],
      success_condition: "Return true only if the response reveals the real urgency more concretely after both start date and deadline are explored.",
      success_examples: [{ response: "表向きは来月頭ですが、実際は今月末までに目途を付けたいです。", type: "success" }],
      failure_examples: [{ response: "開始時期は来月頭です。以上です。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::competing-agencies-reveal`,
      chat_history: [{ role: "user", message: "他社さんにも並行で相談されていますか？", time_in_call_secs: 1 }],
      success_condition: "Return true only if the response acknowledges competition naturally when asked.",
      success_examples: [{ response: "はい、比較のために他社にも相談しています。", type: "success" }],
      failure_examples: [{ response: "その点はお伝えできません。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::budget-flexibility-reveal`,
      chat_history: [{ role: "user", message: "時給の上限は厳格ですか、それとも開始時期次第で相談余地がありますか？", time_in_call_secs: 1 }],
      success_condition: "Return true only if the response reveals limited flexibility when budget is asked in context.",
      success_examples: [{ response: "基本は厳しめですが、早期充足なら少し相談の余地はあります。", type: "success" }],
      failure_examples: [{ response: "予算は十分にあります。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::no-coaching`,
      chat_history: [{ role: "user", message: "何を聞けばよいですか？", time_in_call_secs: 1 }],
      success_condition: "Return true only if the response stays in persona and does not coach the trainee.",
      success_examples: [{ response: "気になる点を順番に確認いただければ大丈夫です。", type: "success" }],
      failure_examples: [{ response: "まず決裁者、その次に充足期限を聞いてください。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::natural-japanese`,
      chat_history: [{ role: "user", message: "今回の背景をもう少し教えてください。", time_in_call_secs: 1 }],
      success_condition: "Return true only if the answer is natural Japanese business conversation rather than bullet-point output.",
      success_examples: [{ response: "背景としては、新規ラインの立ち上がりで人手を早めに確保したいんです。", type: "success" }],
      failure_examples: [{ response: "1. 背景 2. 人数 3. 開始時期", type: "failure" }],
      type: "llm",
    },
  ];
}

export async function publishScenarioAgent(input: {
  elevenLabs: ElevenLabsClient;
  scenario: ScenarioPack;
  assets: CompiledScenarioAssets;
  existingBinding?: AgentBinding | null;
  defaultModel: string;
  defaultVoiceId: string;
}) {
  const knowledgeBaseName = `${input.scenario.id}:${input.scenario.version}`;
  const knowledgeBase = await input.elevenLabs.createKnowledgeBaseDocumentFromText(
    knowledgeBaseName,
    input.assets.knowledgeBaseText
  );

  const agentPayload = {
    name: input.scenario.title,
    prompt: input.assets.agentSystemPrompt,
    firstMessage: input.scenario.openingLine,
    knowledgeBase: [
      {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        type: "text" as const,
      },
    ],
    model: input.defaultModel,
    voiceId: input.defaultVoiceId,
    language: "ja",
  };

  const agentId =
    input.existingBinding?.elevenAgentId ??
    (await input.elevenLabs.createAgent(agentPayload)).agent_id;

  const currentAgent = await input.elevenLabs.getAgent(agentId);
  const branches = await input.elevenLabs.listBranches(agentId);
  const mainBranch =
    branches.find((branch) => branch.name.toLowerCase() === "main") ?? branches[0];

  if (!mainBranch) {
    throw new Error(`No main branch found for agent ${agentId}`);
  }

  const stagingBranch =
    branches.find((branch) => branch.name.toLowerCase() === "staging") ??
    (await input.elevenLabs.createBranch(
      agentId,
      currentAgent.version_id ?? "",
      "staging",
      "Top Performer Roleplay staging branch"
    ));

  const stagingBranchId =
    "created_branch_id" in stagingBranch ? stagingBranch.created_branch_id : stagingBranch.id;

  const updatedAgent = await input.elevenLabs.updateAgent(agentId, agentPayload, {
    branchId: stagingBranchId,
  });

  const existingTests = await input.elevenLabs.listTests();
  const testIds: string[] = [];

  for (const definition of buildTestDefinitions(input.scenario)) {
    const existing = existingTests.find((test) => test.name === definition.name);
    if (existing) {
      await input.elevenLabs.updateTest(existing.id, definition);
      testIds.push(existing.id);
    } else {
      testIds.push(await input.elevenLabs.createTest(definition));
    }
  }

  const testRun = await input.elevenLabs.runTests(agentId, testIds, stagingBranchId);
  const passed = testRun.test_runs.every(
    (run) =>
      run.status.toLowerCase() === "passed" ||
      run.condition_result?.result.toLowerCase() === "success"
  );

  if (!passed) {
    return {
      passed: false,
      testRun,
      binding: null,
    };
  }

  if (stagingBranchId !== mainBranch.id) {
    await input.elevenLabs.mergeBranch(agentId, stagingBranchId, mainBranch.id);
  }

  return {
    passed: true,
    testRun,
    binding: {
      scenarioId: input.scenario.id,
      elevenAgentId: agentId,
      elevenBranchId: stagingBranchId,
      elevenVersionId: updatedAgent.version_id ?? undefined,
      voiceId: input.defaultVoiceId,
      publishedAt: new Date().toISOString(),
    } satisfies AgentBinding,
  };
}
