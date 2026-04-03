import {
  AgentBindingRepository,
  getFirestoreAdmin,
  JobRepository,
  PlaybookRepository,
  RuntimeSettingsRepository,
  ScenarioRepository,
  SessionRepository,
  TranscriptRepository,
} from "@top-performer/firestore";
import {
  ElevenLabsClient,
  LiveAvatarClient,
  loadServerEnv,
  OpenAiResponsesClient,
  type ServerEnv,
} from "@top-performer/vendors";
import { ensureEnvLoaded } from "./loadEnv";
import {
  DEFAULT_ELEVENLABS_SECRET_NAME,
  DEFAULT_LIVEAVATAR_SECRET_NAME,
  DEFAULT_OPENAI_SECRET_NAME,
  getEnvOrSecret,
} from "./secrets";

type AppContext = {
  env: ServerEnv;
  repositories: {
    agentBindings: AgentBindingRepository;
    jobs: JobRepository;
    playbooks: PlaybookRepository;
    runtimeSettings: RuntimeSettingsRepository;
    scenarios: ScenarioRepository;
    sessions: SessionRepository;
    transcripts: TranscriptRepository;
  };
  vendors: {
    elevenLabs: ElevenLabsClient;
    liveAvatar: LiveAvatarClient;
    openAi: OpenAiResponsesClient;
  };
};

let appContextSingleton: AppContext | null = null;

export function getAppContext(): AppContext {
  if (appContextSingleton) {
    return appContextSingleton;
  }

  ensureEnvLoaded();
  const env = loadServerEnv();
  const firestore = getFirestoreAdmin({
    ...(env.FIREBASE_PROJECT_ID ? { projectId: env.FIREBASE_PROJECT_ID } : {}),
    ...(env.FIREBASE_CLIENT_EMAIL
      ? { clientEmail: env.FIREBASE_CLIENT_EMAIL }
      : {}),
    ...(env.FIREBASE_PRIVATE_KEY ? { privateKey: env.FIREBASE_PRIVATE_KEY } : {}),
  });

  appContextSingleton = {
    env,
    repositories: {
      agentBindings: new AgentBindingRepository(firestore),
      jobs: new JobRepository(firestore),
      playbooks: new PlaybookRepository(firestore),
      runtimeSettings: new RuntimeSettingsRepository(firestore),
      scenarios: new ScenarioRepository(firestore),
      sessions: new SessionRepository(firestore),
      transcripts: new TranscriptRepository(firestore),
    },
    vendors: {
      elevenLabs: new ElevenLabsClient(() =>
        getEnvOrSecret(
          "ELEVENLABS_API_KEY",
          DEFAULT_ELEVENLABS_SECRET_NAME,
          env.SECRET_SOURCE_PROJECT_ID
        )
      ),
      liveAvatar: new LiveAvatarClient(() =>
        getEnvOrSecret(
          "LIVEAVATAR_API_KEY",
          DEFAULT_LIVEAVATAR_SECRET_NAME,
          env.SECRET_SOURCE_PROJECT_ID
        )
      ),
      openAi: new OpenAiResponsesClient(() =>
        getEnvOrSecret(
          "OPENAI_API_KEY",
          DEFAULT_OPENAI_SECRET_NAME,
          env.SECRET_SOURCE_PROJECT_ID
        )
      ),
    },
  };

  return appContextSingleton;
}
