import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_RATE = 24_000;
const VOICE_ID = process.env.GROK_FIRST_V50_VOICE_ID || "99c95cc8a177";
const ACCESS_COOKIE = "roleplay_access";
const API_ACCESS_COOKIE = "roleplay_api_access";
const RELAY_PATH = "/api/v3/realtime-relay";
const REALTIME_MODEL = process.env.GROK_VOICE_MODEL || "grok-voice-think-fast-1.0";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(arg.slice(2), next);
      i += 1;
    } else {
      args.set(arg.slice(2), "true");
    }
  }
}

const variant = args.get("variant") || process.env.GROK_FIRST_V50_E2E_VARIANT || "v50-7";
const demoSlug = variant.startsWith("adecco-roleplay-")
  ? variant
  : `adecco-roleplay-${variant}`;
const apiBase = `/api/grok-first-${variant}`;
const demoPath = `/demo/${demoSlug}`;
const casesPath = resolve(args.get("cases") || process.env.GROK_FIRST_V50_E2E_CASES_JSON || "");
const outDir = resolve(
  args.get("out") ||
    process.env.GROK_FIRST_V50_E2E_OUT_DIR ||
    `out/grok_first_${variant.replaceAll("-", "_")}_voice_e2e/manual`
);
const limit = Number(args.get("limit") || process.env.GROK_FIRST_V50_E2E_LIMIT || 0);
const existingBaseUrl = args.get("base-url") || process.env.GROK_FIRST_V50_E2E_BASE_URL || "";

if (!casesPath || !existsSync(casesPath)) {
  throw new Error(`cases json not found: ${casesPath}`);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "fixtures"), { recursive: true });
mkdirSync(join(outDir, "screenshots"), { recursive: true });

const cases = JSON.parse(readFileSync(casesPath, "utf8")).slice(0, limit > 0 ? limit : undefined);
const evidence = {
  startedAt: new Date().toISOString(),
  casesPath,
  outDir,
  baseUrl: "",
  results: [],
  secretSources: {},
  validationNotes: [
    "response.cancel is inferred from fixed_guard/guard.detected events; browser event payloads do not expose the method call directly.",
    "static fixed audio is inferred from firstAudibleAudioMs plus fixed_guard path; the client event payload does not expose an audio source label.",
  ],
};

function runSecretCommand(name, project) {
  const result = spawnSync("gcloud", ["secrets", "versions", "access", "latest", `--secret=${name}`, `--project=${project}`], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (result.status === 0 && result.stdout.trim().length >= 8) {
    return result.stdout.trim();
  }
  return "";
}

function readDotEnvLocal(name) {
  const envPath = join(ROOT, "apps", "web", ".env.local");
  if (!existsSync(envPath)) return "";
  const body = readFileSync(envPath, "utf8");
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1] !== name) continue;
    return match[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return "";
}

function resolveSecret(name, candidates = [name], minLength = 8) {
  const envValue = process.env[name];
  if (envValue && envValue.length >= minLength) {
    evidence.secretSources[name] = "process.env";
    return envValue;
  }
  const dotEnvValue = readDotEnvLocal(name);
  if (dotEnvValue && dotEnvValue.length >= minLength) {
    evidence.secretSources[name] = "apps/web/.env.local";
    return dotEnvValue;
  }
  const projects = [process.env.SECRET_SOURCE_PROJECT_ID, "zapier-transfer", "adecco-mendan"].filter(Boolean);
  for (const secretName of candidates) {
    for (const project of projects) {
      const value = runSecretCommand(secretName, project);
      if (value && value.length >= minLength) {
        evidence.secretSources[name] = `Secret Manager:${project}/${secretName}`;
        return value;
      }
    }
  }
  throw new Error(`BLOCKED: ${name} not available`);
}

function freePort() {
  const script = "const net=require('net');const s=net.createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();});";
  const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || "failed to allocate port");
  return Number(result.stdout.trim());
}

