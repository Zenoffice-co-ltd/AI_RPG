// Promote `v1.candidate/` → `v1/` for the Verified Audio Artifact
// pipeline.
//
// Required CLI flags:
//   --approved-by=<email>     Recorded in APPROVALS.md and the manifest
//   --report-path=<path>      Build report from grok:build-registered-speech
//
// Optional:
//   --reviewer-note="…"       Free-text note included in APPROVALS.md
//
// Pre-conditions enforced:
//   1. v1.candidate/manifest.json exists and parses
//   2. The build report referenced exists, has matching buildId, and
//      lists no failed intents
//   3. sha256 of each .pcm in v1.candidate/artifacts/ equals the
//      manifest claim (re-hash from disk; defends against accidental
//      edits to a candidate file post-build)
//   4. The manifest covers every REQUIRED_REGISTERED_SPEECH_INTENTS
//      entry exactly once
//
// On success:
//   - v1.candidate/manifest.json → v1/manifest.json (with approvedBy /
//     approvedAt populated for every entry)
//   - v1.candidate/artifacts/*.pcm → v1/artifacts/*.pcm (binary copy)
//   - APPROVALS.md gets an append-only row
//   - manifest-constant.ts is rewritten with the new buildId so the
//     client-side version-handshake matches the server bundle
//
// SAFETY: read-only against the candidate dir aside from the final
// rename. The promote step never re-synthesizes audio. If a reviewer
// changed the candidate after the build, sha256 mismatch surfaces
// here and aborts the promote.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  REQUIRED_REGISTERED_SPEECH_INTENTS,
  type CanonicalIntent,
} from "../apps/web/lib/roleplay/registered-speech/canonical-intents";
import { RegisteredSpeechManifestSchema } from "../apps/web/lib/roleplay/registered-speech/types";

type CliArgs = {
  approvedBy: string;
  reportPath: string;
  reviewerNote: string;
};

function parseArgs(argv: string[]): CliArgs {
  const out: Partial<CliArgs> = {};
  for (const arg of argv) {
    const eq = arg.indexOf("=");
    if (eq === -1) continue;
    const key = arg.slice(0, eq);
    const value = arg.slice(eq + 1);
    if (key === "--approved-by") out.approvedBy = value;
    else if (key === "--report-path") out.reportPath = value;
    else if (key === "--reviewer-note") out.reviewerNote = value;
  }
  if (!out.approvedBy) throw new Error("--approved-by=<email> is required");
  if (!out.reportPath) throw new Error("--report-path=<path> is required");
  return {
    approvedBy: out.approvedBy,
    reportPath: out.reportPath,
    reviewerNote: out.reviewerNote ?? "",
  };
}

function repoRoot(): string {
  return resolve(import.meta.dirname ?? __dirname, "..");
}

