// Reusable Cloud Logging aggregator for Grok Voice latency observability.
//
// Sliced by `routePath`, `strictGateApplied`, and `localLockedAudioHit`,
// this script answers the questions the latency-first closeout doc
// expects to be re-answerable on demand:
//   - "Is the rt_voice streaming win (PR #85) still holding in
//     production after 7 days of organic traffic?"
//   - "Is the lock_voice_local_audio path (PR #87) still hitting the
//     bundle? What is the local-hit rate vs network-TTS fallback?"
//   - "Did a recent deploy change the latency distribution per route?"
//
// The script is read-only against Cloud Logging — it never mutates
// state and never touches Secret Manager beyond the GCP access token
// `gcloud` already grants.
//
// Usage:
//   pnpm exec tsx scripts/grok-voice-latency-report.ts
//   pnpm exec tsx scripts/grok-voice-latency-report.ts --minutes 60
//   pnpm exec tsx scripts/grok-voice-latency-report.ts --since 2026-05-11T00:00:00Z
//   pnpm exec tsx scripts/grok-voice-latency-report.ts --revision adecco-roleplay-build-2026-05-11-001
//   pnpm exec tsx scripts/grok-voice-latency-report.ts --hours 168    # 7-day organic remeasurement
//   pnpm exec tsx scripts/grok-voice-latency-report.ts --json out/latency-report.json
//
// No GCP project flag — pinned to adecco-mendan (the only Grok Voice
// runtime) for the same safety reason the prod smoke is pinned. A
// future generalization can lift this.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PROJECT = "adecco-mendan";
const SERVICE = "adecco-roleplay";

type CliArgs = {
  minutes?: number;
  hours?: number;
  since?: string;
  revision?: string;
  limit: number;
  json?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: 2_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case "--minutes":
        args.minutes = Number(next);
        i += 1;
        break;
      case "--hours":
        args.hours = Number(next);
        i += 1;
        break;
      case "--since":
        args.since = next;
        i += 1;
        break;
      case "--revision":
        args.revision = next;
        i += 1;
        break;
      case "--limit":
        args.limit = Number(next);
        i += 1;
        break;
      case "--json":
        args.json = next;
        i += 1;
        break;
    }
  }
  return args;
}

