import { z } from "zod";
import {
  enqueueAdeccoBrowserEvaluationTask,
  type AdeccoBrowserEvaluationTaskPayload,
} from "@/server/cloudTasks";
import { getAppContext } from "@/server/appContext";
import {
  runAdeccoOrderHearingScoring,
  type NormalizedTurn,
} from "./adeccoOrderHearingEval";

const SAFE_EVAL_ERROR =
  "評価に失敗しました。時間をおいて再試行してください。";
const EVALUATION_FORMAT = "adecco_order_hearing_browser_v1";
const EVALUATION_PROFILE = "adecco_order_hearing_eval_v2";
const BROWSER_EVAL_SOURCES = [
  "grok_first_v50_7_browser",
  "grok_first_v51_browser",
] as const;
type BrowserEvalSource = (typeof BROWSER_EVAL_SOURCES)[number];

export function isAdeccoBrowserEvaluationEnabled() {
  return process.env["ADECCO_BROWSER_EVAL_ENABLED"] !== "0";
}

export const adeccoBrowserEvalSessionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const browserTranscriptTurnSchema = z.object({
  turn_id: z.string().min(1).max(128),
  role: z.enum(["agent", "user"]),
  text: z.string(),
  timestamp_sec: z.number().finite().nonnegative().optional(),
});

export const adeccoBrowserEvalStartSchema = z.object({
  sessionId: adeccoBrowserEvalSessionIdSchema,
  conversationId: z.string().min(1).max(128).nullable().optional(),
  transcript: z.array(browserTranscriptTurnSchema),
  startedAt: z.string().min(1).optional(),
  endedAt: z.string().min(1).optional(),
  source: z.enum(BROWSER_EVAL_SOURCES).optional(),
});

const normalizedTurnSchema = z.object({
  turn_id: z.string().min(1),
  speaker: z.enum(["sales", "client", "unknown"]),
  text: z.string(),
  timestamp_sec: z.number().finite().nonnegative(),
});

export const adeccoBrowserEvalTaskSchema = z.object({
  sessionId: adeccoBrowserEvalSessionIdSchema,
  conversationId: z.string().min(1).nullable(),
  transcript: z.array(normalizedTurnSchema).min(2),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  source: z.enum(BROWSER_EVAL_SOURCES),
  runtimeVersion: z.enum(["v50-7", "v51"]),
});

export type AdeccoBrowserEvalStartInput = z.infer<
  typeof adeccoBrowserEvalStartSchema
>;

export function normalizeBrowserEvalTranscript(
  turns: AdeccoBrowserEvalStartInput["transcript"]
): NormalizedTurn[] {
  return turns
    .map((turn, index) => ({
      turn_id: turn.turn_id || `t${String(index + 1).padStart(3, "0")}`,
      speaker: turn.role === "user" ? ("sales" as const) : ("client" as const),
      text: turn.text.trim(),
      timestamp_sec: turn.timestamp_sec ?? index,
    }))
    .filter((turn) => turn.text.length > 0);
}

export async function startAdeccoBrowserEvaluation(
  input: AdeccoBrowserEvalStartInput
) {
  const transcript = normalizeBrowserEvalTranscript(input.transcript);
  if (transcript.length < 2) {
    throw new Error("transcript must contain at least two non-empty turns");
  }

  const now = new Date().toISOString();
  const payload: AdeccoBrowserEvaluationTaskPayload = {
    sessionId: input.sessionId,
    conversationId: input.conversationId ?? null,
    transcript,
    startedAt: input.startedAt ?? now,
    endedAt: input.endedAt ?? now,
    source: input.source ?? "grok_first_v50_7_browser",
    runtimeVersion: runtimeVersionForSource(
      input.source ?? "grok_first_v50_7_browser"
    ),
  };

  await saveBrowserEvalStatus(input.sessionId, "queued", {
    runtimeVersion: payload.runtimeVersion,
  });
  await saveBrowserEvalRequest(payload);

  if (
    process.env["ADECCO_BROWSER_EVAL_INLINE"] === "1" &&
    process.env["NODE_ENV"] !== "production"
  ) {
    void processAdeccoBrowserEvaluationTask(payload).catch((error) => {
      console.error(
        "adecco_browser_eval_inline_failed",
        error instanceof Error ? error.message : String(error)
      );
    });
    return { taskName: "inline" };
  }

  const taskName = await enqueueAdeccoBrowserEvaluationTask(payload);
  return { taskName };
}

export async function retryAdeccoBrowserEvaluation(sessionId: string) {
  const request = await getAppContext().repositories.sessions.getArtifact(
    sessionId,
    "adecco_browser_eval_request"
  );
  const parsed = adeccoBrowserEvalTaskSchema.safeParse(request?.payload);
  if (!parsed.success) {
    return { retryAvailable: false as const, taskName: null };
  }

  await saveBrowserEvalStatus(sessionId, "queued", {
    runtimeVersion: parsed.data.runtimeVersion,
  });
  if (
    process.env["ADECCO_BROWSER_EVAL_INLINE"] === "1" &&
    process.env["NODE_ENV"] !== "production"
  ) {
    void processAdeccoBrowserEvaluationTask(parsed.data).catch((error) => {
      console.error(
        "adecco_browser_eval_inline_retry_failed",
        error instanceof Error ? error.message : String(error)
      );
    });
    return { retryAvailable: true as const, taskName: "inline" };
  }

  const taskName = await enqueueAdeccoBrowserEvaluationTask(parsed.data);
  return { retryAvailable: true as const, taskName };
}

