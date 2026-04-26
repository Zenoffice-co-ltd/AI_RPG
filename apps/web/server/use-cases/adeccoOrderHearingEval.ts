import { createSign, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { accessSecretValue } from "@/server/secrets";

const SCENARIO_ID =
  "staffing_order_hearing_adecco_manufacturer_busy_manager_medium";
const SCENARIO_TITLE = "初回派遣オーダーヒアリング";
const LEARNER_NAME = "アデコ営業（学習者）";
const CLIENT_ROLE = "中堅住宅設備メーカーの人事課主任";
const ORIGINAL_TO_ADDRESS = "iwase@zenoffice.co.jp";
const ANTHROPIC_SECRET_NAME = "anthropic-api-key-default";
const GMAIL_SERVICE_ACCOUNT_SECRET_NAME = "gmail-client-secret";
const MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 6000;
const RETRY_MAX_TOKENS = 12000;

const REQUIRED_TOP_LEVEL_KEYS = [
  "total_score",
  "rubric_scores",
  "must_capture_items",
] as const;

const ADDITIONAL_TOP_LEVEL_KEYS = [
  "schema_version",
  "session_id",
  "scenario_id",
  "score_confidence",
  "agent_quality_flags",
  "learner_feedback",
] as const;

export type NormalizedTurn = {
  turn_id: string;
  speaker: "sales" | "client" | "unknown";
  text: string;
  timestamp_sec: number;
};

type ClaudeResult = {
  result: string;
  model: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  };
};

type ValidationResult = {
  ok: boolean;
  status: string;
  jsonText: string;
  parsed: unknown;
};

type GmailServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type AdeccoEvaluationInput = {
  sessionId?: string;
  conversationId: string | null;
  transcript: NormalizedTurn[];
  startedAt?: string;
  endedAt?: string;
  transcriptSource?: string;
  asrQualityNote?: string;
};

export type AdeccoEvaluationResult = {
  sessionId: string;
  model: string;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
  };
  validation: {
    ok: boolean;
    status: string;
  };
  mail: {
    routed_to: string;
    delivery: "direct";
    ok: boolean;
    status: string;
    id?: string;
  };
  retryNote: string;
};

function getSecretProjectId() {
  return (
    process.env["ADECCO_EVAL_SECRET_PROJECT_ID"] ??
    process.env["SECRET_SOURCE_PROJECT_ID"] ??
    "zapier-transfer"
  );
}

function getPromptsRoot() {
  const explicitRoot = process.env["ADECCO_EVAL_PROMPTS_ROOT"];
  if (explicitRoot) {
    return resolve(explicitRoot);
  }

  const candidates = [
    resolve(process.cwd(), "scripts", "adecco_order_hearing_eval", "prompts"),
    resolve("/app", "scripts", "adecco_order_hearing_eval", "prompts"),
  ];
  return (
    candidates.find((candidate) => existsSync(join(candidate, "system.md"))) ??
    resolve(process.cwd(), "scripts", "adecco_order_hearing_eval", "prompts")
  );
}

function getEmailTemplatesRoot() {
  const explicitRoot = process.env["ADECCO_EVAL_EMAIL_TEMPLATES_ROOT"];
  if (explicitRoot) {
    return resolve(explicitRoot);
  }

  const candidates = [
    resolve(
      process.cwd(),
      "scripts",
      "adecco_order_hearing_eval",
      "email_templates"
    ),
    resolve("/app", "scripts", "adecco_order_hearing_eval", "email_templates"),
  ];
  return (
    candidates.find((candidate) =>
      existsSync(join(candidate, "adecco_report_v2.html"))
    ) ??
    resolve(
      process.cwd(),
      "scripts",
      "adecco_order_hearing_eval",
      "email_templates"
    )
  );
}

function fillTemplate(template: string, replacements: Record<string, string>) {
  let filled = template;
  for (const [key, value] of Object.entries(replacements)) {
    filled = filled.replaceAll(`{{${key}}}`, value);
  }
  return filled;
}

function extractJsonCandidate(rawText: string) {
  const stripped = rawText.trim();
  if (stripped.startsWith("```")) {
    const lines = stripped.split(/\r?\n/);
    if (lines[0]?.trim().startsWith("```")) {
      lines.shift();
    }
    if (lines[lines.length - 1]?.trim() === "```") {
      lines.pop();
    }
    return {
      jsonText: lines.join("\n").trim(),
      note: "stripped markdown code fence",
    };
  }

  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace > 0 && lastBrace > firstBrace) {
    return {
      jsonText: stripped.slice(firstBrace, lastBrace + 1),
      note: "extracted first JSON object",
    };
  }

  return { jsonText: stripped, note: "raw" };
}

