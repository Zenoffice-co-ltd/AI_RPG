import { randomUUID } from "node:crypto";
import {
  aggregatePlaybook,
  buildLegacyVoiceSelection,
  buildProfileVoiceSelection,
  compileScenarios,
  importTranscriptsFromDirectory,
  mineTranscriptBehaviors,
  publishScenarioAgent,
  resolveMappedVoiceProfile,
} from "@top-performer/scenario-engine";
import {
  compileScenariosRequestSchema,
  playbookBuildRequestSchema,
  publishScenarioRequestSchema,
  transcriptImportRequestSchema,
  type JobRecord,
} from "@top-performer/domain";
import { getAppContext } from "../appContext";
import { resolveWorkspacePath, writeGeneratedJson } from "../workspace";

function createJob(type: JobRecord["type"], metadata: JobRecord["metadata"] = {}) {
  const now = new Date().toISOString();
  return {
    jobId: `job_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    type,
    status: "running" as const,
    createdAt: now,
    updatedAt: now,
    metadata,
  };
}

export async function importTranscriptsJob(input: unknown) {
  const parsed = transcriptImportRequestSchema.parse(input);
  const ctx = getAppContext();
  const job = createJob("transcript_import", { path: parsed.path });
  await ctx.repositories.jobs.upsert(job);

  try {
    const transcripts = await importTranscriptsFromDirectory(
      resolveWorkspacePath(parsed.path)
    );

    for (const transcript of transcripts) {
      await ctx.repositories.transcripts.upsert(transcript);
      await writeGeneratedJson(
        `transcripts/${transcript.id}.json`,
        transcript
      );
    }

    await ctx.repositories.jobs.upsert({
      ...job,
      status: "completed",
      updatedAt: new Date().toISOString(),
      metadata: {
        ...job.metadata,
        count: transcripts.length,
      },
    });

    return { jobId: job.jobId, count: transcripts.length };
  } catch (error) {
    await ctx.repositories.jobs.upsert({
      ...job,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

export async function buildPlaybooksJob(input: unknown) {
  const parsed = playbookBuildRequestSchema.parse(input);
  const ctx = getAppContext();
  const job = createJob("playbook_build", { family: parsed.family });
  await ctx.repositories.jobs.upsert(job);

  try {
    const transcripts = await ctx.repositories.transcripts.listByFamily(parsed.family);
    const extractions = [];
    for (const transcript of transcripts) {
      const extraction = await mineTranscriptBehaviors({
        client: ctx.vendors.openAi,
        model: ctx.env.OPENAI_MINING_MODEL,
        transcript,
      });
      await ctx.repositories.transcripts.saveExtraction(extraction);
      await writeGeneratedJson(
        `playbooks/extractions/${transcript.id}.json`,
        extraction
      );
      extractions.push(extraction);
    }

    const playbook = aggregatePlaybook({
      family: parsed.family,
      transcripts,
      extractions,
    });

    await ctx.repositories.playbooks.upsert(playbook);
    await writeGeneratedJson(`playbooks/${playbook.version}.json`, playbook);

    await ctx.repositories.jobs.upsert({
      ...job,
      status: "completed",
      updatedAt: new Date().toISOString(),
      playbookVersion: playbook.version,
    });

    return playbook;
  } catch (error) {
    await ctx.repositories.jobs.upsert({
      ...job,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

export async function compileScenariosJob(input: unknown) {
  const parsed = compileScenariosRequestSchema.parse(input);
  const ctx = getAppContext();
  const job = createJob("scenario_compile", {
    playbookVersion: parsed.playbookVersion,
  });
  await ctx.repositories.jobs.upsert(job);

  try {
    const playbook = await ctx.repositories.playbooks.get(parsed.playbookVersion);
    if (!playbook) {
      throw new Error(`Playbook not found: ${parsed.playbookVersion}`);
    }

    const compiled = compileScenarios(playbook);
    for (const item of compiled) {
      await ctx.repositories.scenarios.upsert(item.scenario);
      await ctx.repositories.scenarios.saveAssets(item.assets);
      await writeGeneratedJson(
        `scenarios/${item.scenario.id}.json`,
        item.scenario
      );
      await writeGeneratedJson(
        `scenarios/${item.scenario.id}.assets.json`,
        item.assets
      );
    }

    await ctx.repositories.jobs.upsert({
      ...job,
      status: "completed",
      updatedAt: new Date().toISOString(),
    });

    return compiled.map((item) => item.scenario);
  } catch (error) {
    await ctx.repositories.jobs.upsert({
      ...job,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

export async function publishScenarioJob(input: unknown) {
  const parsed = publishScenarioRequestSchema.parse(input);
  const ctx = getAppContext();
  const job = createJob("scenario_publish", {
    scenarioId: parsed.scenarioId,
  });
  await ctx.repositories.jobs.upsert(job);

  try {
    const scenario = await ctx.repositories.scenarios.get(parsed.scenarioId);
    const assets = await ctx.repositories.scenarios.getAssets(parsed.scenarioId);
    if (!scenario || !assets) {
      throw new Error(`Scenario or assets not found: ${parsed.scenarioId}`);
    }
    const mappedProfile = await resolveMappedVoiceProfile(parsed.scenarioId);
    const resolvedVoice = await ctx.vendors.elevenLabs.resolveVoiceId(
      mappedProfile?.voiceId ?? ctx.env.DEFAULT_ELEVEN_VOICE_ID,
      scenario.language
    );
    const voiceSelection = mappedProfile
      ? buildProfileVoiceSelection({
          scenarioId: parsed.scenarioId,
          scenarioOpeningLine: scenario.openingLine,
          profile: mappedProfile,
          resolvedVoiceId: resolvedVoice.voiceId,
        })
      : buildLegacyVoiceSelection({
          scenarioId: parsed.scenarioId,
          scenarioOpeningLine: scenario.openingLine,
          resolvedVoiceId: resolvedVoice.voiceId,
          language: scenario.language,
        });

    const existingBinding = await ctx.repositories.agentBindings.get(parsed.scenarioId);
    const result = await publishScenarioAgent({
      elevenLabs: ctx.vendors.elevenLabs,
      scenario,
      assets,
      existingBinding,
      llmModel: ctx.env.DEFAULT_ELEVEN_MODEL,
      voiceSelection,
    });

    if (result.binding) {
      await ctx.repositories.agentBindings.upsert(result.binding);
      await ctx.repositories.scenarios.upsert({
        ...scenario,
        status: "published",
      });
    }

    const publishSnapshot = {
      ...result,
      voiceSelection: {
        mode: voiceSelection.mode,
        voiceProfileId:
          voiceSelection.mode === "profile"
            ? voiceSelection.voiceProfileId
            : undefined,
        candidateId: mappedProfile?.metadata?.candidateId,
        source: mappedProfile?.metadata?.source,
        gender: mappedProfile?.metadata?.gender,
        stage: mappedProfile?.metadata?.stage,
        label: voiceSelection.label,
        voiceId: voiceSelection.voiceId,
        ttsModel: voiceSelection.ttsModel,
        textNormalisationType: voiceSelection.textNormalisationType,
      },
      voiceResolution: resolvedVoice.resolution,
      voiceName: resolvedVoice.voiceName,
    };

    await writeGeneratedJson(`publish/${parsed.scenarioId}.json`, publishSnapshot);

    await ctx.repositories.jobs.upsert({
      ...job,
      status: result.passed ? "completed" : "failed",
      updatedAt: new Date().toISOString(),
      scenarioId: parsed.scenarioId,
      ...(result.passed ? {} : { error: "Agent tests failed" }),
    });

    return publishSnapshot;
  } catch (error) {
    await ctx.repositories.jobs.upsert({
      ...job,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
