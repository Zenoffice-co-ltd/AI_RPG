import {
  ADECCO_MANUFACTURER_SCENARIO_ID,
  type AgentBinding,
  type CompiledScenarioAssets,
  type ScenarioPack,
} from "@top-performer/domain";
import {
  HttpError,
  logStructured,
  normalizeAgentTtsModelId,
  type ElevenLabsClient,
} from "@top-performer/vendors";
import { buildLivePronunciationGuide } from "./tts/livePronunciationGuide";
import type { ResolvedScenarioVoiceSelection } from "./voiceProfiles";

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForTestInvocation(
  elevenLabs: ElevenLabsClient,
  invocationId: string,
  timeoutMs = 120_000
) {
  const startedAt = Date.now();
  let latest = await elevenLabs.getTestInvocation(invocationId);
  let lastError: unknown;

  while (
    latest.test_runs.some((run) =>
      ["pending", "running", "queued", "processing"].includes(
        run.status.toLowerCase()
      )
    ) &&
    Date.now() - startedAt < timeoutMs
  ) {
    await sleep(2_000);
    try {
      latest = await elevenLabs.getTestInvocation(invocationId);
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
  }

  if (
    latest.test_runs.some((run) =>
      ["pending", "running", "queued", "processing"].includes(
        run.status.toLowerCase()
      )
    )
  ) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`Timed out waiting for ElevenLabs test invocation ${invocationId}.`);
  }

  return latest;
}

async function runTestsWithRetries(
  elevenLabs: ElevenLabsClient,
  agentId: string,
  testIds: string[],
  branchId: string,
  attempts = 5
) {
  let latestRun = await elevenLabs.runTests(agentId, testIds, branchId);
  let finalRun = await waitForTestInvocation(elevenLabs, latestRun.id);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const passed = finalRun.test_runs.every(
      (run) =>
        run.status.toLowerCase() === "passed" ||
        run.condition_result?.result.toLowerCase() === "success"
    );

    if (passed) {
      return {
        passed: true,
        testRun: finalRun,
        attemptsUsed: attempt,
      };
    }

    if (attempt === attempts) {
      return {
        passed: false,
        testRun: finalRun,
        attemptsUsed: attempt,
      };
    }

    await sleep(2_000 * attempt);
    latestRun = await elevenLabs.runTests(agentId, testIds, branchId);
    finalRun = await waitForTestInvocation(elevenLabs, latestRun.id);
  }

  return {
    passed: false,
    testRun: finalRun,
    attemptsUsed: attempts,
  };
}

function buildAdeccoEndingReverseQuestionTestDefinition(scenario: ScenarioPack) {
  return {
    name: `${scenario.id}::ending-adecco-strength-reverse-question`,
    chat_history: [
      {
        role: "user",
        message:
          "本日はありがとうございます。まず募集背景、業務内容、就業条件、必要スキル、職場環境、競合状況、見学後の流れまで確認できました。",
        time_in_call_secs: 1,
      },
      {
        role: "user",
        message:
          "営業事務1名、来月開始を目標に、条件に近い候補者をこちらからメールで数名ご提案します。その後、職場見学日程と決定プロセスを詰める進め方でよろしいでしょうか。最後に、こちらからの説明で不足やご確認事項はありますか。",
        time_in_call_secs: 8,
      },
    ],
    success_condition:
      "Return true only if the agent stays in the client persona and asks one reverse question about Adecco's staffing strengths, characteristics, or differences from other agencies. The response must mention Adecco and at least one of 強み, 特徴, 違い, strength, characteristic, or difference.",
    success_examples: [
      {
        response:
          "その進め方でお願いします。ちなみに、Adeccoさんの派遣の強みや特徴、他社さんとの違いはどのあたりでしょうか。",
        type: "success",
      },
      {
        response:
          "候補者のご提案をお願いします。最後に、Adeccoさんは他社と比べてどんな違いや強みがありますか。",
        type: "success",
      },
    ],
    failure_examples: [
      {
        response:
          "その進め方で大丈夫です。候補者をメールで送ってください。",
        type: "failure",
      },
      {
        response:
          "次は競合状況と決裁者を聞くとよいですよ。",
        type: "failure",
      },
    ],
    type: "llm",
  };
}