async function startLocalTicketRelay(xaiApiKey) {
  const port = freePort();
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname !== RELAY_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      wss.emit("connection", clientWs, req);
    });
  });

  wss.on("connection", (clientWs) => {
    const upstream = new WebSocket(`wss://api.x.ai/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`, {
      headers: { Authorization: `Bearer ${xaiApiKey}` },
    });
    const pending = [];
    let upstreamOpen = false;
    let closing = false;

    clientWs.on("message", (data, isBinary) => {
      if (closing) return;
      if (upstreamOpen && upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else {
        pending.push({ data, isBinary });
      }
    });

    upstream.on("open", () => {
      upstreamOpen = true;
      while (pending.length > 0 && upstream.readyState === WebSocket.OPEN) {
        const item = pending.shift();
        upstream.send(item.data, { binary: item.isBinary });
      }
    });

    upstream.on("message", (data, isBinary) => {
      if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data, { binary: isBinary });
    });

    const closeBoth = (code = 1000, reason = "") => {
      closing = true;
      for (const ws of [clientWs, upstream]) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          try {
            ws.close(code, reason);
          } catch {
            ws.terminate();
          }
        }
      }
    };
    clientWs.on("close", (code, reason) => closeBoth(code, reason?.toString?.() || ""));
    upstream.on("close", (code, reason) => closeBoth(code, reason?.toString?.() || ""));
    clientWs.on("error", () => closeBoth(1011, "client error"));
    upstream.on("error", () => closeBoth(1011, "upstream error"));
  });

  await new Promise((resolveListen) => server.listen(port, "127.0.0.1", resolveListen));
  return {
    url: `ws://127.0.0.1:${port}${RELAY_PATH}`,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise((resolveClose) => wss.close(() => resolveClose()));
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
      lastError = `${res.status} ${res.statusText}`;
    } catch (error) {
      lastError = error?.message || String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  throw new Error(`server did not become ready: ${lastError}`);
}

