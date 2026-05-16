#!/usr/bin/env node
import { resolve4, resolve6 } from "node:dns/promises";

const expected = valueArg("expect") ?? "blocked";
const timeoutMs = numberArg("timeout-ms", 15000);
const hostedUrl = valueArg("hosted-url") ??
  "https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-vFinal";
const customUrls = listArgs("custom-url");
const candidates =
  customUrls.length > 0
    ? customUrls
    : [
        "https://roleplay-vfinal.mendan.biz/demo/adecco-roleplay-vFinal",
        "https://adecco-roleplay.mendan.biz/demo/adecco-roleplay-vFinal",
      ];

if (hasFlag("help") || hasFlag("h")) {
  printHelp();
  process.exit(0);
}

if (hasFlag("self-test")) {
  runSelfTest();
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});

async function main() {
  const failures = [];
  const hosted = await inspectUrl(hostedUrl);
  const custom = [];
  for (const url of candidates) {
    custom.push(await inspectUrl(url));
  }

  const activeCustomCandidates = custom.filter((candidate) => candidate.headOk);

  if (!hosted.headOk) {
    failures.push(`hosted.app candidate did not return HTTP 2xx/3xx: ${hostedUrl}`);
  }
  if (expected === "blocked" && activeCustomCandidates.length > 0) {
    failures.push(
      "expected BLOCKED state but found at least one custom-domain candidate with HTTP 2xx/3xx"
    );
  }
  if (expected === "pass" && activeCustomCandidates.length === 0) {
    failures.push("expected PASS state but found no active custom-domain candidate");
  }

  const output = {
    status: failures.length === 0 ? "PASS" : "FAIL",
    expected,
    hosted,
    custom,
    activeCustomCandidateCount: activeCustomCandidates.length,
    failures,
  };

  console.log(JSON.stringify(output, null, 2));
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

async function inspectUrl(url) {
  const parsed = new URL(url);
  const dns = await resolveHost(parsed.hostname);
  const head = await headStatus(url);
  return {
    url,
    host: parsed.hostname,
    dnsResolved: dns.resolved,
    dnsRecordTypes: dns.recordTypes,
    headStatus: head.status,
    headOk: head.ok,
    active: head.ok,
    error: head.error ?? dns.error ?? null,
  };
}

async function resolveHost(host) {
  const recordTypes = [];
  const errors = [];
  const [a, aaaa] = await Promise.allSettled([resolve4(host), resolve6(host)]);
  if (a.status === "fulfilled" && a.value.length > 0) recordTypes.push("A");
  if (aaaa.status === "fulfilled" && aaaa.value.length > 0) recordTypes.push("AAAA");
  if (a.status === "rejected") errors.push(messageOf(a.reason));
  if (aaaa.status === "rejected") errors.push(messageOf(aaaa.reason));
  return {
    resolved: recordTypes.length > 0,
    recordTypes,
    error: recordTypes.length > 0 ? null : errors.filter(Boolean).join("; "),
  };
}

async function headStatus(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
    };
  } catch (error) {
    return {
      status: null,
      ok: false,
      error: messageOf(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function listArgs(name) {
  const prefix = `--${name}=`;
  const values = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) {
      values.push(arg.slice(prefix.length));
    } else if (arg === `--${name}` && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

function valueArg(name) {
  const prefix = `--${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}` && process.argv[index + 1]) return process.argv[index + 1];
  }
  return null;
}

function numberArg(name, fallback) {
  const value = valueArg(name);
  if (value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`--${name} must be a number`);
  return number;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function runSelfTest() {
  const parsed = new URL(
    "https://adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app/demo/adecco-roleplay-vFinal"
  );
  if (parsed.hostname !== "adecco-roleplay-vfinal--adecco-mendan.asia-east1.hosted.app") {
    throw new Error("hosted URL parse failed");
  }
  console.log("vFinal submitted URL candidate self-test PASS");
}

function printHelp() {
  console.log(`Usage: node scripts/check-vfinal-submitted-url-candidates.mjs [options]

Options:
  --expect=blocked|pass       Expected custom-domain state. Defaults to blocked.
  --hosted-url <url>          Dedicated hosted.app candidate URL.
  --custom-url <url>          Dedicated custom-domain candidate URL. Repeatable.
  --timeout-ms <number>       HEAD request timeout. Defaults to 15000.
  --self-test                 Run parser self-test.
  --help                      Show this help.

The check treats HTTP 2xx/3xx as the availability signal. DNS lookup output is
reported as diagnostic because Node DNS can fail in restricted environments
even when HTTPS fetch succeeds.`);
}