function recomputeSha256(filePath: string): string {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const candidateRoot = resolve(
    root,
    "data/generated/registered-speech/v1.candidate"
  );
  const promotedRoot = resolve(root, "data/generated/registered-speech/v1");
  const candidateManifestPath = resolve(candidateRoot, "manifest.json");
  const promotedManifestPath = resolve(promotedRoot, "manifest.json");
  const approvalsPath = resolve(
    root,
    "data/generated/registered-speech/APPROVALS.md"
  );
  const clientConstantPath = resolve(
    root,
    "apps/web/lib/roleplay/registered-speech/manifest-constant.ts"
  );

  if (!existsSync(candidateManifestPath)) {
    throw new Error(`candidate manifest missing: ${candidateManifestPath}`);
  }
  if (!existsSync(args.reportPath)) {
    throw new Error(`build report missing: ${args.reportPath}`);
  }

  const candidateRaw = readFileSync(candidateManifestPath, "utf8");
  const candidate = RegisteredSpeechManifestSchema.parse(JSON.parse(candidateRaw));

  const reportRaw = readFileSync(args.reportPath, "utf8");
  const report = JSON.parse(reportRaw) as {
    builtAt: string;
    intents: Array<{
      intent: CanonicalIntent;
      sha256: string;
      ok: boolean;
      forbiddenSuffixHit?: boolean;
      asrUnavailable?: boolean;
    }>;
  };

  if (report.builtAt !== candidate.buildId) {
    throw new Error(
      `report buildId mismatch: report.builtAt=${report.builtAt} candidate.buildId=${candidate.buildId}`
    );
  }
  const reportFailed = report.intents.filter((r) => !r.ok);
  if (reportFailed.length > 0) {
    throw new Error(
      `report has failed intents (forbidden suffix or token gate): ${reportFailed.map((r) => r.intent).join(", ")}`
    );
  }

  // intent coverage
  if (candidate.entries.length !== REQUIRED_REGISTERED_SPEECH_INTENTS.length) {
    throw new Error(
      `candidate entry count mismatch: expected=${REQUIRED_REGISTERED_SPEECH_INTENTS.length} actual=${candidate.entries.length}`
    );
  }
  const candidateIntents = new Set(candidate.entries.map((e) => e.intent));
  for (const required of REQUIRED_REGISTERED_SPEECH_INTENTS) {
    if (!candidateIntents.has(required)) {
      throw new Error(`candidate missing intent: ${required}`);
    }
  }

  // sha256 re-hash
  for (const entry of candidate.entries) {
    const audioPath = resolve(candidateRoot, entry.audioPath);
    const actual = recomputeSha256(audioPath);
    if (actual !== entry.sha256) {
      throw new Error(
        `sha mismatch for ${entry.intent}: manifest=${entry.sha256} actual=${actual}`
      );
    }
    const reportEntry = report.intents.find((r) => r.intent === entry.intent);
    if (!reportEntry) {
      throw new Error(`report missing intent: ${entry.intent}`);
    }
    if (reportEntry.sha256 !== actual) {
      throw new Error(
        `report sha differs from disk for ${entry.intent}: report=${reportEntry.sha256} disk=${actual}`
      );
    }
  }

  // Populate approval fields on every entry. Same approver / timestamp
  // for all entries because the approval is for the whole bundle, not
  // intent-by-intent.
  const approvedAt = new Date().toISOString();
  const promotedManifest = {
    ...candidate,
    entries: candidate.entries.map((e) => ({
      ...e,
      approvedBy: args.approvedBy,
      approvedAt,
    })),
  };

  // Write promoted manifest + binary-copy artifacts
  mkdirSync(promotedRoot, { recursive: true });
  mkdirSync(resolve(promotedRoot, "artifacts"), { recursive: true });
  for (const entry of candidate.entries) {
    copyFileSync(
      resolve(candidateRoot, entry.audioPath),
      resolve(promotedRoot, entry.audioPath)
    );
  }
  writeFileSync(
    promotedManifestPath,
    `${JSON.stringify(promotedManifest, null, 2)}\n`
  );

  // Rewrite the client manifest constant so version-handshake matches.
  // The `: string` annotation widens the literal type so the runtime
  // comparison in useGrokVoiceConversation.ts doesn't get narrowed to
  // statically-false after a promote.
  const clientConstant = `// Compile-time constant emitted by the registered-speech promote
// script. Reviewers should see the diff here in the same PR that
// updates \`data/generated/registered-speech/v1/manifest.json\`.
//
// The runtime version-handshake refuses any session whose
// \`registeredSpeechManifestVersion\` / \`registeredSpeechBuildId\`
// doesn't match these constants — so flipping
// \`GROK_VOICE_PRODUCTION_DETERMINISTIC_ONLY\` on with a stale client
// build is impossible without redeploying.
export const REGISTERED_SPEECH_CLIENT_MANIFEST_VERSION: string = "v1";
export const REGISTERED_SPEECH_CLIENT_BUILD_ID: string = ${JSON.stringify(promotedManifest.buildId)};
`;
  writeFileSync(clientConstantPath, clientConstant);

  // Append APPROVALS.md row (create file if first promote).
  let approvalsBody = "";
  if (existsSync(approvalsPath)) {
    approvalsBody = readFileSync(approvalsPath, "utf8");
  } else {
    approvalsBody = `# Registered Speech Approvals

Each promote of \`v1.candidate/\` → \`v1/\` appends a row below. The
approver is responsible for listening to every wav preview in the
linked review.html before approving — sha256 + forbidden-suffix scan
catch corruption / regression, but the **final pronunciation
guarantee is human ears on the audio**.

| Approved at | Manifest buildId | Manifest sha | Reviewer | Report path | Note |
|---|---|---|---|---|---|
`;
  }
  const manifestSha = createHash("sha256")
    .update(JSON.stringify(promotedManifest, null, 2))
    .digest("hex")
    .slice(0, 16);
  const row = `| ${approvedAt} | ${promotedManifest.buildId} | ${manifestSha}… | ${args.approvedBy} | ${args.reportPath} | ${args.reviewerNote || "-"} |\n`;
  writeFileSync(approvalsPath, approvalsBody + row);

  // Confirm every .pcm copied
  const promotedFiles = readdirSync(resolve(promotedRoot, "artifacts"));
  console.log(
    JSON.stringify(
      {
        scope: "grokVoice.registeredSpeech.promote",
        ok: true,
        promotedRoot,
        promotedManifestPath,
        artifactCount: promotedFiles.length,
        buildId: promotedManifest.buildId,
        approvedBy: args.approvedBy,
        approvedAt,
        manifestSha,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (error) {
  console.error("FATAL", error instanceof Error ? error.stack : String(error));
  process.exit(1);
}