function pcm16ToWav(pcmBuffer, leadingSilenceMs = 250, trailingSilenceMs = 800) {
  const leading = Buffer.alloc(Math.floor(SAMPLE_RATE * 2 * leadingSilenceMs / 1000));
  const trailing = Buffer.alloc(Math.floor(SAMPLE_RATE * 2 * trailingSilenceMs / 1000));
  const data = Buffer.concat([leading, pcmBuffer, trailing]);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function synthesizeFixture(text, xaiApiKey) {
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const fixturePath = join(outDir, "fixtures", `${hash}.wav`);
  if (existsSync(fixturePath)) return fixturePath;

  const response = await fetch("https://api.x.ai/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: VOICE_ID,
      language: "ja",
      output_format: { codec: "pcm", sample_rate: SAMPLE_RATE },
      optimize_streaming_latency: 1,
    }),
  });
  if (!response.ok) {
    throw new Error(`xAI TTS failed ${response.status}: ${await response.text()}`);
  }
  const pcm = Buffer.from(await response.arrayBuffer());
  if (pcm.length < SAMPLE_RATE / 4) {
    throw new Error(`xAI TTS returned unexpectedly short PCM: ${pcm.length} bytes`);
  }
  writeFileSync(fixturePath, pcm16ToWav(pcm));
  return fixturePath;
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function splitPatterns(value) {
  return String(value ?? "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function sentenceCount(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  const matches = normalized.match(/[。！？!?]+/g);
  return matches ? matches.length : 1;
}

function validateCase(testCase, events, bodyText) {
  const failures = [];
  const expectedGuard = String(testCase["Expected Input Guard Action"] || "pass").trim();
  const fixedResponse = String(testCase["Fixed Response"] || "").trim();
  const maxSentences = Number(testCase["Max Sentences"] || 0);
  const turnEvent = [...events].reverse().find((event) => event.kind === "turn.completed");
  const guardEvent = [...events].reverse().find((event) => event.kind === "guard.detected");
  const sttEvent = [...events].reverse().find((event) => event.kind === "stt.completed");
  const details = turnEvent?.details || {};
  const agentText = String(details.agentTextPreview || "");

  if (!turnEvent) failures.push("missing turn.completed event");
  if (expectedGuard !== "pass" && !guardEvent) failures.push("missing guard.detected event for fixed guard case");
  if (details.guardAction !== expectedGuard) failures.push(`guardAction expected ${expectedGuard}, got ${details.guardAction ?? "<missing>"}`);

  if (expectedGuard === "fixed_external" || expectedGuard === "fixed_exit") {
    if (details.routePath !== "fixed_guard") failures.push(`routePath expected fixed_guard, got ${details.routePath ?? "<missing>"}`);
    if (agentText !== fixedResponse) failures.push(`fixed assistant text mismatch: ${agentText}`);
    if (!normalize(bodyText).includes(normalize(fixedResponse))) failures.push("fixed response not visible in page body");
    if (details.firstAudibleAudioMs == null) failures.push("firstAudibleAudioMs missing for fixed audio");
    if (String(testCase["Expect xAI Response Displayed"] || "").toLowerCase() === "no" && agentText !== fixedResponse) {
      failures.push("LLM response may have been displayed; fixed response was not exact");
    }
  } else {
    if (details.routePath === "fixed_guard") failures.push("unexpected fixed_guard routePath for pass case");
    if (!agentText) failures.push("missing assistant text for pass case");
  }

  for (const phrase of splitPatterns(testCase["Must Include All"])) {
    if (!normalize(agentText).includes(normalize(phrase))) failures.push(`missing required phrase: ${phrase}`);
  }
  const anyPhrases = splitPatterns(testCase["Must Include Any"]);
  if (anyPhrases.length > 0 && !anyPhrases.some((phrase) => normalize(agentText).includes(normalize(phrase)))) {
    failures.push(`missing any phrase: ${anyPhrases.join(" | ")}`);
  }
  for (const phrase of splitPatterns(testCase["Must Not Include"])) {
    if (normalize(agentText).includes(normalize(phrase))) failures.push(`forbidden phrase present: ${phrase}`);
  }
  if (maxSentences > 0 && sentenceCount(agentText) > maxSentences) {
    failures.push(`sentence count ${sentenceCount(agentText)} exceeds ${maxSentences}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    sttTextLen: sttEvent?.details?.textLen ?? null,
    routePath: details.routePath ?? null,
    guardAction: details.guardAction ?? null,
    guardReasons: details.guardReasons ?? [],
    promptVersion: details.promptVersion ?? null,
    guardrailVersion: details.guardrailVersion ?? null,
    firstAudioDeltaMs: details.firstAudioDeltaMs ?? null,
    firstAudibleAudioMs: details.firstAudibleAudioMs ?? null,
    doneMs: details.doneMs ?? null,
    audioBytes: details.audioBytes ?? null,
    agentTextPreview: agentText,
  };
}

async function runCase(testCase, index, baseUrl, demoToken, fixturePath) {
  const caseId = String(testCase["Case ID"] || `case-${index + 1}`);
  const events = [];
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${fixturePath}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const context = await browser.newContext({
    baseURL: baseUrl,
    permissions: ["microphone"],
    viewport: { width: 1366, height: 900 },
  });
  const host = new URL(baseUrl).hostname;
  const signature = createHmac("sha256", demoToken).update(demoToken).digest("hex");
  await context.addCookies([
    { name: ACCESS_COOKIE, value: signature, domain: host, path: "/demo", httpOnly: true, sameSite: "Lax" },
    { name: API_ACCESS_COOKIE, value: signature, domain: host, path: "/api", httpOnly: true, sameSite: "Lax" },
  ]);

  const page = await context.newPage();
  page.on("request", (request) => {
    if (!request.url().includes(`${apiBase}/event`)) return;
    try {
      const payload = request.postDataJSON();
      events.push(payload);
    } catch {
      // Ignore malformed telemetry requests.
    }
  });
  page.on("console", (message) => {
    events.push({
      kind: "browser.console",
      details: { type: message.type(), text: message.text().slice(0, 500) },
    });
  });
  page.on("response", async (response) => {
    if (!response.url().includes(`${apiBase}/session`)) return;
    let text = "";
    try {
      text = (await response.text()).slice(0, 1000);
    } catch {
      // ignore
    }
    events.push({
      kind: "session.response",
      details: { status: response.status(), text },
    });
  });

  const startedAt = Date.now();
  try {
    await page.goto(`${demoPath}?debugMetrics=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByLabel("通話を開始").click({ timeout: 60_000 });
    await page.waitForFunction(
      () => window.__v507Completed === true,
      undefined,
      { timeout: 1 },
    ).catch(() => undefined);

    await page.waitForFunction(
      () => document.body.innerText.includes("セッション") || document.body.innerText.includes("終了") || true,
      undefined,
      { timeout: 2_000 },
    ).catch(() => undefined);

    const expectedGuard = String(testCase["Expected Input Guard Action"] || "pass").trim();
    const timeoutMs = expectedGuard === "pass" ? 110_000 : 80_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (events.some((event) => event.kind === "turn.completed")) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1000);
    const bodyText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
    await page.screenshot({ path: join(outDir, "screenshots", `${caseId}.png`), fullPage: true });
    writeFileSync(join(outDir, `${caseId}.events.json`), JSON.stringify(events, null, 2), "utf8");

    const validation = validateCase(testCase, events, bodyText);
    await page.getByLabel("通話を終了").click({ timeout: 5_000 }).catch(() => undefined);
    return {
      caseId,
      tier: testCase.Tier ?? null,
      priority: testCase.Priority ?? null,
      inputMode: testCase["Input Mode"] ?? null,
      userInput: testCase["User Input"] ?? null,
      expectedGuard: testCase["Expected Input Guard Action"] ?? null,
      elapsedMs: Date.now() - startedAt,
      eventCount: events.length,
      screenshot: join(outDir, "screenshots", `${caseId}.png`),
      ...validation,
    };
  } catch (error) {
    await page.screenshot({ path: join(outDir, "screenshots", `${caseId}.error.png`), fullPage: true }).catch(() => undefined);
    writeFileSync(join(outDir, `${caseId}.events.json`), JSON.stringify(events, null, 2), "utf8");
    return {
      caseId,
      tier: testCase.Tier ?? null,
      priority: testCase.Priority ?? null,
      inputMode: testCase["Input Mode"] ?? null,
      userInput: testCase["User Input"] ?? null,
      expectedGuard: testCase["Expected Input Guard Action"] ?? null,
      elapsedMs: Date.now() - startedAt,
      eventCount: events.length,
      passed: false,
      failures: [error?.message || String(error)],
      screenshot: join(outDir, "screenshots", `${caseId}.error.png`),
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

function summarize(results) {
  const passed = results.filter((result) => result.passed).length;
  const fixed = results.filter((result) => result.expectedGuard === "fixed_external" || result.expectedGuard === "fixed_exit");
  const fixedLatencies = fixed
    .map((result) => result.firstAudibleAudioMs)
    .filter((value) => typeof value === "number")
    .sort((a, b) => a - b);
  const p95 = fixedLatencies.length ? fixedLatencies[Math.min(fixedLatencies.length - 1, Math.ceil(fixedLatencies.length * 0.95) - 1)] : null;
  const guardCounts = results.reduce((acc, result) => {
    const key = result.guardAction || "<missing>";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length ? passed / results.length : 0,
    guardCounts,
    fixedFirstAudibleP95Ms: p95,
  };
}

function writeReport(summary) {
  const failed = evidence.results.filter((result) => !result.passed);
  const lines = [
    "# Grok-first v50 Voice E2E Report",
    "",
    `- Started: ${evidence.startedAt}`,
    `- Completed: ${evidence.completedAt}`,
    `- Base URL: ${evidence.baseUrl}`,
    `- Cases: ${summary.passed}/${summary.total} passed (${(summary.passRate * 100).toFixed(1)}%)`,
    `- Guard counts: ${Object.entries(summary.guardCounts).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `- Fixed guard firstAudible p95: ${summary.fixedFirstAudibleP95Ms ?? "n/a"} ms`,
    "",
    "## Scope",
    "",
    `- Source workbook: ${casesPath}`,
    `- Output directory: ${outDir}`,
    `- Route under test: ${demoPath}`,
    `- API under test: ${apiBase}`,
    "",
    "## Failures",
    "",
  ];
  if (failed.length === 0) {
    lines.push("- None");
  } else {
    for (const result of failed) {
      lines.push(`- ${result.caseId}: ${result.failures.join("; ")}`);
      if (result.agentTextPreview) lines.push(`  - assistant: ${result.agentTextPreview}`);
    }
  }
  lines.push("", "## Notes", "");
  for (const note of evidence.validationNotes) lines.push(`- ${note}`);
  writeFileSync(join(outDir, "report.md"), `${lines.join("\n")}\n`, "utf8");
}

function stopDevServer(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      shell: true,
    });
    return;
  }
  child.kill("SIGTERM");
}

let devServer = null;
let localRelay = null;
try {
  const demoToken = resolveSecret("DEMO_ACCESS_TOKEN", ["demo-access-token", "DEMO_ACCESS_TOKEN"], 8);
  const xaiApiKey = resolveSecret("XAI_API_KEY", ["XAI_API_KEY"], 32);
  const relaySecret =
    process.env.XAI_RELAY_TICKET_SECRET && process.env.XAI_RELAY_TICKET_SECRET.length >= 32
      ? process.env.XAI_RELAY_TICKET_SECRET
      : "local-grok-first-v50-relay-ticket-secret-0001";
  evidence.secretSources.XAI_RELAY_TICKET_SECRET =
    process.env.XAI_RELAY_TICKET_SECRET && process.env.XAI_RELAY_TICKET_SECRET.length >= 32
      ? "process.env"
      : "local predeploy relay placeholder";

  localRelay = await startLocalTicketRelay(xaiApiKey);
  evidence.localRelayUrl = localRelay.url;

  console.log(`Preparing ${cases.length} audio fixtures...`);
  for (const [index, testCase] of cases.entries()) {
    const fixture = await synthesizeFixture(String(testCase["User Input"] || ""), xaiApiKey);
    testCase.__fixturePath = fixture;
    console.log(`fixture ${index + 1}/${cases.length}: ${testCase["Case ID"]}`);
  }

  let baseUrl = existingBaseUrl;
  if (!baseUrl) {
    const port = freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    devServer = spawn("corepack", ["pnpm", "--filter", "@top-performer/web", "exec", "next", "dev", "--turbopack", "--hostname", "127.0.0.1", "--port", String(port)], {
      cwd: ROOT,
      env: {
        ...process.env,
        DEMO_ACCESS_TOKEN: demoToken,
        XAI_API_KEY: xaiApiKey,
        XAI_RELAY_TICKET_SECRET: relaySecret,
        GROK_VOICE_RELAY_WS_URL: localRelay.url,
        GROK_VOICE_RELAY_EXPECTED_AUD: "127.0.0.1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      windowsHide: true,
    });
    devServer.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
    devServer.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
    await waitForHttp(`${baseUrl}${demoPath}`, 120_000);
  }
  evidence.baseUrl = baseUrl;

  for (const [index, testCase] of cases.entries()) {
    console.log(`Running ${index + 1}/${cases.length}: ${testCase["Case ID"]}`);
    const result = await runCase(testCase, index, baseUrl, demoToken, testCase.__fixturePath);
    evidence.results.push(result);
    writeFileSync(join(outDir, "results.partial.json"), JSON.stringify(evidence, null, 2), "utf8");
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.caseId}: ${result.failures?.join("; ") || ""}`);
  }

  evidence.completedAt = new Date().toISOString();
  const summary = summarize(evidence.results);
  evidence.summary = summary;
  writeFileSync(join(outDir, "results.json"), JSON.stringify(evidence, null, 2), "utf8");
  writeReport(summary);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report: ${join(outDir, "report.md")}`);
  if (summary.failed > 0) process.exitCode = 1;
} finally {
  if (devServer) {
    stopDevServer(devServer);
  }
  if (localRelay) {
    await localRelay.close().catch(() => undefined);
  }
}