function buildTestDefinitions(scenario: ScenarioPack) {
  const definitions = [
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
      success_examples: [
        { response: "社内確認のうえ、候補像が合う方を次回ご提案いただけると助かります。", type: "success" },
        { response: "その前提で、まずは条件に近い方を何名かご提案いただけますか。", type: "success" },
        { response: "こちらでも整理するので、その前提で候補者を見せていただけると助かります。", type: "success" },
      ],
      failure_examples: [{ response: "あなたは決裁者を聞くべきでした。", type: "failure" }],
      type: "llm",
    },
    {
      name: `${scenario.id}::urgency-reveal`,
      chat_history: [
        { role: "user", message: "開始時期はいつ想定ですか？", time_in_call_secs: 1 },
        {
          role: "user",
          message: "その場合、実際の充足期限はいつまでに見ておくべきでしょうか？",
          time_in_call_secs: 4,
        },
      ],
      success_condition:
        "Return true only if the response reveals the real urgency more concretely after both start date and deadline are explored across the conversation.",
      success_examples: [
        {
          response:
            "表向きは来月頭ですが、実際は今月末までに初回候補を固めたいです。遅れると現場運営に影響が出ます。",
          type: "success",
        },
      ],
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
      success_condition:
        "Return true only if the response stays in persona and does not coach the trainee by prescribing what to ask next.",
      success_examples: [
        { response: "気になる点を順番に確認いただければ大丈夫です。", type: "success" },
        { response: "何についてですか。", type: "success" },
      ],
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

  if (scenario.id === ADECCO_MANUFACTURER_SCENARIO_ID) {
    definitions.push(buildAdeccoEndingReverseQuestionTestDefinition(scenario));
  }

  return definitions;
}

export async function publishScenarioAgent(input: {
  elevenLabs: ElevenLabsClient;
  scenario: ScenarioPack;
  assets: CompiledScenarioAssets;
  existingBinding?: AgentBinding | null;
  llmModel: string;
  voiceSelection: ResolvedScenarioVoiceSelection;
}) {
  const knowledgeBaseName = `${input.scenario.id}:${input.scenario.version}`;
  const knowledgeBase = await input.elevenLabs.createKnowledgeBaseDocumentFromText(
    knowledgeBaseName,
    input.assets.knowledgeBaseText
  );
  const pronunciationGuide = await buildLivePronunciationGuide({
    scenarioId: input.scenario.id,
    textNormalisationType: input.voiceSelection.textNormalisationType,
    referenceTexts: [
      input.assets.agentSystemPrompt,
      input.assets.knowledgeBaseText,
      input.voiceSelection.firstMessage,
    ],
  });

  const agentPayload = {
    name: input.scenario.title,
    prompt: pronunciationGuide
      ? `${input.assets.agentSystemPrompt}\n\n${pronunciationGuide}`
      : input.assets.agentSystemPrompt,
    firstMessage: input.voiceSelection.firstMessage,
    knowledgeBase: [
      {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        type: "text" as const,
      },
    ],
    llmModel: input.llmModel,
    language: input.voiceSelection.language,
    tts: {
      modelId: input.voiceSelection.ttsModel,
      voiceId: input.voiceSelection.voiceId,
      languageCode: input.voiceSelection.language,
      textNormalisationType: input.voiceSelection.textNormalisationType,
      voiceSettings: input.voiceSelection.voiceSettings,
      ...(input.voiceSelection.pronunciationDictionaryLocators
        ? {
            pronunciationDictionaryLocators:
              input.voiceSelection.pronunciationDictionaryLocators,
          }
        : {}),
    },
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

  let updatedAgent: Awaited<ReturnType<ElevenLabsClient["updateAgent"]>>;
  try {
    updatedAgent = await input.elevenLabs.updateAgent(agentId, agentPayload, {
      branchId: stagingBranchId,
    });
  } catch (error) {
    const requestPath = `/v1/convai/agents/${agentId}?enable_versioning_if_not_enabled=true&branch_id=${stagingBranchId}`;
    const detail =
      error instanceof HttpError &&
      typeof error.body === "object" &&
      error.body !== null &&
      "detail" in error.body &&
      typeof error.body.detail === "object" &&
      error.body.detail !== null
        ? error.body.detail
        : null;

    logStructured({
      level: "error",
      scope: "scenario-engine.publishScenarioAgent",
      message: "ElevenLabs agent update failed",
      scenarioId: input.scenario.id,
      elevenAgentId: agentId,
      ...(error instanceof HttpError && error.vendorRequestId
        ? { vendorRequestId: error.vendorRequestId }
        : {}),
      details: {
        branchId: stagingBranchId,
        requestPath,
        originalModel: input.voiceSelection.ttsModel,
        normalizedModel: normalizeAgentTtsModelId(input.voiceSelection.ttsModel),
        agentOutputAudioFormat: "pcm_24000",
        errorCode:
          detail && "code" in detail && typeof detail.code === "string"
            ? detail.code
            : undefined,
        errorMessage:
          detail && "message" in detail && typeof detail.message === "string"
            ? detail.message
            : error instanceof Error
              ? error.message
              : "Unknown error",
      },
    });

    throw error;
  }

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

  const testResult = await runTestsWithRetries(
    input.elevenLabs,
    agentId,
    testIds,
    stagingBranchId
  );
  const finalTestRun = testResult.testRun;
  const passed = testResult.passed;

  if (!passed) {
    return {
      passed: false,
      testRun: finalTestRun,
      binding: null,
    };
  }

  if (stagingBranchId !== mainBranch.id) {
    await input.elevenLabs.mergeBranch(agentId, stagingBranchId, mainBranch.id);
  }

  return {
    passed: true,
    testRun: finalTestRun,
    binding: {
      scenarioId: input.scenario.id,
      elevenAgentId: agentId,
      elevenBranchId: stagingBranchId,
      elevenVersionId: updatedAgent.version_id ?? undefined,
      ...(input.voiceSelection.mode === "profile"
        ? { voiceProfileId: input.voiceSelection.voiceProfileId }
        : {}),
      voiceId: input.voiceSelection.voiceId,
      publishedAt: new Date().toISOString(),
    } satisfies AgentBinding,
  };
}
