import { DEFAULT_SCENARIO_IDS } from "../../packages/domain/src/scenario";
import { ensureEnvLoaded } from "../../apps/web/server/loadEnv";
import {
  DEFAULT_OPENAI_SECRET_NAME,
  DEFAULT_SECRET_SOURCE_PROJECT_ID,
  FIXED_TENANT_NAME,
  hasApplicationDefaultCredentials,
  secretExists,
} from "../../apps/web/server/secrets";

export const ACCEPTANCE_SCENARIO_ID = DEFAULT_SCENARIO_IDS.busy_manager_medium;
export const SCORECARD_SLA_MS = 60_000;

export type AcceptanceBlockerKind =
  | "missing_secret"
  | "missing_project"
  | "missing_seed"
  | "needs_manual_account"
  | "vendor_failure"
  | "app_failure";

export type AcceptanceBlocker = {
  kind: AcceptanceBlockerKind;
  step: string;
  detail: string;
  requiredInput?: string;
};

export type AcceptancePreflightReport = {
  ready: boolean;
  blockers: AcceptanceBlocker[];
  warnings: string[];
};

type PreflightDependencies = {
  hasApplicationDefaultCredentials: () => Promise<boolean>;
  secretExists: (secretName: string, secretProjectId: string) => Promise<boolean>;
};

const REQUIRED_SECRETS = [
  "ELEVENLABS_API_KEY",
  "LIVEAVATAR_API_KEY",
  "QUEUE_SHARED_SECRET",
] as const;

const OPTIONAL_DEFAULTS = [
  "DEFAULT_ELEVEN_MODEL",
  "DEFAULT_ELEVEN_VOICE_ID",
  "DEFAULT_AVATAR_ID",
  "OPENAI_ANALYSIS_MODEL",
  "OPENAI_MINING_MODEL",
] as const;

const UNSET_SENTINELS = new Set(["unset_avatar", "unset_voice"]);

export function getRawEnv(
  source: Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
  ensureEnvLoaded();
  return source;
}

export function getConfiguredValue(
  source: Record<string, string | undefined>,
  key: string
) {
  const value = source[key]?.trim();
  if (!value) {
    return undefined;
  }

  return UNSET_SENTINELS.has(value) ? undefined : value;
}