function validateResponseText(rawText: string): ValidationResult {
  const { jsonText, note } = extractJsonCandidate(rawText);
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      ok: false,
      status: `failed: json_parse_error=${
        error instanceof Error ? error.message : "unknown"
      }; extraction=${note}`,
      jsonText,
      parsed: null,
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      status: `failed: parsed JSON is not an object; extraction=${note}`,
      jsonText,
      parsed,
    };
  }

  const record = parsed as Record<string, unknown>;
  const missingRequired = REQUIRED_TOP_LEVEL_KEYS.filter(
    (key) => !(key in record)
  );
  const missingAdditional = ADDITIONAL_TOP_LEVEL_KEYS.filter(
    (key) => !(key in record)
  );

  if (missingRequired.length > 0) {
    return {
      ok: false,
      status:
        `failed: missing required top-level keys=${missingRequired.join(",")}` +
        (missingAdditional.length > 0
          ? `; missing additional keys=${missingAdditional.join(",")}`
          : "") +
        `; extraction=${note}`,
      jsonText,
      parsed,
    };
  }

  if (missingAdditional.length > 0) {
    return {
      ok: true,
      status: `success: required keys present; missing additional keys=${missingAdditional.join(",")}`,
      jsonText,
      parsed,
    };
  }

  return {
    ok: true,
    status: `success: required and additional top-level keys present; extraction=${note}`,
    jsonText,
    parsed,
  };
}

async function loadPromptBundle() {
  const promptsRoot = getPromptsRoot();
  const [systemPrompt, userTemplate, schemaText] = await Promise.all([
    readFile(join(promptsRoot, "system.md"), "utf8"),
    readFile(join(promptsRoot, "user_template.md"), "utf8"),
    readFile(join(promptsRoot, "schema.json"), "utf8"),
  ]);

  return { systemPrompt, userTemplate, schemaText };
}

async function loadEmailHtmlTemplate() {
  return readFile(join(getEmailTemplatesRoot(), "adecco_report_v2.html"), "utf8");
}

async function callClaude(input: {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
}): Promise<ClaudeResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": input.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: input.maxTokens,
      temperature: 0,
      system: input.systemPrompt,
      messages: [{ role: "user", content: input.userPrompt }],
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    throw new Error(
      `Claude API failed: status=${response.status}; body=${JSON.stringify(body)}`
    );
  }

  const content = Array.isArray(body?.["content"]) ? body?.["content"] : [];
  const text = content
    .map((block) => {
      if (typeof block !== "object" || block === null) {
        return "";
      }
      const record = block as Record<string, unknown>;
      return typeof record["text"] === "string" ? record["text"] : "";
    })
    .join("");

  if (!text.trim()) {
    throw new Error("Claude API returned an empty text response.");
  }

  const usage =
    typeof body?.["usage"] === "object" && body["usage"] !== null
      ? (body["usage"] as ClaudeResult["usage"])
      : {};

  return {
    result: text,
    model: typeof body?.["model"] === "string" ? body["model"] : MODEL,
    usage,
  };
}

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function getGmailAccessToken(serviceAccount: GmailServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = serviceAccount.token_uri ?? "https://oauth2.googleapis.com/token";
  const delegatedUser =
    process.env["GMAIL_DELEGATED_USER"] ?? ORIGINAL_TO_ADDRESS;
  const assertionHeader = base64Url(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  );
  const assertionClaim = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/gmail.send",
      aud: tokenUri,
      exp: now + 3600,
      iat: now,
      sub: delegatedUser,
    })
  );
  const unsignedJwt = `${assertionHeader}.${assertionClaim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok || typeof body?.["access_token"] !== "string") {
    throw new Error(
      `Gmail token request failed: status=${response.status}; body=${JSON.stringify(body)}`
    );
  }

  return body["access_token"];
}

function encodeSubject(subject: string) {
  return `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
}

