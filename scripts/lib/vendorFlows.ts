import { getAppContext } from "../../apps/web/server/appContext";
import {
  DEFAULT_ELEVENLABS_SECRET_NAME,
  getEnvOrSecret,
} from "../../apps/web/server/secrets";
import { writeGeneratedJson } from "../../apps/web/server/workspace";
import {
  ACCEPTANCE_SCENARIO_ID,
  AcceptanceBlocker,
  buildBasePreflightReport,
  getConfiguredValue,
} from "./acceptance";

export type BootstrapOptions = {
  refreshSecret?: boolean;
};

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForElevenTestRun(
  client: ReturnType<typeof getAppContext>["vendors"]["elevenLabs"],
  invocationId: string,
  timeoutMs = 120_000
) {
  const startedAt = Date.now();
  let latest = await client.getTestInvocation(invocationId);
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
      latest = await client.getTestInvocation(invocationId);
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

export function resolveSecretReuseAction(
  existingSecretId: string | undefined,
  refreshSecret = false
) {
  if (existingSecretId && !refreshSecret) {
    return "reuse" as const;
  }

  return "create" as const;
}

export async function getBootstrapPreflightBlockers() {
  const blockers = (await buildBasePreflightReport()).blockers.filter(
    (blocker) =>
      blocker.requiredInput === "FIREBASE_PROJECT_ID" ||
      blocker.requiredInput === "SECRET_SOURCE_PROJECT_ID" ||
      blocker.requiredInput?.startsWith("OpenAI secret in ") === true ||
      blocker.requiredInput === "ELEVENLABS_API_KEY" ||
      blocker.requiredInput === "LIVEAVATAR_API_KEY"
  );

  return blockers;
}

export async function getSmokeElevenPreflightBlockers() {
  const blockers = (await buildBasePreflightReport()).blockers.filter(
    (blocker) =>
      blocker.requiredInput === "ELEVENLABS_API_KEY" ||
      blocker.requiredInput === "DEFAULT_ELEVEN_VOICE_ID" ||
      blocker.requiredInput === "FIREBASE_PROJECT_ID"
  );

  return blockers;
}

export async function getSmokeLiveAvatarPreflightBlockers() {
  const baseBlockers = (await buildBasePreflightReport()).blockers.filter(
    (blocker) =>
      blocker.requiredInput === "LIVEAVATAR_API_KEY" ||
      blocker.requiredInput === "FIREBASE_PROJECT_ID"
  );

  if (baseBlockers.length > 0) {
    return baseBlockers;
  }

  const ctx = getAppContext();
  const runtimeSettings = await ctx.repositories.runtimeSettings.get();
  const binding = await ctx.repositories.agentBindings.get(ACCEPTANCE_SCENARIO_ID);
  const blockers: AcceptanceBlocker[] = [...baseBlockers];

  if (!runtimeSettings?.liveAvatarElevenSecretId) {
    blockers.push({
      kind: "needs_manual_account",
      step: "smoke:liveavatar",
      detail:
        "LiveAvatar 側の ElevenLabs secret id が runtime settings にありません。pnpm bootstrap:vendors を先に実行してください。",
    });
  }

  if (!binding) {
    blockers.push({
      kind: "needs_manual_account",
      step: "smoke:liveavatar",
      detail:
        "busy_manager_medium の AgentBinding がありません。pnpm publish:scenario --scenario staffing_order_hearing_busy_manager_medium を先に実行してください。",
    });
  }

  return blockers;
}

export async function runBootstrapVendors(options: BootstrapOptions = {}) {
  const ctx = getAppContext();
  const avatars = await ctx.vendors.liveAvatar.assertConnectivity();
  await ctx.vendors.elevenLabs.assertConnectivity();

  const runtimeSettings = await ctx.repositories.runtimeSettings.get();
  const secretAction = resolveSecretReuseAction(
    runtimeSettings?.liveAvatarElevenSecretId,
    options.refreshSecret
  );
  const elevenLabsApiKey = await getEnvOrSecret(
    "ELEVENLABS_API_KEY",
    DEFAULT_ELEVENLABS_SECRET_NAME,
    ctx.env.SECRET_SOURCE_PROJECT_ID
  );
  const secretId =
    secretAction === "reuse" && runtimeSettings?.liveAvatarElevenSecretId
      ? runtimeSettings.liveAvatarElevenSecretId
      : (
          await ctx.vendors.liveAvatar.createSecret(
            `elevenlabs_${new Date().toISOString().slice(0, 10)}`,
            elevenLabsApiKey
          )
        ).id;

  const shortlist = avatars.slice(0, 5);
  const defaultAvatarId =
    getConfiguredValue(process.env, "DEFAULT_AVATAR_ID") ??
    runtimeSettings?.defaultAvatarId ??
    shortlist[0]?.avatar_id ??
    "unset_avatar";
  const resolvedVoice = await ctx.vendors.elevenLabs.resolveVoiceId(
    getConfiguredValue(process.env, "DEFAULT_ELEVEN_VOICE_ID") ??
      runtimeSettings?.defaultElevenVoiceId,
    "ja"
  );

  await ctx.repositories.runtimeSettings.set({
    defaultAvatarId,
    defaultElevenModel: ctx.env.DEFAULT_ELEVEN_MODEL,
    defaultElevenVoiceId: resolvedVoice.voiceId,
    liveavatarSandbox: ctx.env.LIVEAVATAR_SANDBOX,
    liveAvatarElevenSecretId: secretId,
  });

  const payload = {
    secretAction,
    secretId,
    defaultAvatarId,
    defaultVoiceId: resolvedVoice.voiceId,
    voiceResolution: resolvedVoice.resolution,
    voiceName: resolvedVoice.voiceName,
    shortlist,
  };
  await writeGeneratedJson("vendors/bootstrap.json", payload);
  return payload;
}

export async function runElevenSmoke() {
  const ctx = getAppContext();
  const resolvedVoice = await ctx.vendors.elevenLabs.resolveVoiceId(
    getConfiguredValue(process.env, "DEFAULT_ELEVEN_VOICE_ID"),
    "ja"
  );

  const knowledgeBase =
    await ctx.vendors.elevenLabs.createKnowledgeBaseDocumentFromText(
      `smoke-${Date.now()}`,
      "This is a smoke test knowledge base for the Top Performer Roleplay MVP."
    );

  const created = await ctx.vendors.elevenLabs.createAgent({
    name: `Smoke Agent ${Date.now()}`,
    prompt:
      "You are a polite Japanese customer-side contact for a staffing order hearing. Stay in character as a natural business counterpart and do not mention testing.",
    firstMessage: "本日はお時間ありがとうございます。よろしくお願いします。",
    knowledgeBase: [
      {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        type: "text",
      },
    ],
    model: ctx.env.DEFAULT_ELEVEN_MODEL,
    voiceId: resolvedVoice.voiceId,
    language: "ja",
  });
  const agentId = created.agent_id;
  const testId = await ctx.vendors.elevenLabs.createTest({
    name: `smoke-test-${Date.now()}`,
    type: "llm",
    chat_history: [
      {
        role: "user",
        message: "役割を教えてください。",
        time_in_call_secs: 1,
      },
    ],
    success_condition:
      "Return true only if the response stays in Japanese and behaves like a natural customer persona.",
    success_examples: [
      { response: "私は今回相談している顧客担当者です。", type: "success" },
    ],
    failure_examples: [{ response: "I am a test harness.", type: "failure" }],
  });
  const testRun = await ctx.vendors.elevenLabs.runTests(agentId, [testId]);
  const finalTestRun = await waitForElevenTestRun(
    ctx.vendors.elevenLabs,
    testRun.id
  );
  const passed = finalTestRun.test_runs.every(
    (run) =>
      run.status.toLowerCase() === "passed" ||
      run.condition_result?.result.toLowerCase() === "success"
  );

  if (!passed) {
    throw new Error(
      `smoke:eleven test invocation ${finalTestRun.id} did not pass.`
    );
  }

  return {
    knowledgeBase,
    agentId,
    testId,
    testRun: finalTestRun,
    voiceId: resolvedVoice.voiceId,
    voiceResolution: resolvedVoice.resolution,
    voiceName: resolvedVoice.voiceName,
  };
}

export async function runLiveAvatarSmoke() {
  const ctx = getAppContext();
  const avatars = await ctx.vendors.liveAvatar.assertConnectivity();
  const runtimeSettings = await ctx.repositories.runtimeSettings.get();
  const binding = await ctx.repositories.agentBindings.get(ACCEPTANCE_SCENARIO_ID);

  if (!runtimeSettings?.liveAvatarElevenSecretId) {
    throw new Error("Missing LiveAvatar ElevenLabs secret. Run bootstrap:vendors first.");
  }
  if (!binding) {
    throw new Error(
      `Missing agent binding for ${ACCEPTANCE_SCENARIO_ID}. Publish a scenario first.`
    );
  }

  const avatarId =
    runtimeSettings.defaultAvatarId ?? avatars[0]?.avatar_id ?? "missing_avatar";
  const sessionToken = await ctx.vendors.liveAvatar.createSessionToken({
    avatarId,
    sandbox: ctx.env.LIVEAVATAR_SANDBOX,
    elevenlabsAgentConfig: {
      secretId: runtimeSettings.liveAvatarElevenSecretId,
      agentId: binding.elevenAgentId,
    },
  });
  const started = await ctx.vendors.liveAvatar.startSession(
    sessionToken.session_token
  );
  const transcript = await ctx.vendors.liveAvatar.getTranscript(started.session_id, 0);
  await ctx.vendors.liveAvatar.stopSession(started.session_id);

  return {
    avatarId,
    started,
    transcript,
  };
}

export async function inspectAcceptanceSeedState() {
  const ctx = getAppContext();
  const playbooks = await ctx.repositories.playbooks.list();
  const scenario = await ctx.repositories.scenarios.get(ACCEPTANCE_SCENARIO_ID);
  const assets = await ctx.repositories.scenarios.getAssets(ACCEPTANCE_SCENARIO_ID);
  const binding = await ctx.repositories.agentBindings.get(ACCEPTANCE_SCENARIO_ID);
  const runtimeSettings = await ctx.repositories.runtimeSettings.get();

  return {
    playbookCount: playbooks.length,
    latestPlaybookVersion: playbooks[0]?.version,
    scenario,
    assets,
    binding,
    runtimeSettings,
  };
}
