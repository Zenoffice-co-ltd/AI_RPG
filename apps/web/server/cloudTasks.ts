import { applicationDefault } from "firebase-admin/app";
import { analyzeSessionRequestSchema } from "@top-performer/domain";
import { getAppContext } from "./appContext";
import type { NormalizedTurn } from "./use-cases/adeccoOrderHearingEval";

export type AdeccoEvaluationTaskPayload = {
  sessionId: string;
  conversationId: string | null;
  agentId: string | null;
  transcript: NormalizedTurn[] | null;
};

export async function enqueueSessionAnalysis(sessionId: string) {
  const {
    env: {
      APP_BASE_URL,
      CLOUD_TASKS_QUEUE_ANALYZE,
      CLOUD_TASKS_QUEUE_REGION,
      FIREBASE_PROJECT_ID,
      QUEUE_SHARED_SECRET,
    },
  } = getAppContext();

  if (!FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID is required for Cloud Tasks");
  }

  const payload = analyzeSessionRequestSchema.parse({ sessionId });
  const accessToken = await applicationDefault().getAccessToken();
  const tokenValue = accessToken.access_token;

  if (!tokenValue) {
    throw new Error("Failed to acquire an access token for Cloud Tasks.");
  }

  const response = await fetch(
    `https://cloudtasks.googleapis.com/v2/projects/${FIREBASE_PROJECT_ID}/locations/${CLOUD_TASKS_QUEUE_REGION}/queues/${CLOUD_TASKS_QUEUE_ANALYZE}/tasks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenValue}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: {
          httpRequest: {
            httpMethod: "POST",
            url: `${APP_BASE_URL}/api/internal/analyze-session`,
            headers: {
              "Content-Type": "application/json",
              "x-queue-shared-secret": QUEUE_SHARED_SECRET,
            },
            body: Buffer.from(JSON.stringify(payload)).toString("base64"),
          },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Cloud Tasks enqueue failed with status ${response.status}: ${await response.text()}`
    );
  }
}

async function enqueueJsonTask(input: {
  url: string;
  payload: unknown;
}) {
  const {
    env: {
      CLOUD_TASKS_QUEUE_ANALYZE,
      CLOUD_TASKS_QUEUE_REGION,
      FIREBASE_PROJECT_ID,
      QUEUE_SHARED_SECRET,
    },
  } = getAppContext();

  if (!FIREBASE_PROJECT_ID) {
    throw new Error("FIREBASE_PROJECT_ID is required for Cloud Tasks");
  }

  const accessToken = await applicationDefault().getAccessToken();
  const tokenValue = accessToken.access_token;

  if (!tokenValue) {
    throw new Error("Failed to acquire an access token for Cloud Tasks.");
  }

  const response = await fetch(
    `https://cloudtasks.googleapis.com/v2/projects/${FIREBASE_PROJECT_ID}/locations/${CLOUD_TASKS_QUEUE_REGION}/queues/${CLOUD_TASKS_QUEUE_ANALYZE}/tasks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenValue}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: {
          httpRequest: {
            httpMethod: "POST",
            url: input.url,
            headers: {
              "Content-Type": "application/json",
              "x-queue-shared-secret": QUEUE_SHARED_SECRET,
            },
            body: Buffer.from(JSON.stringify(input.payload)).toString("base64"),
          },
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Cloud Tasks enqueue failed with status ${response.status}: ${await response.text()}`
    );
  }

  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  return typeof body?.["name"] === "string" ? body["name"] : null;
}

export async function enqueueAdeccoEvaluationTask(
  payload: AdeccoEvaluationTaskPayload
) {
  const { env } = getAppContext();
  return enqueueJsonTask({
    url: `${env.APP_BASE_URL}/api/internal/adecco-eval`,
    payload,
  });
}