function resolveSinceIso(args: CliArgs): string {
  if (args.since) return new Date(args.since).toISOString();
  if (args.hours !== undefined && Number.isFinite(args.hours)) {
    return new Date(Date.now() - args.hours * 3_600_000).toISOString();
  }
  const minutes =
    args.minutes !== undefined && Number.isFinite(args.minutes)
      ? args.minutes
      : 60;
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// Run gcloud logging read for the turnMetrics scope. Bounded to the
// Cloud Run revision when caller passed --revision; otherwise pulled
// across all revisions in the window. Returns parsed JSON entries.
type RawEntry = {
  resource?: { labels?: Record<string, string> };
  timestamp?: string;
  jsonPayload?: Record<string, unknown>;
};

function pullTurnMetrics(args: CliArgs): RawEntry[] {
  const sinceIso = resolveSinceIso(args);
  // gcloud's filter parser is finicky about timestamp comparisons
  // inside `--filter` strings (the `:` in ISO timestamps interferes
  // with the parser even when the value is double-quoted). The robust
  // pattern — used by scripts/grok-voice-v21-prod-logs.mjs — is to
  // express the time window via the dedicated `--freshness=Xm` flag
  // and keep the filter free of timestamp predicates.
  const freshnessMinutes = Math.max(
    1,
    Math.ceil((Date.now() - new Date(sinceIso).getTime()) / 60_000)
  );
  const filterParts = [
    `resource.type="cloud_run_revision"`,
    `resource.labels.service_name="${SERVICE}"`,
    `jsonPayload.scope="grokVoice.turnMetrics"`,
  ];
  if (args.revision) {
    filterParts.push(`resource.labels.revision_name="${args.revision}"`);
  }
  const filter = filterParts.join(" ");

  // gcloud CLI invocation that survives both POSIX and Windows shells.
  // The filter string contains nested double-quotes; cmd.exe parses them
  // and breaks the value. Mirror the pattern from
  // scripts/grok-voice-v21-prod-logs.mjs: wrap the call in PowerShell on
  // Windows (single-quoted args, no shell interpretation of inner
  // double-quotes), and direct spawn on POSIX.
  const result =
    process.platform === "win32"
      ? spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            [
              "gcloud",
              "logging",
              "read",
              psQuote(filter),
              `--project=${psQuote(PROJECT)}`,
              `--limit=${args.limit}`,
              "--format=json",
              `--freshness=${freshnessMinutes}m`,
              "--order=desc",
            ].join(" "),
          ],
          {
            encoding: "utf8",
            shell: false,
            maxBuffer: 64 * 1024 * 1024,
          }
        )
      : spawnSync(
          "gcloud",
          [
            "logging",
            "read",
            filter,
            `--project=${PROJECT}`,
            `--limit=${args.limit}`,
            "--format=json",
            `--freshness=${freshnessMinutes}m`,
            "--order=desc",
          ],
          {
            encoding: "utf8",
            shell: false,
            maxBuffer: 64 * 1024 * 1024,
          }
        );
  if (result.status !== 0 || !result.stdout) {
    throw new Error(
      `gcloud logging read failed (status=${result.status}): ${
        result.stderr?.slice(0, 600) ?? ""
      }`
    );
  }
  try {
    return JSON.parse(result.stdout) as RawEntry[];
  } catch (error) {
    throw new Error(
      `Failed to parse gcloud output: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// PowerShell single-quote escape: each literal single-quote becomes
// two single-quotes. Used to wrap the gcloud filter string so neither
// PowerShell nor cmd.exe re-parses the inner double-quotes.
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

type Percentiles = {
  n: number;
  min: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
};

function percentiles(values: readonly number[]): Percentiles | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  return {
    n: sorted.length,
    min: sorted[0]!,
    p50: at(0.5),
    p90: at(0.9),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1]!,
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
  };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type Bucket = {
  // routePath × strictGateApplied × localLockedAudioHit cardinality.
  // We deliberately keep the bucket key small so the report fits on
  // one terminal screen.
  routePath: string;
  strictGateApplied: string;
  localLockedAudioHit: string;
};

function bucketKey(b: Bucket): string {
  return `${b.routePath} | gate=${b.strictGateApplied} | localLock=${b.localLockedAudioHit}`;
}

function summarize(entries: RawEntry[]) {
  const byBucket = new Map<
    string,
    {
      bucket: Bucket;
      firstAudibleAudioMs: number[];
      firstRealtimeAudioDeltaMs: number[];
      sanitizerDelayMs: number[];
      networkTtsMs: number[];
      cacheLookupMs: number[];
      outcomes: Map<string, number>;
    }
  >();
  const byRevision = new Map<string, number>();

  for (const entry of entries) {
    const p = entry.jsonPayload ?? {};
    const rev =
      entry.resource?.labels?.["revision_name"] ?? "unknown_revision";
    byRevision.set(rev, (byRevision.get(rev) ?? 0) + 1);

    const bucket: Bucket = {
      routePath: typeof p["routePath"] === "string" ? p["routePath"] : "unknown",
      strictGateApplied:
        typeof p["strictGateApplied"] === "boolean"
          ? String(p["strictGateApplied"])
          : "absent",
      localLockedAudioHit:
        typeof p["localLockedAudioHit"] === "boolean"
          ? String(p["localLockedAudioHit"])
          : "absent",
    };
    const key = bucketKey(bucket);
    if (!byBucket.has(key)) {
      byBucket.set(key, {
        bucket,
        firstAudibleAudioMs: [],
        firstRealtimeAudioDeltaMs: [],
        sanitizerDelayMs: [],
        networkTtsMs: [],
        cacheLookupMs: [],
        outcomes: new Map(),
      });
    }
    const row = byBucket.get(key)!;
    const fams = asNumber(p["firstAudibleAudioMs"]);
    if (fams !== null && fams >= 0) row.firstAudibleAudioMs.push(fams);
    const fadm = asNumber(p["firstRealtimeAudioDeltaMs"]);
    if (fadm !== null && fadm >= 0) row.firstRealtimeAudioDeltaMs.push(fadm);
    const sd = asNumber(p["sanitizerDelayMs"]);
    if (sd !== null && sd >= 0) row.sanitizerDelayMs.push(sd);
    const nt = asNumber(p["networkTtsMs"]);
    if (nt !== null && nt >= 0) row.networkTtsMs.push(nt);
    const cl = asNumber(p["cacheLookupMs"]);
    if (cl !== null && cl >= 0) row.cacheLookupMs.push(cl);
    const outcome =
      typeof p["outcome"] === "string" ? p["outcome"] : "(none)";
    row.outcomes.set(outcome, (row.outcomes.get(outcome) ?? 0) + 1);
  }
  return { byBucket, byRevision };
}

function formatStats(stats: Percentiles | null): string {
  if (!stats) return "n=0";
  return `n=${stats.n} p50=${stats.p50} p90=${stats.p90} p95=${stats.p95} p99=${stats.p99} max=${stats.max} mean=${Math.round(stats.mean)}`;
}

function printHumanReport(args: CliArgs, entries: RawEntry[]) {
  const sinceIso = resolveSinceIso(args);
  const { byBucket, byRevision } = summarize(entries);
  console.log("=".repeat(80));
  console.log("Grok Voice latency report");
  console.log("=".repeat(80));
  console.log(`project          : ${PROJECT}`);
  console.log(`service          : ${SERVICE}`);
  console.log(`since            : ${sinceIso}`);
  console.log(`revision filter  : ${args.revision ?? "(all)"}`);
  console.log(`fetched entries  : ${entries.length}`);
  console.log();
  console.log("per-revision entry counts:");
  const revs = [...byRevision.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  for (const [rev, n] of revs) {
    console.log(`  ${rev.padEnd(48)} ${String(n).padStart(5)}`);
  }
  console.log();
  console.log("per-bucket latency distributions:");
  for (const [key, row] of [...byBucket.entries()].sort()) {
    console.log(`  ${key}`);
    console.log(`    firstAudibleAudioMs       ${formatStats(percentiles(row.firstAudibleAudioMs))}`);
    console.log(`    firstRealtimeAudioDeltaMs ${formatStats(percentiles(row.firstRealtimeAudioDeltaMs))}`);
    console.log(`    sanitizerDelayMs          ${formatStats(percentiles(row.sanitizerDelayMs))}`);
    console.log(`    networkTtsMs              ${formatStats(percentiles(row.networkTtsMs))}`);
    console.log(`    cacheLookupMs             ${formatStats(percentiles(row.cacheLookupMs))}`);
    const outcomes = [...row.outcomes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    console.log(`    outcomes                  ${outcomes}`);
    console.log();
  }
  console.log("Headline summary:");
  // Compute the headline ratios the closeout doc references.
  const localHit = [...byBucket.values()].filter(
    (r) =>
      r.bucket.routePath === "lock_voice_local_audio" &&
      r.bucket.localLockedAudioHit === "true"
  );
  const networkLock = [...byBucket.values()].filter(
    (r) => r.bucket.routePath === "lock_voice_network_tts"
  );
  const rtVoiceBusiness = [...byBucket.values()].filter(
    (r) =>
      r.bucket.routePath === "rt_voice" &&
      r.bucket.strictGateApplied === "false"
  );
  const rtVoiceGated = [...byBucket.values()].filter(
    (r) =>
      r.bucket.routePath === "rt_voice" &&
      r.bucket.strictGateApplied === "true"
  );
  function combinedFams(rows: typeof localHit): number[] {
    return rows.flatMap((r) => r.firstAudibleAudioMs);
  }
  const headline = [
    {
      label: "lock_voice_local_audio (PR #87 bundled hit)",
      vals: combinedFams(localHit),
    },
    {
      label: "lock_voice_network_tts (legacy / bundle miss)",
      vals: combinedFams(networkLock),
    },
    {
      label: "rt_voice business (PR #85 streamed)",
      vals: combinedFams(rtVoiceBusiness),
    },
    {
      label: "rt_voice gated (risk_based buffered)",
      vals: combinedFams(rtVoiceGated),
    },
  ];
  for (const { label, vals } of headline) {
    console.log(`  ${label.padEnd(48)} ${formatStats(percentiles(vals))}`);
  }
  console.log();
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const entries = pullTurnMetrics(args);
  if (args.json) {
    const out = resolve(args.json);
    mkdirSync(dirname(out), { recursive: true });
    const { byBucket, byRevision } = summarize(entries);
    const serializable = {
      project: PROJECT,
      service: SERVICE,
      since: resolveSinceIso(args),
      revision: args.revision ?? null,
      entryCount: entries.length,
      byRevision: Object.fromEntries(byRevision),
      buckets: [...byBucket.values()].map((row) => ({
        ...row.bucket,
        firstAudibleAudioMs: percentiles(row.firstAudibleAudioMs),
        firstRealtimeAudioDeltaMs: percentiles(row.firstRealtimeAudioDeltaMs),
        sanitizerDelayMs: percentiles(row.sanitizerDelayMs),
        networkTtsMs: percentiles(row.networkTtsMs),
        cacheLookupMs: percentiles(row.cacheLookupMs),
        outcomes: Object.fromEntries(row.outcomes),
      })),
    };
    writeFileSync(out, JSON.stringify(serializable, null, 2), "utf8");
    console.log(`[grok-voice-latency-report] wrote ${out}`);
  }
  printHumanReport(args, entries);
}

main();
