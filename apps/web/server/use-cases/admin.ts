import { randomUUID } from "node:crypto";
import {
  aggregatePlaybook,
  assertScenarioVoiceProfileAvailable,
  buildAccountingPlaybookFromArtifacts,
  buildLegacyVoiceSelection,
  buildProfileVoiceSelection,
  compileAccountingScenario,
  compileScenarios,
  compileStaffingReferenceScenario,
  evaluateCompiledAccountingScenario,
  extractAccountingArtifactsForTranscript,
  importCorpusFromWorkbook,
  importTranscriptsFromDirectory,
  loadVoiceProfile,
  mineTranscriptBehaviors,
  publishScenarioAgent,
  renderCanonicalTranscriptReview,
  renderDerivedArtifactReviewMarkdown,
  resolveMappedVoiceProfile,
  runAccountingLocalEval,
} from "@top-performer/scenario-engine";
import {
  ACCOUNTING_ACCEPTANCE_REFERENCE_ARTIFACT,
  ACCOUNTING_CORPUS_SOT_ID,
  ACCOUNTING_SCENARIO_FAMILY,
  compileScenariosRequestSchema,
  playbookBuildRequestSchema,
  publishScenarioRequestSchema,
  transcriptImportRequestSchema,
  type JobRecord,
} from "@top-performer/domain";
import { getAppContext } from "../appContext";
import {
  resolveWorkspacePath,
  writeGeneratedJson,
  writeGeneratedText,
} from "../workspace";
import { HttpError, normalizeAgentTtsModelId } from "@top-performer/vendors";

function createJob(type: JobRecord["type"], metadata: JobRecord["metadata"] = {}) {
  const now = new Date().toISOString();
  const sanitizedMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined)
  );
  return {
    jobId: `job_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    type,
    status: "running" as const,
    createdAt: now,
    updatedAt: now,
    metadata: sanitizedMetadata,
  };
}

export function buildElevenLabsDashboardLinks(elevenAgentId: string) {
  return {
    agentUrl: `https://elevenlabs.io/app/conversational-ai/agents/${elevenAgentId}`,
    orbPreviewUrl: `https://elevenlabs.io/app/talk-to?agent_id=${elevenAgentId}`,
  };
}

