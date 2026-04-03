import { DEFAULT_SCENARIO_IDS } from "../../packages/domain/src/scenario";
import { ensureEnvLoaded } from "../../apps/web/server/loadEnv";

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

const REQUIRED_SECRETS = [
  "OPENAI_API_KEY",
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

export function buildBasePreflightReport(
  source: Record<string, string | undefined> = process.env
): AcceptancePreflightReport {
  const env = getRawEnv(source);
  const blockers: AcceptanceBlocker[] = [];

  if (!getConfiguredValue(env, "FIREBASE_PROJECT_ID")) {
    blockers.push({
      kind: "missing_project",
      step: "bootstrap:vendors",
      detail:
        "FIREBASE_PROJECT_ID が未設定のため、Firestore と Cloud Tasks の target project を安全に確定できません。",
      requiredInput: "FIREBASE_PROJECT_ID",
    });
  }

  for (const key of REQUIRED_SECRETS) {
    if (!getConfiguredValue(env, key)) {
      blockers.push({
        kind: "missing_secret",
        step:
          key === "OPENAI_API_KEY"
            ? "build:playbooks / analyze-session"
            : key === "ELEVENLABS_API_KEY"
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
    warnings: [],
  };
}

function renderValueOrBlank(
  source: Record<string, string | undefined>,
  key: string
) {
  return getConfiguredValue(source, key) ?? "";
}

export function buildRequiredInputsBlock(
  source: Record<string, string | undefined> = process.env
) {
  const env = getRawEnv(source);
  const queueRegion = renderValueOrBlank(env, "CLOUD_TASKS_QUEUE_REGION");
  const queueName = renderValueOrBlank(env, "CLOUD_TASKS_QUEUE_ANALYZE");
  const queueSummary =
    queueRegion || queueName
      ? [queueRegion, queueName].filter(Boolean).join(" / ")
      : "";

  return [
    "=== REQUIRED INPUTS ===",
    "1. GCP / Firebase target project",
    `   - FIREBASE_PROJECT_ID: ${renderValueOrBlank(env, "FIREBASE_PROJECT_ID")}`,
    `   - GCLOUD_LOCATION: ${renderValueOrBlank(env, "GCLOUD_LOCATION")}`,
    `   - Cloud Tasks queue region/name: ${queueSummary}`,
    "2. Secrets",
    "   - OPENAI_API_KEY:",
    "   - ELEVENLABS_API_KEY:",
    "   - LIVEAVATAR_API_KEY:",
    "   - QUEUE_SHARED_SECRET:",
    "3. Optional defaults",
    ...OPTIONAL_DEFAULTS.map((key) => `   - ${key}: ${renderValueOrBlank(env, key)}`),
    "4. Account-side confirmations",
    "   - LiveAvatar 側で ElevenLabs secret をこの script で新規作成してよいか:",
    "   - 既存 Firestore を使ってよいか:",
    "   - App Hosting の deploy 対象 project は上記で確定か:",
  ].join("\n");
}

export function buildWhyNeededBlock() {
  return [
    "=== WHY NEEDED ===",
    "- FIREBASE_PROJECT_ID: Firestore の runtime settings 書き込み、seed 判定、Cloud Tasks parent path を安全に確定するため。",
    "- GCLOUD_LOCATION: App Hosting と acceptance 実行先の地域設定を揃えるため。",
    "- Cloud Tasks queue region/name: /api/sessions/[id]/end から analyze-session を enqueue する先を確定するため。",
    "- OPENAI_API_KEY: transcript mining と scorecard grading を実行するため。",
    "- ELEVENLABS_API_KEY: vendor bootstrap、scenario publish、smoke:eleven を通すため。",
    "- LIVEAVATAR_API_KEY: avatar session start、transcript polling、smoke:liveavatar を通すため。",
    "- QUEUE_SHARED_SECRET: /api/internal/analyze-session の認証と、local queue simulation を実行するため。",
    "- DEFAULT_ELEVEN_MODEL: publish 時の agent model を確定するため。",
    "- DEFAULT_ELEVEN_VOICE_ID: scenario publish と smoke:eleven の音声設定を確定するため。",
    "- DEFAULT_AVATAR_ID: acceptance で使う avatar を固定したい場合に必要です。未指定なら public avatar shortlist の先頭を使います。",
    "- OPENAI_ANALYSIS_MODEL: scorecard 生成モデルを固定するため。",
    "- OPENAI_MINING_MODEL: playbook mining モデルを固定するため。",
    "- LiveAvatar 側で ElevenLabs secret をこの script で新規作成してよいか: bootstrap の refresh-secret 実行可否を確定するため。",
    "- 既存 Firestore を使ってよいか: 既存 playbook / scenario / binding を再利用するか判断するため。",
    "- App Hosting の deploy 対象 project は上記で確定か: remote APP_BASE_URL を使う acceptance の書き込み先を誤らないため。",
  ].join("\n");
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
  source: Record<string, string | undefined> = process.env
) {
  return [
    buildRequiredInputsBlock(source),
    "",
    buildWhyNeededBlock(),
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
