import { CloudTasksClient } from "@google-cloud/tasks";
import { analyzeSessionRequestSchema } from "@top-performer/domain";
import { getAppContext } from "./appContext";

let clientSingleton: CloudTasksClient | null = null;

function getCloudTasksClient() {
  clientSingleton ??= new CloudTasksClient();
  return clientSingleton;
}

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

  const client = getCloudTasksClient();
  const parent = client.queuePath(
    FIREBASE_PROJECT_ID,
    CLOUD_TASKS_QUEUE_REGION,
    CLOUD_TASKS_QUEUE_ANALYZE
  );

  const payload = analyzeSessionRequestSchema.parse({ sessionId });
  await client.createTask({
    parent,
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
  });
}