function buildMimeMessage(input: {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}) {
  if (input.bodyHtml) {
    const boundary = `adecco_eval_${randomUUID().replaceAll("-", "")}`;
    return [
      `From: ${input.from}`,
      `To: ${input.to}`,
      `Subject: ${encodeSubject(input.subject)}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.bodyText,
      "",
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
      "",
      input.bodyHtml,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  return [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.bodyText,
  ].join("\r\n");
}

async function sendGmail(input: {
  serviceAccountJson: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}) {
  const serviceAccount = JSON.parse(
    input.serviceAccountJson
  ) as GmailServiceAccount;
  const accessToken = await getGmailAccessToken(serviceAccount);
  const delegatedUser =
    process.env["GMAIL_DELEGATED_USER"] ?? ORIGINAL_TO_ADDRESS;
  const raw = base64Url(
    buildMimeMessage({
      from: delegatedUser,
      to: input.to,
      subject: input.subject,
      bodyText: input.bodyText,
      ...(input.bodyHtml ? { bodyHtml: input.bodyHtml } : {}),
    })
  );

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );
  const body = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    throw new Error(
      `Gmail send failed: status=${response.status}; body=${JSON.stringify(body)}`
    );
  }

  return typeof body?.["id"] === "string" ? body["id"] : undefined;
}

function buildEmailBody(input: {
  sessionId: string;
  conversationId: string | null;
  startedAt: string;
  endedAt: string;
  validation: ValidationResult;
  claude: ClaudeResult;
  retryNote: string;
  rawResult: string;
}) {
  const totalScore =
    typeof input.validation.parsed === "object" &&
    input.validation.parsed !== null &&
    !Array.isArray(input.validation.parsed)
      ? (input.validation.parsed as Record<string, unknown>)["total_score"]
      : "";

  const lines = [
    "AIロープレ評価 MVP 実行結果",
    "",
    "Validation:",
    `- ok: ${input.validation.ok}`,
    `- status: ${input.validation.status}`,
    "",
    "Model / Usage:",
    `- model: ${input.claude.model}`,
    `- usage.input_tokens: ${input.claude.usage.input_tokens ?? ""}`,
    `- usage.output_tokens: ${input.claude.usage.output_tokens ?? ""}`,
    `- retry_note: ${input.retryNote}`,
    "",
    "Session Metadata:",
    `- session_id: ${input.sessionId}`,
    `- scenario_id: ${SCENARIO_ID}`,
    `- scenario_title: ${SCENARIO_TITLE}`,
    `- learner_name: ${LEARNER_NAME}`,
    `- client_role: ${CLIENT_ROLE}`,
    `- started_at: ${input.startedAt}`,
    `- ended_at: ${input.endedAt}`,
    `- transcript_source: elevenlabs_postcall_webhook`,
    `- asr_quality_note: elevenlabs_postcall`,
    `- eleven_conversation_id: ${input.conversationId ?? ""}`,
    `- total_score: ${totalScore ?? ""}`,
    "",
    "Mail Routing:",
    `- routed_to: ${ORIGINAL_TO_ADDRESS}`,
    "- delivery: direct",
    "- sender: gmail-service-account-delegation",
    "",
    "Claude Scoring JSON:",
    input.validation.jsonText,
  ];

  if (input.rawResult.trim() !== input.validation.jsonText.trim()) {
    lines.push("", "Raw Claude Response:", input.rawResult);
  }

  return lines.join("\n");
}

export async function runAdeccoOrderHearingEvaluation(
  input: AdeccoEvaluationInput
): Promise<AdeccoEvaluationResult> {
  const sessionId =
    input.sessionId ?? `eleven_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const startedAt = input.startedAt ?? new Date().toISOString();
  const endedAt = input.endedAt ?? new Date().toISOString();
  const secretProjectId = getSecretProjectId();
  const { systemPrompt, userTemplate, schemaText } = await loadPromptBundle();
  const userPrompt =
    fillTemplate(userTemplate, {
      session_id: sessionId,
      scenario_id: SCENARIO_ID,
      scenario_title: SCENARIO_TITLE,
      learner_name: LEARNER_NAME,
      client_role: CLIENT_ROLE,
      started_at: startedAt,
      ended_at: endedAt,
      transcript_source:
        input.transcriptSource ?? "elevenlabs_postcall_webhook",
      asr_quality_note: input.asrQualityNote ?? "elevenlabs_postcall",
      conversation_transcript_json: JSON.stringify(input.transcript, null, 2),
      optional_calibration_examples_json_or_empty_array: "[]",
    }) +
    "\n\n<json_output_schema>\n" +
    schemaText +
    "\n</json_output_schema>\n";

  const anthropicApiKey = await accessSecretValue(
    ANTHROPIC_SECRET_NAME,
    secretProjectId
  );
  const gmailServiceAccountJson = await accessSecretValue(
    GMAIL_SERVICE_ACCOUNT_SECRET_NAME,
    secretProjectId
  );

  let claude = await callClaude({
    apiKey: anthropicApiKey,
    systemPrompt,
    userPrompt,
    maxTokens: DEFAULT_MAX_TOKENS,
  });
  let validation = validateResponseText(claude.result);
  let retryNote = "not retried";

  if (
    !validation.ok &&
    (claude.usage.output_tokens ?? 0) >= DEFAULT_MAX_TOKENS &&
    validation.status.includes("json_parse_error")
  ) {
    retryNote = `retried once with max_tokens=${RETRY_MAX_TOKENS} after truncated JSON`;
    claude = await callClaude({
      apiKey: anthropicApiKey,
      systemPrompt,
      userPrompt,
      maxTokens: RETRY_MAX_TOKENS,
    });
    validation = validateResponseText(claude.result);
  }

  const subject = `[SANDBOX] [AIロープレ評価] ${SCENARIO_ID} / ${sessionId}`;
  const bodyText = buildEmailBody({
    sessionId,
    conversationId: input.conversationId,
    startedAt,
    endedAt,
    validation,
    claude,
    retryNote,
    rawResult: claude.result,
  });
  const bodyHtml = await loadEmailHtmlTemplate();
  const messageId = await sendGmail({
    serviceAccountJson: gmailServiceAccountJson,
    to: ORIGINAL_TO_ADDRESS,
    subject,
    bodyText,
    bodyHtml,
  });

  return {
    sessionId,
    model: claude.model,
    usage: claude.usage,
    validation: {
      ok: validation.ok,
      status: validation.status,
    },
    mail: {
      routed_to: ORIGINAL_TO_ADDRESS,
      delivery: "direct",
      ok: true,
      status: "sent",
      ...(messageId ? { id: messageId } : {}),
    },
    retryNote,
  };
}
