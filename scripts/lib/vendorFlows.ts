import { getAppContext } from "../../apps/web/server/appContext";
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
  const blockers = buildBasePreflightReport().blockers.filter(
    (blocker) =>
      blocker.requiredInput === "FIREBASE_PROJECT_ID" ||
      blocker.requiredInput === "ELEVENLABS_API_KEY" ||
      blocker.requiredInput === "LIVEAVATAR_API_KEY"
  );

  return blockers;
}

export async function getSmokeElevenPreflightBlockers() {
  const blockers = buildBasePreflightReport().blockers.filter(
    (blocker) =>
      blocker.requiredInput === "ELEVENLABS_API_KEY" ||
      blocker.requiredInput === "DEFAULT_ELEVEN_VOICE_ID" ||
      blocker.requiredInput === "FIREBASE_PROJECT_ID"
  );

  return blockers;
}

export async function getSmokeLiveAvatarPreflightBlockers() {
  const baseBlockers = buildBasePreflightReport().blockers.filter(
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
  const secretId =
    secretAction === "reuse" && runtimeSettings?.liveAvatarElevenSecretId
      ? runtimeSettings.liveAvatarElevenSecretId
      : (
          await ctx.vendors.liveAvatar.createSecret(
            `elevenlabs_${new Date().toISOString().slice(0, 10)}`,
            ctx.env.ELEVENLABS_API_KEY
          )
        ).id;

  const shortlist = avatars.slice(0, 5);
  const defaultAvatarId =
    getConfiguredValue(process.env, "DEFAULT_AVATAR_ID") ??
    runtimeSettings?.defaultAvatarId ??
    shortlist[0]?.avatar_id ??
    "unset_avatar";
  const defaultVoiceId =
    getConfiguredValue(process.env, "DEFAULT_ELEVEN_VOICE_ID") ??
    runtimeSettings?.defaultElevenVoiceId ??
    "unset_voice";

  await ctx.repositories.runtimeSettings.set({
    defaultAvatarId,
    defaultElevenModel: ctx.env.DEFAULT_ELEVEN_MODEL,
    defaultElevenVoiceId: defaultVoiceId,
    liveavatarSandbox: ctx.env.LIVEAVATAR_SANDBOX,
    liveAvatarElevenSecretId: secretId,
  });

  const payload = {
    secretAction,
    secretId,
    defaultAvatarId,
    defaultVoiceId,
    shortlist,
  };
  await writeGeneratedJson("vendors/bootstrap.json", payload);
  return payload;
}

export async function runElevenSmoke() {
  const ctx = getAppContext();
  const voiceId = getConfiguredValue(process.env, "DEFAULT_ELEVEN_VOICE_ID");
  if (!voiceId) {
    throw new Error(
      "DEFAULT_ELEVEN_VOICE_ID is required for smoke:eleven because agent create/update and test run are part of the acceptance path."
    );
  }

  const knowledgeBase =
    await ctx.vendors.elevenLabs.createKnowledgeBaseDocumentFromText(
      `smoke-${Date.now()}`,
      "This is a smoke test knowledge base for the Top Performer Roleplay MVP."
    );

  const created = await ctx.vendors.elevenLabs.createAgent({
    name: `Smoke Agent ${Date.now()}`,
    prompt: "You are a polite Japanese customer persona for smoke testing.",
    firstMessage: "本日はよろしくお願いします。",
    knowledgeBase: [
      {
        id: knowledgeBase.id,
        name: knowledgeBase.name,
        type: "text",
      },
    ],
    model: ctx.env.DEFAULT_ELEVEN_MODEL,
    voiceId,
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

  return {
    knowledgeBase,
    agentId,
    testId,
    testRun,
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
