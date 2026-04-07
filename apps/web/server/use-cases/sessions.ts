import { randomUUID } from "node:crypto";
import {
  ACCOUNTING_GRADE_SESSION_PROMPT_VERSION,
  ACCOUNTING_SCENARIO_FAMILY,
  GRADE_SESSION_PROMPT_VERSION,
  getSessionResponseSchema,
  startSessionInputSchema,
  startSessionOutputSchema,
  transcriptDeltaSchema,
  type SessionRecord,
} from "@top-performer/domain";
import { getAppContext } from "../appContext";
import { LiveAvatarElevenPluginProvider } from "../avatarProvider";
import { enqueueSessionAnalysis } from "../cloudTasks";

function createProvider() {
  const ctx = getAppContext();
  return new LiveAvatarElevenPluginProvider(ctx.vendors.liveAvatar);
}

async function resolveAvatarId(requestedAvatarId?: string) {
  const ctx = getAppContext();
  const runtimeSettings = await ctx.repositories.runtimeSettings.get();
  return (
    requestedAvatarId ??
    runtimeSettings?.defaultAvatarId ??
    ctx.env.DEFAULT_AVATAR_ID
  );
}

export async function createSession(input: unknown) {
  const parsed = startSessionInputSchema.parse(input);
  const ctx = getAppContext();
  const scenario = await ctx.repositories.scenarios.get(parsed.scenarioId);
  if (!scenario) {
    throw new Error(`Scenario not found: ${parsed.scenarioId}`);
  }

  const binding = await ctx.repositories.agentBindings.get(parsed.scenarioId);
  if (!binding) {
    throw new Error(`Agent binding not found: ${parsed.scenarioId}`);
  }

  const runtimeSettings = await ctx.repositories.runtimeSettings.get();
  const avatarId = await resolveAvatarId(parsed.avatarId);
  if (!avatarId) {
    throw new Error("DEFAULT_AVATAR_ID or avatarId is required");
  }
  const liveAvatarElevenSecretId = runtimeSettings?.liveAvatarElevenSecretId;
  if (!liveAvatarElevenSecretId) {
    throw new Error(
      "LiveAvatar ElevenLabs secret is not configured. Run bootstrap:vendors first."
    );
  }

  const provider = createProvider();
  const sessionId = `sess_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const started = await provider.startSession({
    avatarId,
    elevenAgentId: binding.elevenAgentId,
    sandbox: ctx.env.LIVEAVATAR_SANDBOX,
    sessionNamespace: liveAvatarElevenSecretId,
  });

  const sessionRecord: SessionRecord = {
    sessionId,
    scenarioId: parsed.scenarioId,
    status: "active",
    liveavatarSessionId: started.liveavatarSessionId,
    livekitRoomUrl: started.roomUrl,
    livekitToken: started.roomToken,
    avatarId: started.avatarId,
    elevenAgentId: binding.elevenAgentId,
    startedAt: new Date().toISOString(),
    transcriptCursor: 0,
    analysisVersion:
      scenario.family === ACCOUNTING_SCENARIO_FAMILY
        ? ACCOUNTING_GRADE_SESSION_PROMPT_VERSION
        : GRADE_SESSION_PROMPT_VERSION,
  };

  await ctx.repositories.sessions.create(sessionRecord);
  if (
    runtimeSettings &&
    started.avatarId !== runtimeSettings.defaultAvatarId
  ) {
    await ctx.repositories.runtimeSettings.set({
      defaultAvatarId: started.avatarId,
      defaultElevenModel: runtimeSettings.defaultElevenModel,
      defaultElevenVoiceId: runtimeSettings.defaultElevenVoiceId,
      liveavatarSandbox: runtimeSettings.liveavatarSandbox,
      liveAvatarElevenSecretId: runtimeSettings.liveAvatarElevenSecretId,
    });
  }

  return startSessionOutputSchema.parse({
    sessionId,
    liveavatarSessionId: started.liveavatarSessionId,
    roomUrl: started.roomUrl,
    roomToken: started.roomToken,
    avatarId: started.avatarId,
  });
}

export async function getSession(sessionId: string) {
  const session = await getAppContext().repositories.sessions.get(sessionId);
  if (!session) {
    return null;
  }

  return getSessionResponseSchema.parse({
    sessionId: session.sessionId,
    status: session.status,
    scenarioId: session.scenarioId,
  });
}

export async function getSessionTranscript(sessionId: string, cursor = 0) {
  const ctx = getAppContext();
  const session = await ctx.repositories.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const provider = createProvider();
  const delta = await provider.getTranscript(session.liveavatarSessionId, cursor);

  await ctx.repositories.sessions.upsertTurns(session.sessionId, delta.turns);
  await ctx.repositories.sessions.update(session.sessionId, {
    transcriptCursor: delta.cursor,
  });

  return transcriptDeltaSchema.parse({
    sessionId: session.sessionId,
    cursor: delta.cursor,
    sessionActive: delta.sessionActive,
    turns: delta.turns,
  });
}

export async function endSession(sessionId: string) {
  const ctx = getAppContext();
  const session = await ctx.repositories.sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const provider = createProvider();
  await ctx.repositories.sessions.update(sessionId, { status: "ending" });
  await provider.stopSession(session.liveavatarSessionId);

  const fullTranscript = await provider.getTranscript(session.liveavatarSessionId, 0);
  await ctx.repositories.sessions.upsertTurns(sessionId, fullTranscript.turns);
  await ctx.repositories.sessions.saveArtifact({
    id: "full_transcript",
    kind: "full_transcript",
    sessionId,
    createdAt: new Date().toISOString(),
    payload: fullTranscript,
  });

  await ctx.repositories.sessions.update(sessionId, {
    endedAt: new Date().toISOString(),
    transcriptCursor: fullTranscript.cursor,
    status: "transcript_ready",
  });

  await enqueueSessionAnalysis(sessionId);
  await ctx.repositories.sessions.update(sessionId, {
    status: "analysis_queued",
  });

  return {
    sessionId,
    status: "analysis_queued" as const,
  };
}