export async function importTranscriptsJob(input: unknown) {
  const parsed = transcriptImportRequestSchema.parse(input);
  const ctx = getAppContext();
  const job = createJob("transcript_import", { path: parsed.path });
  await ctx.repositories.jobs.upsert(job);

  try {
    const resolvedPath = resolveWorkspacePath(parsed.path);
    if (parsed.mode === "v2" || resolvedPath.toLowerCase().endsWith(".xlsx")) {
      const imported = await importCorpusFromWorkbook({
        workbookPath: resolvedPath,
        manifestPath: resolveWorkspacePath(
          parsed.manifestPath ??
            "./data/transcripts/corpora/enterprise_accounting_ap_gold_v1.manifest.json"
        ),
      });

      await ctx.repositories.transcripts.saveCorpusManifest(imported.manifest);
      await writeGeneratedJson(
        `corpus/${ACCOUNTING_CORPUS_SOT_ID}/manifest.json`,
        imported.manifest
      );

      for (const sourceRecord of imported.sourceRecords) {
        await ctx.repositories.transcripts.upsertSourceRecord(sourceRecord);
        await writeGeneratedJson(
          `corpus/${ACCOUNTING_CORPUS_SOT_ID}/source-records/${sourceRecord.id}.json`,
          sourceRecord
        );
      }

      for (const transcript of imported.canonicalTranscripts) {
        await ctx.repositories.transcripts.upsertCanonicalTranscript(transcript);
        await writeGeneratedJson(
          `corpus/${ACCOUNTING_CORPUS_SOT_ID}/canonical/${transcript.id}.json`,
          transcript
        );
        await writeGeneratedText(
          `corpus/${ACCOUNTING_CORPUS_SOT_ID}/reviews/${transcript.id}.md`,
          renderCanonicalTranscriptReview(transcript)
        );
      }

      await ctx.repositories.jobs.upsert({
        ...job,
        status: "completed",
        updatedAt: new Date().toISOString(),
        metadata: {
          ...job.metadata,
          mode: "v2",
          sourceRecordCount: imported.sourceRecords.length,
          canonicalTranscriptCount: imported.canonicalTranscripts.length,
          corpusId: imported.manifest.corpusId,
        },
      });

      return {
        jobId: job.jobId,
        mode: "v2",
        corpusId: imported.manifest.corpusId,
        sourceRecordCount: imported.sourceRecords.length,
        canonicalTranscriptCount: imported.canonicalTranscripts.length,
      };
    }

    const transcripts = await importTranscriptsFromDirectory(resolvedPath);
    for (const transcript of transcripts) {
      await ctx.repositories.transcripts.upsert(transcript);
      await writeGeneratedJson(`transcripts/${transcript.id}.json`, transcript);
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
    if (parsed.mode === "v2" || parsed.family === ACCOUNTING_SCENARIO_FAMILY) {
      const manifest = await ctx.repositories.transcripts.getCorpusManifest(
        ACCOUNTING_CORPUS_SOT_ID
      );
      if (!manifest) {
        throw new Error("Accounting corpus manifest not found. Run transcript import first.");
      }

      const goldEntries = manifest.entries.filter((entry) => entry.tier === "gold");
      const canonicalTranscripts =
        await ctx.repositories.transcripts.listCanonicalTranscripts({
          corpusId: manifest.corpusId,
          ids: goldEntries.map((entry) => entry.transcriptId),
        });

      const scenarioSettings = [];
      const roleSipocs = [];
      const cultureFits = [];
      const topPerformerBehaviors = [];

      for (const transcript of canonicalTranscripts) {
        const extracted = await extractAccountingArtifactsForTranscript({
          client: ctx.vendors.openAi,
          model: ctx.env.OPENAI_MINING_MODEL,
          transcript,
        });

        scenarioSettings.push(extracted.scenarioSetting);
        roleSipocs.push(extracted.roleSipoc);
        cultureFits.push(extracted.cultureFit);
        topPerformerBehaviors.push(extracted.topPerformerBehavior);

        for (const envelope of extracted.envelopes) {
          await ctx.repositories.transcripts.saveDerivedArtifact(envelope);
          await writeGeneratedJson(
            `corpus/${manifest.corpusId}/derived/${transcript.id}.${envelope.kind}.json`,
            envelope
          );
        }

        await writeGeneratedText(
          `corpus/${manifest.corpusId}/derived/${transcript.id}.review.md`,
          renderDerivedArtifactReviewMarkdown({
            transcript,
            envelopes: extracted.envelopes,
          })
        );
      }

      const playbook = buildAccountingPlaybookFromArtifacts({
        version: `pb_${new Date().toISOString().slice(0, 10).replaceAll("-", "_")}_accounting_v2`,
        scenarioSettings,
        roleSipocs,
        cultureFits,
        topPerformerBehaviors,
        humanApprovedTranscriptIds: goldEntries
          .filter((entry) => entry.humanApproved)
          .map((entry) => entry.transcriptId),
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
    }

    const transcripts = await ctx.repositories.transcripts.listByFamily(parsed.family);
    const extractions = [];
    for (const transcript of transcripts) {
      const extraction = await mineTranscriptBehaviors({
        client: ctx.vendors.openAi,
        model: ctx.env.OPENAI_MINING_MODEL,
        transcript,
      });
      await ctx.repositories.transcripts.saveExtraction(extraction);
      await writeGeneratedJson(`playbooks/extractions/${transcript.id}.json`, extraction);
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
    family: parsed.family,
  });
  await ctx.repositories.jobs.upsert(job);

  try {
    if (
      parsed.family === "staffing_order_hearing" &&
      parsed.referenceArtifactPath
    ) {
      const compiled = await compileStaffingReferenceScenario({
        referenceArtifactPath: resolveWorkspacePath(parsed.referenceArtifactPath),
      });

      await ctx.repositories.scenarios.upsert(compiled.scenario);
      await ctx.repositories.scenarios.saveAssets(compiled.assets);
      await writeGeneratedJson(`scenarios/${compiled.scenario.id}.json`, compiled.scenario);
      await writeGeneratedJson(
        `scenarios/${compiled.scenario.id}.assets.json`,
        compiled.assets
      );

      await ctx.repositories.jobs.upsert({
        ...job,
        status: "completed",
        updatedAt: new Date().toISOString(),
        metadata: {
          ...job.metadata,
          scenarioId: compiled.scenario.id,
          mode: "staffing_reference",
          referenceArtifactPath: parsed.referenceArtifactPath,
        },
      });

      return [compiled.scenario];
    }

    if (parsed.mode === "v2" || parsed.family === ACCOUNTING_SCENARIO_FAMILY) {
      const accountingPlaybookVersion =
        parsed.playbookVersion ??
        (await ctx.repositories.playbooks.list()).find(
          (item) => item.family === ACCOUNTING_SCENARIO_FAMILY
        )?.version;
      if (!accountingPlaybookVersion) {
        throw new Error("playbookVersion is required for accounting v2 compile.");
      }
      const playbook = await ctx.repositories.playbooks.get(accountingPlaybookVersion);
      if (!playbook) {
        throw new Error(`Playbook not found: ${accountingPlaybookVersion}`);
      }
      const compiled = await compileAccountingScenario({
        playbook,
        referenceArtifactPath: resolveWorkspacePath(
          parsed.referenceArtifactPath ??
            `./docs/references/${ACCOUNTING_ACCEPTANCE_REFERENCE_ARTIFACT}`
        ),
        designMemoPath: resolveWorkspacePath(
          parsed.designMemoPath ??
            "./docs/references/accounting_clerk_enterprise_ap_100pt_analysis.md"
        ),
      });

      await ctx.repositories.scenarios.upsert(compiled.scenario);
      await ctx.repositories.scenarios.saveAssets(compiled.assets);
      await writeGeneratedJson(`scenarios/${compiled.scenario.id}.json`, compiled.scenario);
      await writeGeneratedJson(
        `scenarios/${compiled.scenario.id}.assets.json`,
        compiled.assets
      );
      await writeGeneratedJson(
        `corpus/${ACCOUNTING_CORPUS_SOT_ID}/scenario-pack-v2.json`,
        compiled.scenarioV2
      );
      await writeGeneratedJson(
        `corpus/${ACCOUNTING_CORPUS_SOT_ID}/scenario-acceptance.json`,
        compiled.acceptance
      );

      await ctx.repositories.jobs.upsert({
        ...job,
        status: "completed",
        updatedAt: new Date().toISOString(),
        metadata: {
          ...job.metadata,
          scenarioId: compiled.scenario.id,
          mode: "v2",
          playbookVersion: accountingPlaybookVersion,
        },
      });

      return [compiled.scenario];
    }

    if (!parsed.playbookVersion) {
      throw new Error("playbookVersion is required.");
    }

    const playbook = await ctx.repositories.playbooks.get(parsed.playbookVersion);
    if (!playbook) {
      throw new Error(`Playbook not found: ${parsed.playbookVersion}`);
    }

    const compiled = compileScenarios(playbook);
    for (const item of compiled) {
      await ctx.repositories.scenarios.upsert(item.scenario);
      await ctx.repositories.scenarios.saveAssets(item.assets);
      await writeGeneratedJson(`scenarios/${item.scenario.id}.json`, item.scenario);
      await writeGeneratedJson(`scenarios/${item.scenario.id}.assets.json`, item.assets);
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
    if (scenario.family === ACCOUNTING_SCENARIO_FAMILY) {
      const acceptance = await evaluateCompiledAccountingScenario({
        scenario,
        assets,
        referenceArtifactPath: resolveWorkspacePath(
          `./docs/references/${ACCOUNTING_ACCEPTANCE_REFERENCE_ARTIFACT}`
        ),
      });
      const localEval = await runAccountingLocalEval({
        client: ctx.vendors.openAi,
        model: ctx.env.OPENAI_ANALYSIS_MODEL,
        scenario,
        assets,
      });
      await writeGeneratedJson(
        `publish/${parsed.scenarioId}.local-eval.json`,
        {
          acceptance,
          localEval,
        }
      );
      if (!acceptance.semanticAcceptancePassed || !localEval.passed) {
        throw new Error(
          `Local accounting eval gate failed for ${parsed.scenarioId}: ${JSON.stringify({
            acceptance,
            localEval,
          })}`
        );
      }
    }
    const requestedProfile = parsed.voiceProfileId
      ? await loadVoiceProfile(parsed.voiceProfileId)
      : null;
    if (
      requestedProfile?.metadata?.scenarioIds &&
      requestedProfile.metadata.scenarioIds.length > 0 &&
      !requestedProfile.metadata.scenarioIds.includes(parsed.scenarioId)
    ) {
      throw new Error(
        `Voice profile ${requestedProfile.id} does not support scenario ${parsed.scenarioId}.`
      );
    }

    const mappedProfile = assertScenarioVoiceProfileAvailable({
      scenarioId: parsed.scenarioId,
      purpose: "publish",
      profile:
        requestedProfile ??
        (await resolveMappedVoiceProfile(parsed.scenarioId)),
      ...(scenario.publishContract?.dictionaryRequired !== undefined
        ? { dictionaryRequired: scenario.publishContract.dictionaryRequired }
        : {}),
    });
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

    const existingBinding = parsed.abTest
      ? null
      : await ctx.repositories.agentBindings.get(parsed.scenarioId);
    let result;
    try {
      result = await publishScenarioAgent({
        elevenLabs: ctx.vendors.elevenLabs,
        scenario,
        assets,
        existingBinding,
        llmModel: ctx.env.DEFAULT_ELEVEN_MODEL,
        voiceSelection,
      });
    } catch (error) {
      const publishBlockedByExpressiveTts =
        error instanceof HttpError &&
        voiceSelection.ttsModel === "eleven_v3" &&
        typeof error.body === "object" &&
        error.body !== null &&
        "detail" in error.body &&
        typeof error.body.detail === "object" &&
        error.body.detail !== null &&
        "status" in error.body.detail &&
        error.body.detail.status === "expressive_tts_not_allowed";

      if (publishBlockedByExpressiveTts) {
        const detail =
          typeof error.body === "object" &&
          error.body !== null &&
          "detail" in error.body &&
          typeof error.body.detail === "object" &&
          error.body.detail !== null
            ? error.body.detail
            : null;
        const requestPath = error.message.replace(/^HTTP \d+ for /, "");
        let requestPathWithQuery = requestPath;
        let branchId = "unknown";
        try {
          const requestPathUrl = new URL(requestPath);
          requestPathWithQuery = `${requestPathUrl.pathname}${requestPathUrl.search}`;
          branchId = requestPathUrl.searchParams.get("branch_id") ?? "unknown";
        } catch {
          requestPathWithQuery = requestPath;
        }
        const errorCode =
          detail && "code" in detail && typeof detail.code === "string"
            ? detail.code
            : "unknown";
        const errorMessage =
          detail && "message" in detail && typeof detail.message === "string"
            ? detail.message
            : "Unknown error";

        throw new Error(
          `ElevenLabs agent publish failed for ${parsed.scenarioId} with expressive_tts_not_allowed. branch_id=${branchId} request_path=${requestPathWithQuery} sent_tts_model_id=${normalizeAgentTtsModelId(
            voiceSelection.ttsModel
          )} original_tts_model_id=${voiceSelection.ttsModel} agent_output_audio_format=pcm_24000 vendor_request_id=${error.vendorRequestId ?? "unknown"} error_code=${errorCode} error_message=${errorMessage}`
        );
      }

      throw error;
    }

    if (result.binding && !parsed.abTest) {
      await ctx.repositories.agentBindings.upsert(result.binding);
      await ctx.repositories.scenarios.upsert({
        ...scenario,
        status: "published",
      });
    }

    const elevenAgentId = result.binding?.elevenAgentId ?? result.testRun?.agent_id;
    const publishSnapshot = {
      scenarioId: parsed.scenarioId,
      elevenAgentId,
      voiceId: voiceSelection.voiceId,
      ttsModel: voiceSelection.ttsModel,
      testRunId: result.testRun?.id,
      ...(parsed.abTest ? { abTest: true } : {}),
      ...(elevenAgentId
        ? { dashboard: buildElevenLabsDashboardLinks(elevenAgentId) }
        : {}),
      ...result,
      scenarioVersion: scenario.version,
      promptSections: assets.promptSections,
      platformConfig: assets.platformConfig,
      semanticAcceptance: assets.semanticAcceptance,
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
        selectionSource: parsed.voiceProfileId
          ? "override"
          : mappedProfile
            ? "mapping"
            : "legacy",
        label: voiceSelection.label,
        voiceId: voiceSelection.voiceId,
        ttsModel: voiceSelection.ttsModel,
        textNormalisationType: voiceSelection.textNormalisationType,
      },
      voiceResolution: resolvedVoice.resolution,
      voiceName: resolvedVoice.voiceName,
    };

    if (parsed.abTest) {
      await writeGeneratedJson(
        `publish/${parsed.scenarioId}.ab-test.json`,
        publishSnapshot
      );
    } else {
      await writeGeneratedJson(`publish/${parsed.scenarioId}.json`, publishSnapshot);
      await writeGeneratedJson(
        `publish/${parsed.scenarioId}.${scenario.version}.json`,
        publishSnapshot
      );
    }

    await ctx.repositories.jobs.upsert({
      ...job,
      status: result.passed ? "completed" : "failed",
      updatedAt: new Date().toISOString(),
      scenarioId: parsed.scenarioId,
      metadata: {
        ...job.metadata,
        ...(parsed.abTest ? { abTest: true } : {}),
        ...(parsed.voiceProfileId
          ? { voiceProfileId: parsed.voiceProfileId }
          : {}),
      },
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