export async function processAdeccoBrowserEvaluationTask(
  rawPayload: unknown
) {
  const payload = adeccoBrowserEvalTaskSchema.parse(rawPayload);
  try {
    await saveBrowserEvalStatus(payload.sessionId, "running", {
      runtimeVersion: payload.runtimeVersion,
    });
    const scoring = await runAdeccoOrderHearingScoring({
      sessionId: payload.sessionId,
      conversationId: payload.conversationId,
      transcript: payload.transcript,
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      transcriptSource: payload.source,
      asrQualityNote: payload.source,
    });
    const generatedAt = new Date().toISOString();
    const ctx = getAppContext();
    await ctx.repositories.sessions.saveArtifact({
      id: "scorecard",
      kind: "scorecard",
      sessionId: payload.sessionId,
      createdAt: generatedAt,
      payload: {
        evaluationFormat: EVALUATION_FORMAT,
        evaluationProfile: EVALUATION_PROFILE,
        runtimeVersion: payload.runtimeVersion,
        scenarioId: scoring.scenarioId,
        sessionId: scoring.sessionId,
        conversationId: scoring.conversationId,
        startedAt: scoring.startedAt,
        endedAt: scoring.endedAt,
        model: scoring.model,
        usage: scoring.usage,
        validation: scoring.validation,
        retryNote: scoring.retryNote,
        report: scoring.reportJson,
        generatedAt,
      },
    });
    await ctx.repositories.sessions.saveArtifact({
      id: "model_raw_output",
      kind: "model_raw_output",
      sessionId: payload.sessionId,
      createdAt: generatedAt,
      payload: {
        evaluationFormat: EVALUATION_FORMAT,
        evaluationProfile: EVALUATION_PROFILE,
        runtimeVersion: payload.runtimeVersion,
        sessionId: scoring.sessionId,
        conversationId: scoring.conversationId,
        model: scoring.model,
        usage: scoring.usage,
        rawClaudeText: scoring.rawClaudeText,
        validationJsonText: scoring.validationJsonText,
        createdAt: generatedAt,
      },
    });
    await saveBrowserEvalStatus(payload.sessionId, "completed", {
      runtimeVersion: payload.runtimeVersion,
      generatedAt,
    });
    return {
      status: "completed" as const,
      sessionId: payload.sessionId,
      validation: scoring.validation,
    };
  } catch (error) {
    const failurePayload: Record<string, unknown> = {
      error: SAFE_EVAL_ERROR,
      failedAt: new Date().toISOString(),
    };
    await saveBrowserEvalStatus(payload.sessionId, "failed", failurePayload);
    throw error;
  }
}

export async function getAdeccoBrowserEvaluationResult(sessionId: string) {
  const ctx = getAppContext();
  const statusArtifact = await ctx.repositories.sessions.getArtifact(
    sessionId,
    "adecco_eval_status"
  );
  const status = readStatus(statusArtifact?.payload);

  if (status === "failed") {
    return {
      ok: false,
      status,
      sessionId,
      error: SAFE_EVAL_ERROR,
      retryAvailable: await hasRetryRequest(sessionId),
    };
  }

  const scorecardArtifact = await ctx.repositories.sessions.getArtifact(
    sessionId,
    "scorecard"
  );
  const scorecard = scorecardArtifact?.payload;
  if (
    scorecard &&
    scorecard["evaluationFormat"] === EVALUATION_FORMAT &&
    typeof scorecard["report"] === "object"
  ) {
    return {
      ok: true,
      status: "completed" as const,
      sessionId,
      scorecard: {
        evaluationFormat: scorecard["evaluationFormat"],
        evaluationProfile: scorecard["evaluationProfile"],
        runtimeVersion: scorecard["runtimeVersion"],
        scenarioId: scorecard["scenarioId"],
        metadata: {
          sessionId: scorecard["sessionId"],
          conversationId: scorecard["conversationId"],
          startedAt: scorecard["startedAt"],
          endedAt: scorecard["endedAt"],
        },
        report: scorecard["report"],
        model: scorecard["model"],
        usage: scorecard["usage"],
        validation: scorecard["validation"],
        retryNote: scorecard["retryNote"],
        generatedAt: scorecard["generatedAt"],
      },
    };
  }

  if (status === "queued" || status === "running") {
    return {
      ok: true,
      status,
      sessionId,
    };
  }

  return {
    ok: true,
    status: "not_found" as const,
    sessionId,
  };
}

async function saveBrowserEvalRequest(
  payload: AdeccoBrowserEvaluationTaskPayload
) {
  await getAppContext().repositories.sessions.saveArtifact({
    id: "adecco_browser_eval_request",
    kind: "adecco_browser_eval_request",
    sessionId: payload.sessionId,
    createdAt: new Date().toISOString(),
    payload,
  });
}

async function saveBrowserEvalStatus(
  sessionId: string,
  status: "queued" | "running" | "completed" | "failed",
  extra: Record<string, unknown> = {}
) {
  await getAppContext().repositories.sessions.saveArtifact({
    id: "adecco_eval_status",
    kind: "adecco_eval_status",
    sessionId,
    createdAt: new Date().toISOString(),
    payload: {
      evaluationFormat: EVALUATION_FORMAT,
      evaluationProfile: EVALUATION_PROFILE,
      sessionId,
      status,
      updatedAt: new Date().toISOString(),
      ...extra,
    },
  });
}

function runtimeVersionForSource(source: BrowserEvalSource) {
  return source === "grok_first_v51_browser" ? "v51" : "v50-7";
}

async function hasRetryRequest(sessionId: string) {
  const request = await getAppContext().repositories.sessions.getArtifact(
    sessionId,
    "adecco_browser_eval_request"
  );
  return adeccoBrowserEvalTaskSchema.safeParse(request?.payload).success;
}

function readStatus(payload: Record<string, unknown> | undefined) {
  const status = payload?.["status"];
  if (
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "failed"
  ) {
    return status;
  }
  return null;
}