export function isLocalAppBaseUrl(appBaseUrl: string) {
  try {
    const url = new URL(appBaseUrl);
    return ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function evaluateScorecardSla(
  elapsedMs: number,
  limitMs = SCORECARD_SLA_MS
) {
  return {
    elapsedMs,
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(1)),
    limitMs,
    passed: elapsedMs <= limitMs,
  };
}

export async function buildBasePreflightReport(
  source: Record<string, string | undefined> = process.env,
  dependencies: PreflightDependencies = {
    hasApplicationDefaultCredentials,
    secretExists,
  }
): Promise<AcceptancePreflightReport> {
  const env = getRawEnv(source);
  const blockers: AcceptanceBlocker[] = [];
  const warnings: string[] = [];
  const secretSourceProjectId =
    getConfiguredValue(env, "SECRET_SOURCE_PROJECT_ID") ??
    DEFAULT_SECRET_SOURCE_PROJECT_ID;

  if (!getConfiguredValue(env, "FIREBASE_PROJECT_ID")) {
    blockers.push({
      kind: "missing_project",
      step: "bootstrap:vendors",
      detail:
        "FIREBASE_PROJECT_ID が未設定のため、Firestore と Cloud Tasks の target project を安全に確定できません。",
      requiredInput: "FIREBASE_PROJECT_ID",
    });
  }

  if (!getConfiguredValue(env, "SECRET_SOURCE_PROJECT_ID")) {
    blockers.push({
      kind: "missing_project",
      step: "OpenAI secret source",
      detail:
        "SECRET_SOURCE_PROJECT_ID が未設定です。OpenAI key fallback の参照先 project を明示する必要があります。",
      requiredInput: "SECRET_SOURCE_PROJECT_ID",
    });
  }

  const hasAdc = await dependencies.hasApplicationDefaultCredentials();
  if (!hasAdc && !getConfiguredValue(env, "FIREBASE_CREDENTIALS_SECRET_NAME")) {
    blockers.push({
      kind: "needs_manual_account",
      step: "Firestore / Firebase Admin",
      detail:
        "ADC が利用できないため、Firebase Admin credential fallback の secret 名が必要です。",
      requiredInput: "FIREBASE_CREDENTIALS_SECRET_NAME",
    });
  } else if (hasAdc) {
    warnings.push(
      "Firestore / Firebase Admin は ADC を優先して使用します。FIREBASE_CREDENTIALS_SECRET_NAME は現時点では不要です。"
    );
  }

  const openAiSecretAvailable = await dependencies.secretExists(
    DEFAULT_OPENAI_SECRET_NAME,
    secretSourceProjectId
  );
  if (!openAiSecretAvailable && !getConfiguredValue(env, "OPENAI_API_KEY")) {
    blockers.push({
      kind: "missing_secret",
      step: "build:playbooks / analyze-session",
      detail: `OPENAI_API_KEY は env 未設定で、canonical secret projects/${secretSourceProjectId}/secrets/${DEFAULT_OPENAI_SECRET_NAME} も見つかりません。`,
      requiredInput: `OpenAI secret in ${secretSourceProjectId}`,
    });
  } else if (openAiSecretAvailable) {
    warnings.push(
      `OpenAI key は projects/${secretSourceProjectId}/secrets/${DEFAULT_OPENAI_SECRET_NAME} から解決できます。`
    );
  } else {
    warnings.push(
      "OPENAI_API_KEY env override が設定されているため実行は可能ですが、canonical Secret Manager secret は未確認です。"
    );
  }

  for (const key of REQUIRED_SECRETS) {
    if (!getConfiguredValue(env, key)) {
      blockers.push({
        kind: "missing_secret",
        step:
          key === "ELEVENLABS_API_KEY"
            ? "bootstrap:vendors / publish:scenario / smoke:eleven"
            : key === "LIVEAVATAR_API_KEY"
              ? "bootstrap:vendors / smoke:liveavatar / sessions"
              : "analyze-session auth / local queue simulation",
        detail: `${key} が未設定のため、vendor acceptance を開始できません。`,
        requiredInput: key,
      });
    }
  }

  if (!getConfiguredValue(env, "DEFAULT_ELEVEN_VOICE_ID")) {
    blockers.push({
      kind: "needs_manual_account",
      step: "publish:scenario / smoke:eleven",
      detail:
        "DEFAULT_ELEVEN_VOICE_ID が未設定のため、ElevenLabs agent publish と smoke test の音声設定を確定できません。",
      requiredInput: "DEFAULT_ELEVEN_VOICE_ID",
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
  };
}

function renderValueOrBlank(
  source: Record<string, string | undefined>,
  key: string
) {
  return getConfiguredValue(source, key) ?? "";
}

export function buildRequiredInputsBlock(
  source: Record<string, string | undefined> = process.env,
  options?: {
    includeFirebaseCredentialSecret?: boolean;
    includeVendorSecrets?: boolean;
  }
) {
  const env = getRawEnv(source);
  const queueRegion = renderValueOrBlank(env, "CLOUD_TASKS_QUEUE_REGION");
  const queueName = renderValueOrBlank(env, "CLOUD_TASKS_QUEUE_ANALYZE");
  const queueSummary =
    queueRegion || queueName
      ? [queueRegion, queueName].filter(Boolean).join(" / ")
      : "";
  const includeVendorSecrets = options?.includeVendorSecrets ?? true;
  let sectionIndex = 1;
  const lines = ["=== REQUIRED INPUTS ===", `tenant: ${FIXED_TENANT_NAME}`];

  lines.push(`${sectionIndex}. FIREBASE_PROJECT_ID`);
  lines.push(`   - value: ${renderValueOrBlank(env, "FIREBASE_PROJECT_ID")}`);
  sectionIndex += 1;

  lines.push(`${sectionIndex}. DEFAULT_ELEVEN_VOICE_ID`);
  lines.push(
    `   - value: ${renderValueOrBlank(env, "DEFAULT_ELEVEN_VOICE_ID")}`
  );
  sectionIndex += 1;

  lines.push(`${sectionIndex}. QUEUE_SHARED_SECRET`);
  lines.push("   - value:");
  sectionIndex += 1;

  if (options?.includeFirebaseCredentialSecret) {
    lines.push(`${sectionIndex}. FIREBASE_CREDENTIALS_SECRET_NAME`);
    lines.push(
      `   - value: ${renderValueOrBlank(env, "FIREBASE_CREDENTIALS_SECRET_NAME")}`
    );
    sectionIndex += 1;
  }

  if (includeVendorSecrets) {
    lines.push(`${sectionIndex}. Vendor credentials`);
    lines.push("   - ELEVENLABS_API_KEY:");
    lines.push("   - LIVEAVATAR_API_KEY:");
    sectionIndex += 1;
  }

  lines.push(`${sectionIndex}. Project context`);
  lines.push(`   - GCLOUD_LOCATION: ${renderValueOrBlank(env, "GCLOUD_LOCATION")}`);
  lines.push(`   - Cloud Tasks queue region/name: ${queueSummary}`);
  sectionIndex += 1;
  lines.push(`${sectionIndex}. Optional defaults`);
  lines.push(
    ...OPTIONAL_DEFAULTS.map((key) => `   - ${key}: ${renderValueOrBlank(env, key)}`)
  );
  sectionIndex += 1;
  lines.push(`${sectionIndex}. Account-side confirmations`);
  lines.push(
    `   - SECRET_SOURCE_PROJECT_ID: ${renderValueOrBlank(env, "SECRET_SOURCE_PROJECT_ID") || DEFAULT_SECRET_SOURCE_PROJECT_ID}`
  );
  lines.push("   - target project はこれで確定か:");
  lines.push("   - 既存 Firestore を使ってよいか:");
  lines.push("   - LiveAvatar 側で ElevenLabs secret を自動作成してよいか:");

  return lines.join("\n");
}

export function buildWhyNeededBlock(options?: {
  includeFirebaseCredentialSecret?: boolean;
}) {
  const lines = [
    "=== WHY NEEDED ===",
    "- FIREBASE_PROJECT_ID: Firestore の runtime settings 書き込み、seed 判定、Cloud Tasks parent path を安全に確定するため。",
    "- DEFAULT_ELEVEN_VOICE_ID: scenario publish と smoke:eleven の音声設定を確定するため。",
    "- QUEUE_SHARED_SECRET: /api/internal/analyze-session の認証と、local queue simulation を実行するため。",
    "- ELEVENLABS_API_KEY: vendor bootstrap、scenario publish、smoke:eleven を通すため。",
    "- LIVEAVATAR_API_KEY: avatar session start、transcript polling、smoke:liveavatar を通すため。",
    `- SECRET_SOURCE_PROJECT_ID: OpenAI key fallback の参照先を固定し、active gcloud project に依存しないため。既定値は ${DEFAULT_SECRET_SOURCE_PROJECT_ID} です。`,
    `- OpenAI API Key: env 未設定時は projects/${DEFAULT_SECRET_SOURCE_PROJECT_ID}/secrets/${DEFAULT_OPENAI_SECRET_NAME} を使うため、通常は追加入力不要です。`,
    "- GCLOUD_LOCATION: App Hosting と acceptance 実行先の地域設定を揃えるため。",
    "- Cloud Tasks queue region/name: /api/sessions/[id]/end から analyze-session を enqueue する先を確定するため。",
    "- DEFAULT_ELEVEN_MODEL: publish 時の agent model を確定するため。",
    "- DEFAULT_AVATAR_ID: acceptance で使う avatar を固定したい場合に必要です。未指定なら public avatar shortlist の先頭を使います。",
    "- OPENAI_ANALYSIS_MODEL: scorecard 生成モデルを固定するため。",
    "- OPENAI_MINING_MODEL: playbook mining モデルを固定するため。",
    "- target project はこれで確定か: 書き込み先 Firestore / App Hosting project を誤らないため。",
    "- 既存 Firestore を使ってよいか: 既存 playbook / scenario / binding を再利用するか判断するため。",
    "- LiveAvatar 側で ElevenLabs secret を自動作成してよいか: bootstrap の refresh-secret 実行可否を確定するため。",
  ];

  if (options?.includeFirebaseCredentialSecret) {
    lines.splice(
      4,
      0,
      "- FIREBASE_CREDENTIALS_SECRET_NAME: ADC が使えない場合のみ、Firebase Admin credential fallback の secret 名を明示するため。"
    );
  }

  return lines.join("\n");
}

export function buildNextCommandsBlock(
  source: Record<string, string | undefined> = process.env
) {
  const env = getRawEnv(source);
  const appBaseUrl = renderValueOrBlank(env, "APP_BASE_URL");
  const commands = isLocalAppBaseUrl(appBaseUrl)
    ? ["pnpm bootstrap:vendors", "pnpm verify:acceptance"]
    : ["pnpm bootstrap:vendors", "pnpm verify:acceptance"];

  return [
    "=== NEXT COMMANDS AFTER INPUT ===",
    ...commands.map((command) => `- ${command}`),
  ].join("\n");
}

export function buildHumanInputRequest(
  source: Record<string, string | undefined> = process.env,
  options?: {
    includeFirebaseCredentialSecret?: boolean;
    includeVendorSecrets?: boolean;
  }
) {
  return [
    buildRequiredInputsBlock(source, options),
    "",
    buildWhyNeededBlock(options),
    "",
    buildNextCommandsBlock(source),
  ].join("\n");
}

export function formatPreflightReport(report: AcceptancePreflightReport) {
  const lines = ["Acceptance preflight"];

  if (report.blockers.length === 0) {
    lines.push("- status: ready");
  } else {
    lines.push("- status: blocked");
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker.kind}: ${blocker.step} - ${blocker.detail}`);
    }
  }

  for (const warning of report.warnings) {
    lines.push(`- warning: ${warning}`);
  }

  return lines.join("\n");
}
